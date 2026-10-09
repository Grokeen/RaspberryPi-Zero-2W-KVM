// 2026-10-09 22:35 KST: CodexCode - browser event ordering without sending real USB input.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../src/zero2w_kvm/static/app.js"), "utf8");

function fixture() {
  class Element {
    constructor() { this.listeners = {}; this.dataset = {}; this.classList = {add() {}, remove() {}}; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async fire(type, event = {}) { for (const listener of this.listeners[type] || []) await listener(event); }
    focus() {}
    removeAttribute() {}
  }
  const elements = new Map();
  const document = new Element();
  document.getElementById = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  document.querySelectorAll = () => [];
  document.exitPointerLock = () => { document.pointerLockElement = null; };
  const window = new Element(), events = [], intervals = [];
  const context = vm.createContext({document, window, AbortSignal, Promise, Set,
    setInterval: callback => intervals.push(callback),
    fetch: async (url, options) => {
      if (url === "/api/input") events.push(JSON.parse(options.body));
      return {ok: true, status: 200, json: async () => url === "/api/status" ? {
        hid: {keyboard: true, mouse: true, usb_state: "configured"}, video: {ready: false, enabled: false}
      } : {ok: true}};
    }
  });
  vm.runInContext(source, context);
  return {context, document, window, elements, events, intervals,
    run: code => vm.runInContext(code, context)};
}

test("physical keyboard state stays ordered and blur ends with a release", async () => {
  const f = fixture();
  await f.run("status()");
  await f.elements.get("capture").fire("click");
  const event = code => ({code, preventDefault() {}, repeat: false});
  await f.document.fire("keydown", event("ControlLeft"));
  await f.document.fire("keydown", event("KeyA"));
  await f.document.fire("keyup", event("KeyA"));
  await f.window.fire("blur");
  await f.run("chain");
  assert.deepEqual(f.events, [
    {type: "heartbeat"}, {type: "keyboard", codes: ["ControlLeft"]},
    {type: "keyboard", codes: ["ControlLeft", "KeyA"]},
    {type: "keyboard", codes: ["ControlLeft"]}, {type: "release"}
  ]);
  assert.equal(f.run("capturing"), false);
});

test("pointer movement and buttons use the HID bit order", async () => {
  const f = fixture();
  await f.run("status()");
  f.document.pointerLockElement = f.elements.get("screen");
  await f.document.fire("pointerlockchange");
  await f.run("chain");
  await f.document.fire("mousemove", {movementX: 20, movementY: -8});
  await f.document.fire("mousedown", {buttons: 3, preventDefault() {}});
  await f.run("chain");
  assert.deepEqual(f.events.at(-1), {type: "mouse", x: 20, y: -8, buttons: 3, wheel: 0});
});

test("Escape stops capture without sending a host Escape key", async () => {
  const f = fixture();
  await f.run("status()");
  await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "Escape", preventDefault() {}});
  await f.run("chain");
  assert.deepEqual(f.events.at(-1), {type: "release"});
  assert.equal(f.events.some(e => e.codes?.includes("Escape")), false);
});
