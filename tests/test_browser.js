// 2026-10-09 22:35 KST: CodexCode - browser event ordering without sending real USB input.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../src/zero2w_kvm/static/app.js"), "utf8");
// 2026-10-11 15:27 KST: CodexCode - exercise textbox typing with the real text planner.
const textSource = fs.readFileSync(path.join(__dirname, "../src/zero2w_kvm/static/text-entry.js"), "utf8");
const keyMap = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/zero2w_kvm/static/keyboard-map.json"), "utf8"));
const consoleHtml = fs.readFileSync(path.join(__dirname, "../src/zero2w_kvm/static/index.html"), "utf8");

// 2026-10-15 23:10 KST: CodexCode - exercise device selection and capture cleanup races.
function captureFixture(getUserMedia) {
  const track = {label: "Live Gamer ULTRA S GC553Pro", stopped: 0, listeners: {}, applied: [],
    settings: {width: 1920, height: 1080, frameRate: 30},
    stop() { this.stopped++; }, addEventListener(type, callback) { this.listeners[type] = callback; },
    getSettings() { return this.settings; },
    async applyConstraints(constraints) { this.applied.push(constraints); this.settings = {
      width: constraints.width.ideal, height: constraints.height.ideal, frameRate: constraints.frameRate.ideal}; }};
  const stream = {getTracks: () => [track], getVideoTracks: () => [track]};
  const requests = [];
  const mediaDevices = {
    enumerateDevices: async () => [
      {kind: "audioinput", deviceId: "microphone", label: "Microphone"},
      {kind: "videoinput", deviceId: "webcam", label: "Webcam"},
      {kind: "videoinput", deviceId: "avermedia", label: track.label}],
    getUserMedia: async constraints => { requests.push(constraints); return getUserMedia ? getUserMedia(constraints) : stream; }
  };
  return {...fixture("configured", {secureContext: true, mediaDevices}), track, stream, requests, mediaDevices};
}

test("PC capture selects AVerMedia and Pi polling preserves the local preview", async () => {
  const f = captureFixture();
  await f.run("status()");
  await f.run("findLocalDevices()");
  assert.equal(f.elements.get("local-video-device").value, "avermedia");
  assert.equal(f.elements.get("local-video-device").children.length, 2);
  assert.equal(f.requests.length, 0);
  await f.run("startLocalVideo()");
  assert.equal(f.requests[0].audio, false);
  assert.equal(f.requests[0].video.deviceId.exact, "avermedia");
  assert.equal(f.elements.get("local-video").srcObject, f.stream);
  assert.equal(f.elements.get("video-fullscreen").disabled, false);
  await f.run("status()");
  assert.equal(f.run("videoReady && videoLoaded"), true);
  assert.equal(f.elements.get("local-video").hidden, false);
  assert.match(f.elements.get("video-status").textContent, /1920×1080/);
  await f.run("showLogin()");
  assert.equal(f.track.stopped, 1);
  assert.equal(f.elements.get("local-video").srcObject, null);
});

test("PC capture stops a stream that arrives after switching sources", async () => {
  let resolve;
  const f = captureFixture(() => new Promise(done => { resolve = done; }));
  await f.run("status()");
  await f.run("findLocalDevices()");
  const connecting = f.run("startLocalVideo()");
  f.run("changeVideoSource('pi')");
  resolve(f.stream);
  await connecting;
  assert.equal(f.track.stopped, 1);
  assert.equal(f.elements.get("local-video").srcObject, null);
  assert.equal(f.run("videoSource"), "pi");
});

test("PC capture reports permission denial and keeps fullscreen settings available after unplug", async () => {
  const denied = captureFixture(async () => { throw Object.assign(new Error("denied"), {name: "NotAllowedError"}); });
  await denied.run("status()"); await denied.run("findLocalDevices()"); await denied.run("startLocalVideo()");
  assert.match(denied.elements.get("local-video-notice").textContent, /권한이 거부/);
  assert.equal(denied.elements.get("local-video-start").disabled, false);
  const f = captureFixture();
  await f.run("status()"); await f.run("findLocalDevices()"); await f.run("startLocalVideo()");
  await f.elements.get("video-fullscreen").fire("click");
  f.track.listeners.ended();
  await Promise.resolve();
  assert.equal(f.document.fullscreenElement, f.elements.get("viewer"));
  assert.equal(f.run("videoReady"), false);
  assert.match(f.elements.get("video-status").textContent, /끊겼/);
});

test("PC discovery releases its permission probe even when logout wins the race", async () => {
  let resolve, entered;
  const requested = new Promise(done => { entered = done; });
  const f = captureFixture(() => new Promise(done => { resolve = done; entered(); }));
  f.mediaDevices.enumerateDevices = async () => [{kind: "videoinput", deviceId: "default", label: ""}];
  await f.run("status()");
  const discovery = f.run("findLocalDevices()");
  await requested;
  f.run("showLogin()");
  resolve(f.stream);
  await discovery;
  assert.equal(f.track.stopped, 1);
  assert.equal(f.elements.get("local-video").srcObject, null);
  assert.equal(f.run("authenticated"), false);
});

test("an HTTP Pi page gives localhost instructions without requesting a device", async () => {
  const f = fixture();
  await f.run("status()"); await f.run("findLocalDevices()");
  assert.equal(f.elements.get("local-video-find").disabled, true);
  assert.match(f.elements.get("local-video-notice").textContent, /Open-KVM-PC.cmd/);
});

function fixture(usbState = "configured", options = {}) {
  let videoReady = Boolean(options.videoReady);
  class Element {
    constructor() {
      this.listeners = {}; this.dataset = {}; this.value = "";
      const classes = new Set();
      this.classList = {add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name), toggle: (name, force) => {
          const enabled = force === undefined ? !classes.has(name) : force;
          if (enabled) classes.add(name); else classes.delete(name);
          return enabled;
        }};
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async fire(type, event = {}) { for (const listener of this.listeners[type] || []) await listener(event); }
    focus() {}
    removeAttribute() {}
    setAttribute(name, value) { this[name] = value; }
    replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ""; }
    appendChild(child) { (this.children ||= []).push(child); return child; }
    async play() { this.readyState = 2; this.videoWidth = 1920; this.videoHeight = 1080; }
    async requestPointerLock() { this.pointerLockRequested = true; }
    async requestFullscreen() {
      this.fullscreenRequests = (this.fullscreenRequests || 0) + 1;
      if (options.fullscreenReject) throw new Error("denied");
      document.fullscreenElement = this;
      await document.fire("fullscreenchange");
    }
  }
  const elements = new Map();
  const document = new Element();
  document.createElement = () => new Element();
  document.getElementById = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  // 2026-10-16 01:00 KST: exercise real shortcut button bindings from the console HTML.
  const shortcutButtons = [...consoleHtml.matchAll(/data-keys="([^"]+)"/g)].map(match => {
    const button = new Element(); button.dataset.keys = match[1]; return button;
  });
  document.querySelectorAll = selector => selector === "[data-keys]" ? shortcutButtons : [];
  document.exitPointerLock = () => { document.pointerLockElement = null; };
  document.fullscreenElement = null;
  document.fullscreenEnabled = options.fullscreenSupported !== false;
  document.exitFullscreen = async () => { document.fullscreenElement = null; await document.fire("fullscreenchange"); };
  const window = new Element(), events = [], intervals = [];
  window.localStorage = options.storage;
  window.isSecureContext = Boolean(options.secureContext);
  const navigator = {mediaDevices: options.mediaDevices, keyboard: options.keyboard, clipboard: options.clipboard};
  const context = vm.createContext({document, window, navigator, KVMKeyMap: keyMap, AbortSignal, Promise, Set, setTimeout,
    setInterval: callback => intervals.push(callback),
    fetch: async (url, options) => {
      if (url === "/api/clipboard/copy") {
        if (optionsClipboardOffline) return {ok: false, status: 503, json: async () => ({error: "대상 Windows 도우미를 먼저 실행하세요."})};
        return {ok: true, status: 200, json: async () => ({job: "test-job"})};
      }
      if (url.startsWith("/api/clipboard/result")) return {ok: true, status: 200,
        json: async () => ({ready: true, text: optionsClipboardText})};
      if (url === "/api/input") {
        const data = JSON.parse(options.body);
        events.push(data);
        optionsCallback(data);
        if (data.type === "tap" && optionsFailAt === events.filter(event => event.type === "tap").length) {
          return {ok: false, status: 503, json: async () => ({code: "usb_disconnected", error: "Target disconnected"})};
        }
      }
      return {ok: true, status: 200, json: async () => url === "/api/status" ? {
        hid: {keyboard: true, mouse: true, usb_state: usbState}, video: {ready: videoReady, enabled: videoReady}
      } : {ok: true}};
    }
  });
  const optionsCallback = options.onInput || (() => {}), optionsFailAt = options.failInputAt;
  const optionsClipboardText = options.clipboardText, optionsClipboardOffline = options.clipboardOffline;
  vm.runInContext(textSource, context);
  vm.runInContext(source, context);
  return {context, document, window, elements, events, intervals, shortcutButtons,
    setVideoReady: value => { videoReady = value; },
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
  await f.elements.get("screen").fire("click", {});
  f.document.pointerLockElement = f.elements.get("screen");
  await f.document.fire("pointerlockchange");
  await f.run("chain");
  await f.document.fire("mousemove", {movementX: 20, movementY: -8});
  await f.document.fire("mousedown", {buttons: 3, preventDefault() {}});
  await f.run("chain");
  assert.deepEqual(f.events.at(-1), {type: "mouse", x: 20, y: -8, buttons: 3, wheel: 0});
});

test("Escape is sent to the USB target without stopping capture", async () => {
  const f = fixture();
  await f.run("status()");
  await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "Escape", preventDefault() {}});
  await f.document.fire("keyup", {code: "Escape", preventDefault() {}});
  await f.run("chain");
  assert.deepEqual(f.events.at(-2), {type: "keyboard", codes: ["Escape"]});
  assert.deepEqual(f.events.at(-1), {type: "keyboard", codes: []});
  assert.equal(f.run("capturing"), true);
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

// 2026-10-10 20:23 KST: capture fullscreen availability, exit/release and failure paths.
test("fullscreen includes settings before video connects and logout exits it", async () => {
  const f = fixture();
  await f.run("status()");
  assert.equal(f.elements.get("video-fullscreen").disabled, false);
  await f.elements.get("video-fullscreen").fire("click");
  assert.equal(f.document.fullscreenElement, f.elements.get("viewer"));
  await f.run("showLogin()");
  assert.equal(f.document.fullscreenElement, null);
  assert.equal(f.elements.get("video-fullscreen").disabled, true);
});

test("a decoded MJPEG frame enables fullscreen even when its load event is delayed", async () => {
  const f = fixture("configured", {videoReady: true});
  await f.run("status()");
  f.elements.get("video").naturalWidth = 640;
  f.elements.get("video").naturalHeight = 480;
  await f.run("status()");
  assert.equal(f.elements.get("video-fullscreen").disabled, false);
});

test("displayed capture video enters fullscreen independently of USB control", async () => {
  const f = fixture("not attached", {videoReady: true});
  await f.run("status()");
  await f.elements.get("video").fire("load");
  await f.elements.get("video-fullscreen").fire("click");
  assert.equal(f.document.fullscreenElement, f.elements.get("viewer"));
  assert.equal(f.elements.get("video-fullscreen")["aria-pressed"], "true");
  assert.equal(f.elements.get("video-fullscreen").textContent, "전체 화면 종료");
  assert.deepEqual(f.events, []);
  await f.elements.get("fullscreen-exit").fire("click", {stopPropagation() {}});
  assert.equal(f.document.fullscreenElement, null);
  assert.equal(f.elements.get("video-fullscreen").textContent, "전체 화면");
});

test("Ctrl Alt Shift leaves fullscreen and releases input without sending the third modifier", async () => {
  const f = fixture("configured", {videoReady: true});
  await f.run("status()");
  await f.elements.get("video").fire("load");
  await f.elements.get("video-fullscreen").fire("click");
  await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "ShiftLeft", shiftKey: true, preventDefault() {}});
  await f.document.fire("keydown", {code: "ControlRight", ctrlKey: true, shiftKey: true, preventDefault() {}});
  await f.document.fire("keydown", {code: "AltRight", ctrlKey: true, altKey: true, shiftKey: true, preventDefault() {}});
  await f.run("chain");
  assert.equal(f.document.fullscreenElement, null);
  assert.equal(f.run("capturing"), false);
  assert.deepEqual(f.events.at(-1), {type: "release"});
  assert.equal(f.events.some(event => event.codes?.includes("AltRight")), false);
});

// 2026-10-16 00:15 KST: real browser variations must produce complete, ordered USB reports.
test("Hangul and Hanja pulses include semantic fallbacks and restore held Shift", async () => {
  const f = fixture();
  f.elements.get("text-ime").value = "Lang1";
  await f.run("status()"); await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "ShiftLeft", shiftKey: true, preventDefault() {}});
  for (const event of [{code: "Lang1", key: "HangulMode"}, {code: "Unidentified", key: "HanjaMode"},
                        {code: "", key: "Process", keyCode: 21}]) {
    await f.document.fire("keydown", {...event, shiftKey: true, preventDefault() {}});
    await f.document.fire("keyup", {...event, shiftKey: true, preventDefault() {}});
  }
  await f.run("chain");
  const taps = f.events.filter(event => event.type === "tap");
  assert.deepEqual(taps.map(event => event.codes), [["ShiftLeft", "Lang1"], ["ShiftLeft", "Lang2"], ["ShiftLeft", "Lang1"]]);
  assert.ok(taps.every(event => JSON.stringify(event.restore_codes) === '["ShiftLeft"]'));
  assert.equal(f.run("capturing"), true);
});

test("PrintScreen keyup-only events and missing IME keyups still send individual taps", async () => {
  const f = fixture(); await f.run("status()"); await f.elements.get("capture").fire("click");
  f.elements.get("text-ime").value = "Lang1";
  await f.document.fire("keyup", {code: "PrintScreen", preventDefault() {}});
  for (let index = 0; index < 2; index++) await f.document.fire("keydown", {code: "Lang1", preventDefault() {}});
  await f.run("chain");
  assert.deepEqual(f.events.filter(event => event.type === "tap").map(event => event.codes), [["PrintScreen"], ["Lang1"], ["Lang1"]]);
});

test("every mapped physical key is accepted and NumLock-off keypad positions are retained", async () => {
  const f = fixture(); await f.run("status()"); await f.elements.get("capture").fire("click");
  for (const code of Object.keys(keyMap)) {
    await f.document.fire("keydown", {code, key: "Process", preventDefault() {}});
    await f.document.fire("keyup", {code, key: "Process", preventDefault() {}});
  }
  await f.document.fire("keydown", {code: "Numpad1", key: "End", location: 3, preventDefault() {}});
  await f.run("chain");
  assert.deepEqual(f.events.at(-1).codes, ["Numpad1"]);
  assert.equal(f.run("capturing"), true);
  assert.equal(f.events.some(event => event.type === "release"), false);
});

test("seven held ordinary keys do not fail capture and the overflow key is promoted on release", async () => {
  const f = fixture(); await f.run("status()"); await f.elements.get("capture").fire("click");
  for (const letter of "ABCDEFG") await f.document.fire("keydown", {code: `Key${letter}`, preventDefault() {}});
  await f.run("chain");
  assert.equal(f.events.at(-1).codes.length, 6);
  await f.document.fire("keyup", {code: "KeyA", preventDefault() {}}); await f.run("chain");
  assert.equal(f.events.at(-1).codes.includes("KeyG"), true);
  assert.equal(f.run("capturing"), true);
});

test("AltGraph does not create a Ctrl modifier or trigger the release chord", async () => {
  const f = fixture(); await f.run("status()"); await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "AltRight", key: "AltGraph", ctrlKey: true, altKey: true, shiftKey: true,
    getModifierState: key => key === "AltGraph", preventDefault() {}});
  await f.run("chain");
  assert.deepEqual(f.events.at(-1).codes, ["AltRight", "ShiftLeft"]);
  assert.equal(f.run("capturing"), true);
});

test("fullscreen capture locks browser keys, passes Escape, and unlocks on the release chord", async () => {
  let locked = 0, unlocked = 0;
  const f = fixture("configured", {keyboard: {lock: async () => locked++, unlock: () => unlocked++}});
  await f.run("status()"); await f.elements.get("video-fullscreen").fire("click");
  await f.elements.get("capture").fire("click"); await f.run("keyboardLockQueue");
  assert.equal(locked, 1); assert.equal(f.run("keyboardLocked"), true);
  await f.document.fire("keydown", {code: "Escape", preventDefault() {}}); await f.run("chain");
  assert.equal(f.document.fullscreenElement, f.elements.get("viewer"));
  assert.deepEqual(f.events.at(-1).codes, ["Escape"]);
  await f.document.fire("keydown", {code: "ShiftLeft", ctrlKey: true, altKey: true, shiftKey: true, preventDefault() {}});
  assert.equal(f.run("keyboardLocked"), false); assert.ok(unlocked > 0);
});

test("a late keyboard-lock grant is immediately released after capture stops", async () => {
  let grant, requested, unlocked = 0;
  const entered = new Promise(resolve => { requested = resolve; });
  const f = fixture("configured", {keyboard: {lock: () => new Promise(resolve => { grant = resolve; requested(); }), unlock: () => unlocked++}});
  await f.run("status()"); await f.elements.get("video-fullscreen").fire("click");
  const starting = f.elements.get("capture").fire("click"); await entered;
  f.run("stopCapture()"); grant(); await starting; await f.run("keyboardLockQueue");
  assert.equal(f.run("keyboardLocked"), false); assert.ok(unlocked > 0);
});

// 2026-10-16 01:00 KST: Windows shortcut startup, OS-reserved fallback, and ordered reports.
const windowsPresets = [...consoleHtml.match(/<select id="windows-shortcut"[\s\S]*?<\/select>/)[0]
  .matchAll(/<option value="([^"]+)"/g)].map(match => match[1]).filter(value => value !== "custom");

test("starting keyboard control enters API fullscreen before locking all keys", async () => {
  const calls = [];
  let f;
  f = fixture("configured", {keyboard: {lock: async () => {
    calls.push(f.document.fullscreenElement === f.elements.get("viewer"));
  }, unlock() {}}});
  await f.run("status()"); await f.elements.get("capture").fire("click");
  assert.deepEqual(calls, [true]);
  assert.equal(f.elements.get("viewer").fullscreenRequests, 1);
  assert.equal(f.run("keyboardLocked && capturing && !captureStarting"), true);
  assert.match(f.elements.get("keyboard-status").textContent, /키보드 잠금 적용/);
});

test("adding mouse capture keeps the granted keyboard lock without requesting permission again", async () => {
  let locks = 0;
  const f = fixture("configured", {keyboard: {lock: async () => locks++, unlock() {}}});
  await f.run("status()"); await f.elements.get("capture").fire("click");
  await f.elements.get("screen").fire("click", {});
  f.document.pointerLockElement = f.elements.get("screen");
  await f.document.fire("pointerlockchange"); await f.run("keyboardLockQueue");
  assert.equal(locks, 1);
  assert.equal(f.run("capturing && keyboardLocked && !keyboardOnly"), true);
  assert.match(f.elements.get("keyboard-status").textContent, /키보드 잠금 적용/);
});

test("unsupported or rejected lock never reports successful system shortcut capture", async () => {
  for (const options of [{fullscreenReject: true}, {fullscreenSupported: false}, {},
    {keyboard: {lock: async () => { throw new Error("denied"); }, unlock() {}}}]) {
    const f = fixture("configured", options);
    await f.run("status()"); await f.elements.get("capture").fire("click");
    assert.equal(f.run("capturing"), true);
    assert.equal(f.run("keyboardLocked"), false);
    assert.doesNotMatch(f.elements.get("keyboard-status").textContent, /키보드 잠금 적용/);
    assert.match(f.elements.get("keyboard-status").textContent, /직접 전송/);
  }
});

test("cancelling or logging out during fullscreen entry cannot start late keyboard capture", async () => {
  for (const action of ["stopCapture()", "showLogin()", "usbConnected = false; stopCapture()"] ) {
    const f = fixture(); await f.run("status()");
    let grant;
    f.elements.get("viewer").requestFullscreen = () => new Promise(resolve => { grant = resolve; });
    const starting = f.elements.get("capture").fire("click");
    assert.equal(f.run("captureStarting"), true);
    f.run(action); grant(); await starting;
    assert.equal(f.run("capturing || captureStarting || keyboardLocked"), false);
    assert.deepEqual(f.events, []);
  }
});

test("a delayed pointer grant after release cannot silently restart control", async () => {
  const f = fixture(); await f.run("status()");
  await f.elements.get("screen").fire("click", {});
  f.run("stopCapture()");
  f.document.pointerLockElement = f.elements.get("screen");
  await f.document.fire("pointerlockchange");
  assert.equal(f.document.pointerLockElement, null);
  assert.equal(f.run("capturing"), false);
});

test("every Windows preset forwards its physical modifier sequence and releases all keys", async () => {
  assert.ok(windowsPresets.length >= 55);
  const modifiers = {ControlLeft: "ctrlKey", AltLeft: "altKey", ShiftLeft: "shiftKey", MetaLeft: "metaKey"};
  const f = fixture(); await f.run("status()"); await f.elements.get("capture").fire("click");
  f.elements.get("text-ime").value = "Lang1";
  for (const preset of windowsPresets) {
    const codes = preset.split(",");
    const flags = {ctrlKey: false, altKey: false, shiftKey: false, metaKey: false};
    for (const code of codes) {
      if (modifiers[code]) flags[modifiers[code]] = true;
      await f.document.fire("keydown", {code, ...flags, preventDefault() {}});
    }
    await f.run("chain");
    const down = f.events.at(-1);
    assert.equal(down.type, ["Lang1", "PrintScreen"].some(code => codes.includes(code)) ? "tap" : "keyboard", preset);
    assert.deepEqual(new Set(down.codes), new Set(codes), preset);
    for (const code of [...codes].reverse()) {
      if (modifiers[code]) flags[modifiers[code]] = false;
      await f.document.fire("keyup", {code, ...flags, preventDefault() {}});
    }
    await f.run("chain");
    assert.equal(f.run("keys.size"), 0, preset);
    assert.equal(f.run("capturing"), true, preset);
  }
});

test("all Windows presets and quick buttons send without browser keyboard events", async () => {
  const f = fixture(); await f.run("status()");
  for (const preset of windowsPresets) {
    f.elements.get("windows-shortcut").value = preset;
    await f.elements.get("shortcut-send").fire("click");
    assert.deepEqual(f.events.at(-1), {type: "tap", codes: preset.split(",")}, preset);
  }
  for (const button of f.shortcutButtons) {
    await button.fire("click");
    assert.deepEqual(f.events.at(-1), {type: "tap", codes: button.dataset.keys.split(",")});
  }
  assert.equal(f.document.fullscreenElement, null);
  assert.equal(f.run("capturing || keyboardLocked"), false);
});

test("custom Windows combinations release capture first and never send unknown keys", async () => {
  const f = fixture(); await f.run("status()"); await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "AltLeft", altKey: true, preventDefault() {}});
  f.elements.get("windows-shortcut").value = "custom";
  await f.elements.get("windows-shortcut").fire("change");
  f.elements.get("shortcut-ctrl").checked = true;
  f.elements.get("shortcut-shift").checked = true;
  f.elements.get("shortcut-win").checked = true;
  f.elements.get("shortcut-key").value = "KeyB";
  await f.elements.get("shortcut-send").fire("click");
  assert.deepEqual(f.events.slice(-2), [{type: "release"}, {type: "tap", codes: ["ControlLeft", "ShiftLeft", "MetaLeft", "KeyB"]}]);
  assert.equal(f.elements.get("shortcut-key").children.length, Object.values(keyMap).filter(usage => usage < 0xE0).length + 1);
  f.elements.get("shortcut-win").checked = false;
  f.elements.get("shortcut-key").value = "";
  await f.elements.get("shortcut-send").fire("click");
  assert.deepEqual(f.events.at(-1), {type: "tap", codes: ["ControlLeft", "ShiftLeft"]});
  const count = f.events.length;
  f.elements.get("shortcut-key").value = "UnknownKey";
  await f.elements.get("shortcut-send").fire("click");
  assert.equal(f.events.length, count);
  assert.match(f.elements.get("shortcut-status").textContent, /확인/);
});

test("Windows shortcut sending is blocked when USB is detached or typing is active", async () => {
  const f = fixture("not attached"); await f.run("status()");
  assert.equal(f.elements.get("shortcut-send").disabled, true);
  await f.elements.get("shortcut-send").fire("click");
  assert.deepEqual(f.events, []);
  f.run("usbConnected = true; typing = true");
  await f.elements.get("shortcut-send").fire("click");
  assert.deepEqual(f.events, []);
});

test("text input can use the dedicated Korean IME key", () => {
  const plan = textPlan("한", "ko", "Lang1");
  assert.deepEqual(plan.steps.filter(step => "ime" in step).map(step => step.codes), [["Lang1"], ["Lang1"]]);
});

// 2026-10-16 01:55 KST: target IME settings apply to physical language keys as well as text input.
test("Windows Hangul events use Right Alt by default without inventing Left Alt", async () => {
  const f = fixture(); await f.run("status()"); await f.elements.get("capture").fire("click");
  assert.equal(f.elements.get("text-ime").disabled, false);
  for (const event of [{code: "Lang1", key: "HangulMode"},
    {code: "AltRight", key: "HangulMode", altKey: true},
    {code: "AltRight", key: "Process", keyCode: 21, altKey: true},
    {code: "Unidentified", key: "Hangul", keyCode: 21}]) {
    await f.document.fire("keydown", {...event, ctrlKey: false, shiftKey: false, preventDefault() {}});
    await f.document.fire("keyup", {...event, ctrlKey: false, shiftKey: false, preventDefault() {}});
  }
  await f.run("chain");
  assert.deepEqual(f.events.filter(event => event.type === "tap"), Array.from({length: 4}, () => ({type: "tap", codes: ["AltRight"], restore_codes: []})));
  assert.match(f.elements.get("ime-status").textContent, /한\/영키 수신.*AltRight/);
  assert.equal(f.run("keys.size"), 0);
  await f.document.fire("keydown", {code: "AltRight", key: "HangulMode", ctrlKey: true, altKey: true, shiftKey: true, preventDefault() {}});
  assert.equal(f.run("capturing"), false); // The emergency chord still uses the physical modifier position.
});

test("IME pulse and test button use the chosen target chord and preserve unrelated held keys", async () => {
  const f = fixture(); await f.run("status()");
  f.elements.get("text-ime").value = "ShiftLeft,Space";
  await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "KeyA", preventDefault() {}});
  await f.document.fire("keydown", {code: "Lang1", preventDefault() {}});
  await f.document.fire("keyup", {code: "Lang1", preventDefault() {}});
  await f.run("chain");
  assert.deepEqual(f.events.at(-1), {type: "tap", codes: ["ShiftLeft", "Space", "KeyA"], restore_codes: ["KeyA"]});
  await f.elements.get("ime-send").fire("click");
  assert.deepEqual(f.events.slice(-2), [{type: "release"}, {type: "tap", codes: ["ShiftLeft", "Space"]}]);
  assert.equal(f.run("capturing"), false);
});

test("IME preference survives reload while storage failures retain the Windows default", async () => {
  let saved;
  const storage = {getItem: () => saved, setItem: (key, value) => { assert.equal(key, "kvm-target-ime"); saved = value; }};
  const f = fixture("configured", {storage});
  f.elements.get("text-ime").value = "Lang1";
  await f.elements.get("text-ime").fire("change");
  assert.equal(fixture("configured", {storage}).elements.get("text-ime").value, "Lang1");
  assert.equal(fixture("configured", {storage: {getItem() { throw new Error("blocked"); }}}).elements.get("text-ime").value, "AltRight");
});

test("unmarked Right Alt and Japanese Kana keep their physical key semantics", async () => {
  const f = fixture(); await f.run("status()"); await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "AltRight", key: "AltGraph", altKey: true,
    getModifierState: key => key === "AltGraph", preventDefault() {}});
  await f.run("chain");
  assert.deepEqual(f.events.at(-1), {type: "keyboard", codes: ["AltRight"]});
  assert.equal(f.run("physicalCode({code:'KanaMode', key:'KanaMode', keyCode:21})"), "KanaMode");
});

test("captured Ctrl+C writes target text to this PC after sending the USB copy shortcut", async () => {
  const writes = [], text = "대상 텍스트\r\n  😀";
  const f = fixture("configured", {clipboardText: text, clipboard: {writeText: async value => writes.push(value)}});
  await f.run("status()"); await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "KeyC", ctrlKey: true, preventDefault() {}});
  await f.document.fire("keydown", {code: "ShiftLeft", ctrlKey: true, altKey: true, shiftKey: true, preventDefault() {}});
  await f.run("clipboardCopyTask");
  assert.deepEqual(writes, [text]);
  assert.ok(f.events.some(event => event.codes?.includes("ControlLeft") && event.codes?.includes("KeyC")));
  assert.match(f.elements.get("clipboard-status").textContent, /이 PC 클립보드에 복사/);
  assert.equal(f.run("capturing"), false);
});

test("an offline helper leaves the local clipboard and active USB control untouched", async () => {
  const writes = [];
  const f = fixture("configured", {clipboardOffline: true, clipboard: {writeText: async value => writes.push(value)}});
  await f.run("status()"); f.run("setSettingsOpen(false)"); await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "KeyC", ctrlKey: true, preventDefault() {}});
  await f.run("clipboardCopyTask");
  assert.deepEqual(writes, []);
  assert.equal(f.run("capturing"), true);
  assert.match(f.elements.get("clipboard-status").textContent, /도우미/);
  assert.equal(f.elements.get("clipboard-feedback").hidden, false);
  assert.match(f.elements.get("clipboard-feedback").textContent, /도우미/);
  assert.equal(f.elements.get("session-settings").hidden, true);
  f.run("showLogin()");
  assert.equal(f.elements.get("clipboard-feedback").hidden, true);
});

test("clipboard write denial is reported without showing copied content", async () => {
  const f = fixture("configured", {clipboardText: "private test content", clipboard: {writeText: async () => {
    throw Object.assign(new Error("denied"), {name: "NotAllowedError"}); }}});
  await f.run("status()"); await f.elements.get("capture").fire("click");
  await f.document.fire("keydown", {code: "KeyC", ctrlKey: true, preventDefault() {}});
  await f.run("clipboardCopyTask");
  assert.match(f.elements.get("clipboard-status").textContent, /쓰기가 차단/);
  assert.equal(f.elements.get("clipboard-status").textContent.includes("private test content"), false);
});

test("native browser fullscreen exit also releases USB input without a key event", async () => {
  const f = fixture("configured", {videoReady: true});
  await f.run("status()");
  await f.elements.get("video").fire("load");
  await f.elements.get("video-fullscreen").fire("click");
  await f.elements.get("capture").fire("click");
  f.document.fullscreenElement = null;
  await f.document.fire("fullscreenchange");
  await f.run("chain");
  assert.equal(f.run("capturing"), false);
  assert.deepEqual(f.events.at(-1), {type: "release"});
});

test("capture signal loss keeps fullscreen settings available and releases USB control", async () => {
  const f = fixture("configured", {videoReady: true});
  await f.run("status()");
  await f.elements.get("video").fire("load");
  await f.elements.get("video-fullscreen").fire("click");
  await f.elements.get("capture").fire("click");
  f.setVideoReady(false);
  await f.run("status()");
  await f.run("chain");
  assert.equal(f.document.fullscreenElement, f.elements.get("viewer"));
  assert.equal(f.elements.get("video-fullscreen").disabled, false);
  assert.equal(f.run("capturing"), false);
  assert.deepEqual(f.events.at(-1), {type: "release"});
});

// 2026-10-15 23:52 KST: CodexCode - sidebar access must never type into the USB target.
test("settings can close, reopen and unpin inside fullscreen without stopping PC video", async () => {
  const f = captureFixture();
  await f.run("status()"); await f.run("findLocalDevices()"); await f.run("startLocalVideo()");
  await f.elements.get("video-fullscreen").fire("click");
  await f.elements.get("capture").fire("click");
  await f.elements.get("settings-close").fire("click");
  await f.run("chain");
  assert.equal(f.elements.get("session-settings").hidden, true);
  assert.equal(f.elements.get("settings-toggle")["aria-expanded"], "false");
  assert.equal(f.run("capturing"), false);
  assert.deepEqual(f.events.at(-1), {type: "release"});
  await f.elements.get("settings-toggle").fire("click");
  await f.elements.get("settings-pin").fire("click");
  assert.equal(f.elements.get("session-settings").hidden, false);
  assert.equal(f.elements.get("settings-pin")["aria-pressed"], "false");
  assert.equal(f.document.fullscreenElement, f.elements.get("viewer"));
  assert.equal(f.elements.get("local-video").srcObject, f.stream);
  assert.equal(f.track.stopped, 0);
});

test("display settings change fit and smoothing without sending keyboard input", async () => {
  const f = fixture();
  await f.run("status()");
  f.elements.get("display-fit").checked = false;
  await f.elements.get("display-fit").fire("change");
  f.elements.get("display-smooth").checked = false;
  await f.elements.get("display-smooth").fire("change");
  assert.equal(f.elements.get("viewer").classList.contains("native-size"), true);
  assert.equal(f.elements.get("viewer").classList.contains("sharp-video"), true);
  f.elements.get("display-fit").checked = true;
  await f.elements.get("display-fit").fire("change");
  assert.equal(f.elements.get("viewer").classList.contains("native-size"), false);
  assert.deepEqual(f.events, []);
});

test("PC capture uses chosen resolution/FPS and applies later changes to the existing track", async () => {
  const f = captureFixture();
  await f.run("status()"); await f.run("findLocalDevices()");
  f.elements.get("local-video-size").value = "1280x720";
  f.elements.get("local-video-fps").value = "15";
  await f.run("startLocalVideo()");
  assert.equal(f.requests[0].video.width.ideal, 1280);
  assert.equal(f.requests[0].video.frameRate.max, 15);
  f.elements.get("local-video-size").value = "3840x2160";
  f.elements.get("local-video-fps").value = "60";
  await f.elements.get("local-video-fps").fire("change");
  assert.equal(f.track.applied[0].width.ideal, 3840);
  assert.equal(f.track.applied[0].frameRate.max, 60);
  assert.match(f.elements.get("video-status").textContent, /3840×2160 · 60 fps/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.track.stopped, 0);
});

test("rejected capture settings keep the working preview and re-enable settings", async () => {
  const f = captureFixture();
  await f.run("status()"); await f.run("findLocalDevices()"); await f.run("startLocalVideo()");
  f.track.applyConstraints = async () => { throw new Error("unsupported"); };
  await f.run("applyLocalVideoSettings()");
  assert.match(f.elements.get("local-video-notice").textContent, /적용하지 못했습니다/);
  assert.equal(f.elements.get("local-video").srcObject, f.stream);
  assert.equal(f.elements.get("local-video-fps").disabled, false);
  assert.equal(f.track.stopped, 0);
});

test("browser rejection and unsupported fullscreen leave the video inline", async () => {
  for (const option of [{fullscreenReject: true}, {fullscreenSupported: false}]) {
    const f = fixture("configured", {videoReady: true, ...option});
    await f.run("status()");
    await f.elements.get("video").fire("load");
    await f.elements.get("video-fullscreen").fire("click");
    assert.equal(f.document.fullscreenElement, null);
    assert.equal(f.run("fullscreenChanging"), false);
    assert.match(f.elements.get("notice").textContent, /전체 화면/);
  }
});

function textPlan(text, layout = "us", imeKey = "AltRight") {
  const context = vm.createContext({});
  vm.runInContext(textSource, context);
  return JSON.parse(JSON.stringify(context.KVMText.plan(text, layout, imeKey)));
}

test("USB text planner maps case, shifted punctuation, tabs and Windows line endings", () => {
  const plan = textPlan("A !\t\r\nz");
  assert.equal(plan.total, 6);
  assert.deepEqual(plan.steps.map(step => step.codes), [
    ["ShiftLeft", "KeyA"], ["Space"], ["ShiftLeft", "Digit1"], ["Tab"], ["Enter"], ["KeyZ"]
  ]);
});

// 2026-10-11 17:02 KST: CodexCode - GB punctuation and sshd pipeline regression.
test("UK layout maps pipe, backslash, quotes, at sign and hash at UK key positions", () => {
  assert.deepEqual(textPlan('@"#~\\|£¬', "gb").steps.map(step => step.codes), [
    ["ShiftLeft", "Quote"], ["ShiftLeft", "Digit2"], ["Backslash"], ["ShiftLeft", "Backslash"],
    ["IntlBackslash"], ["ShiftLeft", "IntlBackslash"], ["ShiftLeft", "Digit3"], ["ShiftLeft", "Backquote"]
  ]);
  assert.equal(textPlan(Array.from({length: 95}, (_, index) => String.fromCharCode(32 + index)).join(""), "gb").total, 95);
});

test("sshd connection-test command changes only its pipe key between US and UK layouts", () => {
  const command = "sudo /usr/sbin/sshd -T -C 'user=testuser,host=192.0.2.120,addr=192.0.2.120,laddr=198.51.100.30,lport=22' | grep -i '^allowgroups'";
  const us = textPlan(command, "us"), gb = textPlan(command, "gb");
  const changed = us.steps.map((step, index) => JSON.stringify(step.codes) !== JSON.stringify(gb.steps[index].codes) ? index : -1).filter(index => index >= 0);
  assert.deepEqual(changed, [command.indexOf("|")]);
  assert.deepEqual(gb.steps[command.indexOf("|")].codes, ["ShiftLeft", "IntlBackslash"]);
  assert.deepEqual(gb.steps[command.indexOf("-T") + 1].codes, ["ShiftLeft", "KeyT"]);
  assert.deepEqual(gb.steps[command.indexOf("^")].codes, ["ShiftLeft", "Digit6"]);
});

test("USB textbox sends the UK pipe through the existing international-backslash key", async () => {
  const f = fixture();
  await f.run("status()");
  f.elements.get("text-layout").value = "gb";
  f.elements.get("type-text").value = "a|b";
  await f.elements.get("text-send").fire("click");
  assert.deepEqual(f.events, [
    {type: "tap", codes: ["KeyA"]}, {type: "tap", codes: ["ShiftLeft", "IntlBackslash"]},
    {type: "tap", codes: ["KeyB"]}, {type: "release"}
  ]);
});

test("Hangul typing decomposes syllables and returns to English across mixed text", () => {
  const plan = textPlan("각A값", "ko");
  assert.deepEqual(plan.steps.map(step => step.codes), [
    ["AltRight"], ["KeyR"], ["KeyK"], ["KeyR"], ["AltRight"], ["ShiftLeft", "KeyA"],
    ["AltRight"], ["KeyR"], ["KeyK"], ["KeyQ"], ["KeyT"], ["AltRight"]
  ]);
  assert.deepEqual(plan.steps.filter(step => "ime" in step).map(step => step.ime), [true, false, true, false]);
  assert.equal(textPlan("쌍ㅏㄱ", "ko").steps.at(-1).ime, false);
  assert.deepEqual(textPlan("쌍", "ko").steps[1].codes, ["ShiftLeft", "KeyT"]);
  for (const hotkey of ["ControlLeft,Space", "ShiftLeft,Space", "MetaLeft,Space"]) {
    assert.deepEqual(textPlan("한", "ko", hotkey).steps[0].codes, hotkey.split(","));
  }
});

test("unsupported Unicode, control characters and excessive text are rejected before typing", () => {
  for (const text of ["ok😀", "text\x00", "한글"]) assert.throws(() => textPlan(text));
  assert.throws(() => textPlan("a".repeat(2001)));
  assert.throws(() => textPlan("한", "ko", "MetaLeft,KeyR"));
  assert.equal(textPlan(" \n\t").total, 3);
});

test("USB textbox sends ordered key taps and a final release without keyboard capture", async () => {
  const f = fixture();
  await f.run("status()");
  f.elements.get("type-text").value = "Ab\n";
  await f.elements.get("text-send").fire("click");
  assert.deepEqual(f.events, [
    {type: "tap", codes: ["ShiftLeft", "KeyA"]}, {type: "tap", codes: ["KeyB"]},
    {type: "tap", codes: ["Enter"]}, {type: "release"}
  ]);
  assert.equal(f.run("capturing"), false);
  assert.equal(f.run("typing"), false);
  assert.match(f.elements.get("text-status").textContent, /입력 완료 · 3자/);
});

test("invalid text and detached USB never start a partial typing job", async () => {
  const f = fixture();
  await f.run("status()");
  f.elements.get("type-text").value = "abc😀";
  await f.elements.get("text-send").fire("click");
  assert.deepEqual(f.events, []);
  const detached = fixture("not attached");
  await detached.run("status()");
  detached.elements.get("type-text").value = "abc";
  await detached.elements.get("text-send").fire("click");
  assert.deepEqual(detached.events, []);
  assert.equal(detached.elements.get("text-send").disabled, true);
});

test("cancel stops further text taps and releases input", async () => {
  let f;
  f = fixture("configured", {onInput: data => { if (data.type === "tap") f.run("cancelTextEntry()"); }});
  await f.run("status()");
  f.elements.get("type-text").value = "abc";
  await f.elements.get("text-send").fire("click");
  assert.deepEqual(f.events, [{type: "tap", codes: ["KeyA"]}, {type: "release"}]);
  assert.match(f.elements.get("text-status").textContent, /입력 중지 · 1 \/ 3자/);
});

test("a target error ends text typing without retries or subsequent characters", async () => {
  const f = fixture("configured", {failInputAt: 2});
  await f.run("status()");
  f.elements.get("type-text").value = "abcd";
  await f.elements.get("text-send").fire("click");
  assert.deepEqual(f.events.map(event => event.codes), [["KeyA"], ["KeyB"]]);
  assert.match(f.elements.get("text-status").textContent, /입력 실패/);
  assert.equal(f.run("typing"), false);
});

test("cancelling Korean input returns the IME to English and leaves no held keys", async () => {
  let f;
  f = fixture("configured", {onInput: data => { if (data.type === "tap") f.run("cancelTextEntry()"); }});
  await f.run("status()");
  f.elements.get("type-text").value = "한글";
  f.elements.get("text-layout").value = "ko";
  f.elements.get("text-ime").value = "AltRight";
  await f.elements.get("text-send").fire("click");
  assert.deepEqual(f.events, [
    {type: "tap", codes: ["AltRight"]}, {type: "tap", codes: ["AltRight"]}, {type: "release"}
  ]);
  assert.equal(f.run("typing"), false);
});

test("focusing the USB textbox releases captured keys so local paste stays local", async () => {
  const f = fixture();
  await f.run("status()");
  await f.elements.get("capture").fire("click");
  await f.elements.get("type-text").fire("focus");
  await f.run("chain");
  assert.equal(f.run("capturing"), false);
  assert.deepEqual(f.events.at(-1), {type: "release"});
});

// 2026-10-09 23:42 KST: CodexCode - isolate Pi desktop controls and cancel stale connections.
function piFixture(loadOverride) {
  class Element {
    constructor() { this.listeners = {}; this.checked = false; this.value = ""; this.classList = {toggle() {}}; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    async fire(type, event = {}) { await this.listeners[type]?.(event); }
  }
  const elements = new Map(), requests = [], instances = [];
  const document = {getElementById: id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  }};
  class FakeRFB extends Element {
    constructor(target, url, options) { super(); this.url = url; this.options = options; this.keys = []; this.clipboard = []; instances.push(this); }
    focus() { this.focused = true; }
    disconnect() { this.disconnected = true; }
    sendKey(...values) { this.keys.push(values); }
    clipboardPasteFrom(text) { this.clipboard.push(text); }
    sendCredentials() {}
  }
  const script = fs.readFileSync(path.join(__dirname, "../src/zero2w_kvm/static/pi.js"), "utf8")
    .replace('await import("/novnc/core/rfb.js")', 'await loadRfb()');
  const context = vm.createContext({document, window: new Element(), AbortSignal, Promise, TextEncoder,
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

// 2026-10-11 11:43 KST: CodexCode - clipboard formatting, UTF-8 limits and connection boundaries.
test("Pi clipboard preserves Korean, emoji, tabs and surrounding whitespace without sending input", async () => {
  const f = piFixture();
  assert.equal(f.elements.get("pi-clipboard-send").disabled, true);
  await f.run("connect()");
  const rfb = f.instances[0];
  await rfb.fire("connect");
  const text = "  첫 줄\n\t둘째 줄 😀\n";
  f.elements.get("pi-clipboard-text").value = text;
  await f.elements.get("pi-clipboard-text").fire("input");
  await f.elements.get("pi-clipboard-send").fire("click");
  assert.deepEqual(rfb.clipboard, [text]);
  assert.deepEqual(rfb.keys, []);
  assert.equal(f.elements.get("pi-paste").disabled, false);
  assert.equal(f.requests.includes("/api/input"), false);
});

test("Pi paste buttons send app-specific shortcuts and release every modifier", async () => {
  const f = piFixture();
  await f.run("connect()");
  const rfb = f.instances[0];
  await rfb.fire("connect");
  f.elements.get("pi-clipboard-text").value = "text";
  await f.elements.get("pi-clipboard-send").fire("click");
  await f.elements.get("pi-paste").fire("click");
  await f.elements.get("pi-terminal-paste").fire("click");
  assert.deepEqual(rfb.keys, [
    [0xffe3, "ControlLeft", true], [0x0076, "KeyV"], [0xffe3, "ControlLeft", false],
    [0xffe3, "ControlLeft", true], [0xffe1, "ShiftLeft", true], [0x0076, "KeyV"],
    [0xffe1, "ShiftLeft", false], [0xffe3, "ControlLeft", false]
  ]);
});

test("Pi clipboard rejects oversized UTF-8 and empty content but accepts whitespace", async () => {
  const f = piFixture();
  await f.run("connect()");
  const rfb = f.instances[0];
  await rfb.fire("connect");
  await f.elements.get("pi-clipboard-send").fire("click");
  f.elements.get("pi-clipboard-text").value = "한".repeat(90000);
  await f.elements.get("pi-clipboard-send").fire("click");
  assert.deepEqual(rfb.clipboard, []);
  assert.match(f.elements.get("pi-notice").textContent, /256 KiB/);
  f.elements.get("pi-clipboard-text").value = " \n\t ";
  await f.elements.get("pi-clipboard-send").fire("click");
  assert.deepEqual(rfb.clipboard, [" \n\t "]);
});

test("Pi view-only and changed text invalidate paste until content is sent again", async () => {
  const f = piFixture();
  await f.run("connect()");
  const rfb = f.instances[0];
  await rfb.fire("connect");
  f.elements.get("pi-clipboard-text").value = "text";
  await f.elements.get("pi-clipboard-send").fire("click");
  await f.elements.get("pi-clipboard-text").fire("input");
  await f.elements.get("pi-paste").fire("click");
  assert.deepEqual(rfb.keys, []);
  f.elements.get("pi-view-only").checked = true;
  await f.elements.get("pi-view-only").fire("change");
  await f.elements.get("pi-clipboard-send").fire("click");
  await f.elements.get("pi-terminal-paste").fire("click");
  assert.deepEqual(rfb.clipboard, ["text"]);
  assert.deepEqual(rfb.keys, []);
  assert.equal(f.elements.get("pi-clipboard-text").disabled, true);
});

test("Pi reconnect requires a new clipboard transfer and logout clears the local text", async () => {
  const f = piFixture();
  await f.run("connect()");
  await f.instances[0].fire("connect");
  f.elements.get("pi-clipboard-text").value = "private text";
  await f.elements.get("pi-clipboard-send").fire("click");
  await f.run("connect()");
  const current = f.instances[1];
  await current.fire("connect");
  await f.elements.get("pi-paste").fire("click");
  assert.deepEqual(current.keys, []);
  assert.equal(f.elements.get("pi-paste").disabled, true);
  await f.elements.get("pi-logout").fire("click");
  assert.equal(f.elements.get("pi-clipboard-text").value, "");
});
