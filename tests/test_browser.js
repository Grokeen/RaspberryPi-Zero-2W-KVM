// 2026-10-09 22:35 KST: CodexCode - browser event ordering without sending real USB input.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../src/zero2w_kvm/static/app.js"), "utf8");

function fixture(usbState = "configured") {
  class Element {
    constructor() { this.listeners = {}; this.dataset = {}; this.classList = {add() {}, remove() {}}; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async fire(type, event = {}) { for (const listener of this.listeners[type] || []) await listener(event); }
    focus() {}
    removeAttribute() {}
    setAttribute(name, value) { this[name] = value; }
    async requestPointerLock() { this.pointerLockRequested = true; }
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
        hid: {keyboard: true, mouse: true, usb_state: usbState}, video: {ready: false, enabled: false}
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

// 2026-10-10 01:00 KST: IME key events must preserve Shift even if its keydown was missed.
test("Korean IME Shift combinations carry the modifier from every physical letter event", async () => {
  const f = fixture();
  await f.run("status()");
  await f.elements.get("capture").fire("click");
  for (const code of ["KeyR", "KeyW", "KeyE", "KeyT", "KeyQ", "KeyO", "KeyP"]) {
    const event = {code, key: "Process", keyCode: 229, isComposing: true,
      shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}};
    await f.document.fire("keydown", event);
    await f.document.fire("keyup", event);
    await f.run("chain");
    const down = f.events.filter(e => e.type === "keyboard").at(-2);
    assert.equal(down.codes.includes("ShiftLeft"), true, `${code} lost Shift`);
    assert.equal(down.codes.includes(code), true);
  }
});

test("modifier snapshots recover Shift release and preserve the explicit right Shift", async () => {
  const f = fixture();
  await f.run("status()");
  await f.elements.get("capture").fire("click");
  const event = (code, shiftKey) => ({code, shiftKey, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}});
  await f.document.fire("keydown", event("ShiftRight", true));
  await f.document.fire("keydown", event("KeyR", true));
  await f.document.fire("keyup", event("KeyR", true));
  // Simulate a missing Shift keyup; the next event's flags must clear it.
  await f.document.fire("keydown", event("KeyW", false));
  await f.run("chain");
  const reports = f.events.filter(e => e.type === "keyboard");
  assert.deepEqual(reports[1].codes, ["ShiftRight", "KeyR"]);
  assert.deepEqual(reports.at(-1).codes, ["KeyW"]);
});

test("holding a letter still repairs a missed Shift event without duplicate repeat reports", async () => {
  const f = fixture();
  await f.run("status()");
  await f.elements.get("capture").fire("click");
  const event = (shiftKey, repeat) => ({code: "KeyR", shiftKey, repeat, preventDefault() {}});
  await f.document.fire("keydown", event(false, false));
  await f.document.fire("keydown", event(true, true));
  await f.document.fire("keydown", event(true, true));
  await f.run("chain");
  const reports = f.events.filter(e => e.type === "keyboard");
  assert.equal(reports.length, 2);
  assert.equal(reports[1].codes.includes("ShiftLeft"), true);
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

// 2026-10-10 00:26 KST: no keyboard or pointer capture before USB host enumeration.
test("detached USB disables capture and clicking the screen only shows wiring guidance", async () => {
  const f = fixture("not attached");
  await f.run("status()");
  assert.equal(f.elements.get("capture").disabled, true);
  assert.equal(f.elements.get("usb-guide").hidden, false);
  await f.elements.get("capture").fire("click");
  await f.elements.get("screen").fire("click");
  await f.run("chain");
  assert.equal(f.run("capturing"), false);
  assert.equal(f.elements.get("screen").pointerLockRequested, undefined);
  assert.deepEqual(f.events, []);
  assert.match(f.elements.get("notice").textContent, /데이터 케이블/);
});

// 2026-10-09 23:42 KST: CodexCode - isolate Pi desktop controls and cancel stale connections.
function piFixture(loadOverride) {
  class Element {
    constructor() { this.listeners = {}; this.checked = false; this.classList = {toggle() {}}; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    async fire(type, event = {}) { await this.listeners[type]?.(event); }
  }
  const elements = new Map(), requests = [], instances = [];
  const document = {getElementById: id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  }};
  class FakeRFB extends Element {
    constructor(target, url, options) { super(); this.url = url; this.options = options; this.keys = []; instances.push(this); }
    focus() { this.focused = true; }
    disconnect() { this.disconnected = true; }
    sendKey(...values) { this.keys.push(values); }
    sendCredentials() {}
  }
  const script = fs.readFileSync(path.join(__dirname, "../src/zero2w_kvm/static/pi.js"), "utf8")
    .replace('await import("/novnc/core/rfb.js")', 'await loadRfb()');
  const context = vm.createContext({document, window: new Element(), AbortSignal, Promise,
    location: {protocol: "https:", host: "pi.example:8443"}, setInterval() {},
    loadRfb: loadOverride || (async () => ({default: FakeRFB})),
    fetch: async (url, options) => {
      requests.push(url);
      return {ok: true, status: 200, json: async () => url === "/api/pi/status" ? {ready: true}
        : {username: "test", password: "test-only"}};
    }
  });
  vm.runInContext(script, context);
  return {elements, requests, instances, context, FakeRFB, run: code => vm.runInContext(code, context)};
}

test("Pi desktop uses same-origin WSS and never calls the USB input API", async () => {
  const f = piFixture();
  await f.run("connect()");
  const rfb = f.instances[0];
  assert.equal(rfb.url, "wss://pi.example:8443/api/pi/vnc");
  assert.deepEqual(JSON.parse(JSON.stringify(rfb.options.wsProtocols)), ["binary"]);
  await rfb.fire("connect");
  await f.elements.get("pi-escape").fire("click");
  await f.elements.get("pi-tab").fire("click");
  assert.deepEqual(rfb.keys, [[0xff1b, "Escape"], [0xff09, "Tab"]]);
  assert.equal(f.requests.includes("/api/input"), false);
});

test("Pi view-only prevents shortcut input and disconnect cleans up the client", async () => {
  const f = piFixture();
  await f.run("connect()");
  const rfb = f.instances[0];
  await rfb.fire("connect");
  f.elements.get("pi-view-only").checked = true;
  await f.elements.get("pi-view-only").fire("change");
  await f.elements.get("pi-escape").fire("click");
  assert.deepEqual(rfb.keys, []);
  await f.elements.get("pi-disconnect").fire("click");
  assert.equal(rfb.disconnected, true);
  assert.equal(f.run("rfb"), null);
});

test("cancelling a pending Pi library load never creates a late connection", async () => {
  let finish;
  const loading = new Promise(resolve => { finish = resolve; });
  const f = piFixture(() => loading);
  const connecting = f.run("connect()");
  // Let the status and credentials promises complete before cancelling the library load.
  await new Promise(resolve => setImmediate(resolve));
  f.run("disconnect()");
  finish({default: f.FakeRFB});
  await connecting;
  assert.equal(f.instances.length, 0);
});
