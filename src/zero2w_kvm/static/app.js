// 2026-10-09 22:28 KST: CodexCode - ordered input, pointer capture and disconnect release.
"use strict";
const $ = id => document.getElementById(id);
let authenticated = false, capturing = false, keyboardOnly = false;
let chain = Promise.resolve(), pending = 0, keys = new Set();
let dx = 0, dy = 0, wheel = 0, buttons = 0, mouseDirty = false;
let videoStarted = false;
const known = new Set([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(v => `Key${v}`),
  ...Array.from({length: 10}, (_, i) => `Digit${i}`),
  ...Array.from({length: 10}, (_, i) => `Numpad${i}`),
  ...Array.from({length: 12}, (_, i) => `F${i + 1}`),
  "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight",
  "Enter", "Escape", "Backspace", "Tab", "Space", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash",
  "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash", "CapsLock", "PrintScreen", "ScrollLock", "Pause",
  "Insert", "Home", "PageUp", "Delete", "End", "PageDown", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp",
  "NumLock", "NumpadDivide", "NumpadMultiply", "NumpadSubtract", "NumpadAdd", "NumpadEnter", "NumpadDecimal", "IntlBackslash", "ContextMenu"
]);

function notice(message) { $("notice").textContent = message; }
function showLogin() {
  authenticated = false;
  stopCapture();
  $("login-panel").hidden = false;
  $("console-panel").hidden = true;
  $("connection").textContent = "인증 필요";
  $("connection").classList.remove("ok");
  $("video").removeAttribute("src");
  videoStarted = false;
}
async function api(path, data) {
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: data === undefined ? {} : {"Content-Type": "application/json"},
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(3500)
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") showLogin();
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  return result;
}
function input(data) {
  if (!authenticated) return Promise.resolve();
  pending++;
  const task = chain.then(() => api("/api/input", data));
  chain = task.catch(error => {
    notice(error.message);
    if (data.type !== "release") stopCapture();
  }).finally(() => pending--);
  return chain;
}
function captureUI() {
  $("capture").textContent = capturing ? "키보드 제어 종료" : "키보드 제어 시작";
  $("capture-label").hidden = !capturing;
}
function stopCapture() {
  const wasCapturing = capturing;
  capturing = keyboardOnly = false;
  keys.clear(); dx = dy = wheel = buttons = 0; mouseDirty = false;
  if (document.pointerLockElement) document.exitPointerLock();
  captureUI();
  if (wasCapturing && authenticated) input({type: "release"});
}
$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("/api/login", {token: $("token").value});
    $("token").value = "";
    await status();
    notice("");
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; }
});
$("capture").addEventListener("click", () => {
  if (capturing) { stopCapture(); return; }
  capturing = keyboardOnly = true;
  $("screen").focus(); captureUI(); input({type: "heartbeat"});
});
$("screen").addEventListener("click", async () => {
  if (!authenticated || document.pointerLockElement === $("screen")) return;
  try { await $("screen").requestPointerLock(); }
  catch { notice("마우스 캡처를 사용할 수 없습니다. 키보드 제어 버튼을 사용하세요."); }
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === $("screen")) {
    capturing = true; keyboardOnly = false; $("screen").focus();
    captureUI(); input({type: "heartbeat"});
  } else if (!keyboardOnly) stopCapture();
});
document.addEventListener("pointerlockerror", () => notice("브라우저가 마우스 캡처를 허용하지 않았습니다."));
for (const type of ["keydown", "keyup"]) document.addEventListener(type, event => {
  if (!capturing) return;
  event.preventDefault();
  if (event.code === "Escape") { stopCapture(); return; }
  if (!known.has(event.code)) { notice(`지원하지 않는 키: ${event.code}`); return; }
  if (type === "keydown") {
    if (event.repeat) return;
    keys.add(event.code);
  } else keys.delete(event.code);
  input({type: "keyboard", codes: [...keys]});
}, true);
document.addEventListener("mousemove", event => {
  if (document.pointerLockElement !== $("screen")) return;
  dx = Math.max(-2048, Math.min(2048, dx + event.movementX));
  dy = Math.max(-2048, Math.min(2048, dy + event.movementY));
  mouseDirty = true;
});
for (const type of ["mousedown", "mouseup"]) document.addEventListener(type, event => {
  if (document.pointerLockElement !== $("screen")) return;
  event.preventDefault();
  // DOM buttons and HID both use left=1, right=2, middle=4.
  buttons = event.buttons & 7; mouseDirty = true;
  flushMouse();
});
$("screen").addEventListener("wheel", event => {
  if (document.pointerLockElement !== $("screen")) return;
  event.preventDefault();
  wheel = Math.max(-127, Math.min(127, wheel - Math.sign(event.deltaY)));
  mouseDirty = true;
}, {passive: false});
$("screen").addEventListener("contextmenu", event => event.preventDefault());
function flushMouse() {
  if (!mouseDirty || pending > 1 || !capturing) return;
  const report = {type: "mouse", x: Math.round(dx), y: Math.round(dy), buttons, wheel};
  dx = dy = wheel = 0; mouseDirty = false;
  input(report);
}
setInterval(flushMouse, 33);
setInterval(() => { if (capturing && pending < 2) input({type: "heartbeat"}); }, 700);
$("release").addEventListener("click", () => {
  stopCapture(); input({type: "release"});
});
$("logout").addEventListener("click", async () => {
  stopCapture();
  await chain;
  try { await api("/api/logout", {}); } catch (error) { notice(error.message); }
  showLogin();
});
document.querySelectorAll("[data-keys]").forEach(button => button.addEventListener("click", () => {
  stopCapture();
  input({type: "tap", codes: button.dataset.keys.split(",")});
}));
window.addEventListener("blur", stopCapture);
document.addEventListener("visibilitychange", () => { if (document.hidden) stopCapture(); });
window.addEventListener("pagehide", () => {
  if (authenticated) fetch("/api/input", {method: "POST", credentials: "same-origin", keepalive: true,
    headers: {"Content-Type": "application/json"}, body: JSON.stringify({type: "release"})}).catch(() => {});
});
async function status() {
  try {
    const result = await api("/api/status");
    authenticated = true;
    $("login-panel").hidden = true; $("console-panel").hidden = false;
    const ready = result.hid.keyboard && result.hid.mouse;
    const connected = result.hid.usb_state === "configured";
    $("connection").textContent = connected ? "USB 연결됨" : "콘솔 연결됨";
    $("connection").classList.add("ok");
    $("usb-status").textContent = !ready ? "USB gadget 설정 필요" : connected ? "키보드 · 마우스 연결됨" : `장치 준비됨 · 대상 USB 연결 대기 (${result.hid.usb_state || "unknown"})`;
    $("video-status").textContent = result.video.error || (result.video.ready ? `${result.video.size} · ${result.video.fps} fps` : result.video.enabled ? "영상 신호 대기" : "캡처 장치 미설정");
    $("video-message").textContent = result.video.error || "화면 영상은 HDMI 캡처 장치를 설정한 뒤 표시됩니다.";
    if (result.video.ready && !videoStarted) {
      $("video").src = "/api/video"; videoStarted = true;
      $("video").hidden = false; $("video-placeholder").hidden = true;
    }
    if (!result.video.ready) {
      $("video").hidden = true; $("video-placeholder").hidden = false;
      $("video").removeAttribute("src"); videoStarted = false;
    }
  } catch (error) {
    if (authenticated) { stopCapture(); notice(`연결 확인 실패: ${error.message}`); $("connection").textContent = "연결 끊김"; }
  }
}
$("video").addEventListener("error", () => { videoStarted = false; });
status();
setInterval(status, 3000);
