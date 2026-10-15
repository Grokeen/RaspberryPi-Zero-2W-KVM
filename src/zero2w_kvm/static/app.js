// 2026-10-09 22:28 KST: CodexCode - ordered input, pointer capture and disconnect release.
"use strict";
const $ = id => document.getElementById(id);
let authenticated = false, capturing = false, keyboardOnly = false;
let chain = Promise.resolve(), pending = 0, keys = new Set();
let dx = 0, dy = 0, wheel = 0, buttons = 0, mouseDirty = false;
let videoStarted = false;
// 2026-10-10 20:23 KST: CodexCode - enable fullscreen only after a capture frame is displayed.
let videoReady = false, videoLoaded = false, fullscreenChanging = false;
// 2026-10-15 23:10 KST: CodexCode - browser-local capture, separate from Pi MJPEG status.
let videoSource = null, localStream = null, localGeneration = 0, localBusy = false;
let localDevices = [];
// 2026-10-10 00:24 KST: USB target control becomes available after host enumeration.
let usbConnected = false;
// 2026-10-11 15:27 KST: CodexCode - cancellable text typing through existing USB tap reports.
let typing = false, typingCancelled = false;
const usbHint = "USB 대상 컴퓨터의 연결이 인식되지 않았습니다. Pi의 USB 포트를 데이터 케이블로 연결하고 대상 컴퓨터를 켜세요.";
// 2026-10-16 00:15 KST: use the server's HID table, including Korean and international keys.
const known = new Set(Object.keys(KVMKeyMap));
const momentaryKeys = new Set(["Lang1", "Lang2", "PrintScreen", "Pause"]);
const pulsedKeys = new Set();
let keyboardLockGeneration = 0, keyboardLocked = false, keyboardLockQueue = Promise.resolve();
let clipboardGeneration = 0, clipboardCopyTask = Promise.resolve();
const releaseHint = "제어 해제·입력 중지: Ctrl+Alt+Shift를 함께 누르세요. Esc는 대상 컴퓨터에 전달합니다.";
function releaseKeyboardLock() {
  keyboardLockGeneration++;
  keyboardLocked = false;
  try { navigator.keyboard?.unlock?.(); } catch {}
}
function requestKeyboardLock() {
  if (!capturing || !isVideoFullscreen() || typeof navigator.keyboard?.lock !== "function") return Promise.resolve();
  const generation = keyboardLockGeneration;
  keyboardLockQueue = keyboardLockQueue.then(async () => {
    if (generation !== keyboardLockGeneration || !capturing || !isVideoFullscreen()) return;
    try {
      await navigator.keyboard.lock();
      if (generation !== keyboardLockGeneration || !capturing || !isVideoFullscreen()) {
        navigator.keyboard.unlock(); return;
      }
      keyboardLocked = true;
      $("keyboard-help").textContent = `${releaseHint} 키보드 잠금이 적용되었습니다. Esc를 길게 누르는 브라우저 비상 해제는 유지됩니다.`;
    } catch {
      $("keyboard-help").textContent = `${releaseHint} Esc·시스템 단축키를 보내려면 전체 화면에서 브라우저의 키보드 잠금을 허용하세요.`;
    }
  });
  return keyboardLockQueue;
}
function physicalCode(event) {
  if (known.has(event.code)) return event.code;
  const aliases = {HangulMode: "Lang1", Hangul: "Lang1", HanjaMode: "Lang2", Hanja: "Lang2",
    KanaMode: "KanaMode", KanjiMode: "Lang2", Esc: "Escape", Del: "Delete", Spacebar: "Space"};
  if (aliases[event.key]) return aliases[event.key];
  if (event.keyCode === 21) return "Lang1";
  if (event.keyCode === 25) return "Lang2";
  if (event.location === 3) {
    const keypad = {Enter: "NumpadEnter", Decimal: "NumpadDecimal", Delete: "NumpadDecimal",
      Insert: "Numpad0", End: "Numpad1", ArrowDown: "Numpad2", PageDown: "Numpad3",
      ArrowLeft: "Numpad4", Clear: "Numpad5", ArrowRight: "Numpad6", Home: "Numpad7",
      ArrowUp: "Numpad8", PageUp: "Numpad9"};
    if (keypad[event.key]) return keypad[event.key];
  }
  return known.has(event.key) ? event.key : null;
}
function keyboardCodes(values = [...keys]) {
  const modifiers = values.filter(code => KVMKeyMap[code] >= 0xE0);
  return [...modifiers, ...values.filter(code => KVMKeyMap[code] < 0xE0).slice(0, 6)];
}
function isReleaseChord(event, code) {
  return /^(Control|Alt|Shift)(Left|Right)$/.test(code || "") &&
    event.ctrlKey && event.altKey && event.shiftKey && !event.getModifierState?.("AltGraph");
}
// 2026-10-16 00:25 KST: retrieve clipboard text only after an explicitly captured Ctrl+C.
async function copyTargetClipboard() {
  const generation = ++clipboardGeneration;
  if (typeof navigator.clipboard?.writeText !== "function") {
    $("clipboard-status").textContent = "이 PC의 localhost 콘솔에서 브라우저 클립보드를 사용할 수 있습니다."; return;
  }
  $("clipboard-status").textContent = "대상 Windows에서 복사한 텍스트를 가져오는 중…";
  try {
    const {job} = await api("/api/clipboard/copy", {});
    const deadline = Date.now() + 10000;
    while (generation === clipboardGeneration && authenticated && Date.now() < deadline) {
      const result = await api(`/api/clipboard/result?job=${encodeURIComponent(job)}`);
      if (generation !== clipboardGeneration || !authenticated) return;
      if (result.ready) {
        if (result.error) throw new Error(({no_text: "대상 클립보드에 텍스트가 없습니다. 이미지·파일은 지원하지 않습니다.",
          too_large: "클립보드 텍스트는 최대 64 KiB까지 가져올 수 있습니다.", busy: "대상 클립보드가 사용 중입니다. 다시 복사하세요."})[result.error] || "클립보드를 읽지 못했습니다.");
        await navigator.clipboard.writeText(result.text);
        if (generation === clipboardGeneration) $("clipboard-status").textContent = "이 PC 클립보드에 복사했습니다. Ctrl+Alt+Shift로 제어를 해제한 뒤 Ctrl+V로 붙여 넣으세요.";
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (generation === clipboardGeneration) throw new Error("대상 클립보드 응답 시간이 초과되었습니다.");
  } catch (error) {
    if (generation === clipboardGeneration) $("clipboard-status").textContent = error.name === "NotAllowedError"
      ? "이 PC 클립보드 쓰기가 차단되었습니다. 브라우저 사이트 권한을 확인하고 다시 Ctrl+C를 누르세요." : error.message;
  }
}

function notice(message) {
  $("notice").textContent = $("login-notice").textContent = message;
  if (message && authenticated && $("session-settings").hidden) setSettingsOpen(true);
}
// 2026-10-15 23:52 KST: CodexCode - settings stay inside the fullscreen element and release target input.
let settingsOpen = true, settingsPinned = true;
function setSettingsOpen(open) {
  stopCapture();
  settingsOpen = Boolean(open);
  $("session-settings").hidden = !settingsOpen;
  $("viewer").classList.toggle("settings-open", settingsOpen);
  $("settings-toggle").setAttribute("aria-expanded", String(settingsOpen));
  const label = settingsOpen ? "설정 패널 접기" : "설정 패널 열기";
  $("settings-toggle").setAttribute("aria-label", label);
  $("settings-toggle").title = label;
  $("settings-toggle").textContent = settingsOpen ? "›" : "‹";
  if (!settingsOpen) $("settings-toggle").focus();
}
$("settings-toggle").addEventListener("click", () => setSettingsOpen(!settingsOpen));
$("settings-close").addEventListener("click", () => setSettingsOpen(false));
$("settings-pin").addEventListener("click", () => {
  stopCapture();
  settingsPinned = !settingsPinned;
  $("viewer").classList.toggle("settings-pinned", settingsPinned);
  $("settings-pin").setAttribute("aria-pressed", String(settingsPinned));
  $("settings-pin").setAttribute("aria-label", settingsPinned ? "설정 패널 고정 해제" : "설정 패널 고정");
  $("settings-pin").title = settingsPinned ? "설정 패널 고정 해제" : "설정 패널 고정";
});
$("session-settings").addEventListener("pointerdown", stopCapture);
$("display-fit").addEventListener("change", () => {
  stopCapture(); $("viewer").classList.toggle("native-size", !$("display-fit").checked);
});
$("display-smooth").addEventListener("change", () => {
  stopCapture(); $("viewer").classList.toggle("sharp-video", !$("display-smooth").checked);
});
function localVideoConstraints() {
  const size = ["1280x720", "1920x1080", "3840x2160"].includes($("local-video-size").value) ? $("local-video-size").value : "1920x1080";
  const fps = [15, 30, 60].includes(Number($("local-video-fps").value)) ? Number($("local-video-fps").value) : 30;
  const [width, height] = size.split("x").map(Number);
  return {width: {ideal: width}, height: {ideal: height}, frameRate: {ideal: fps, max: fps}};
}
function localVideoStatus() {
  if (!localStream) return;
  const settings = localStream.getVideoTracks()[0].getSettings();
  $("video-status").textContent = `이 PC · ${settings.width || "?"}×${settings.height || "?"} · ${Math.round(settings.frameRate || 0)} fps`;
}
async function applyLocalVideoSettings() {
  if (!authenticated || videoSource !== "local" || !localStream || localBusy) return;
  stopCapture();
  const stream = localStream, generation = localGeneration;
  localBusy = true; localVideoControls();
  try {
    await stream.getVideoTracks()[0].applyConstraints(localVideoConstraints());
    if (generation !== localGeneration) return;
    localVideoStatus();
    $("local-video-notice").textContent = "영상 설정을 적용했습니다. 연결 상태에서 실제 해상도와 프레임 속도를 확인하세요.";
  } catch (error) {
    if (generation === localGeneration) $("local-video-notice").textContent = `영상 설정을 적용하지 못했습니다. ${localVideoError(error)}`;
  } finally {
    if (generation === localGeneration) { localBusy = false; localVideoControls(); }
  }
}
for (const id of ["local-video-size", "local-video-fps"]) $(id).addEventListener("change", applyLocalVideoSettings);
function localVideoSupported() {
  return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function";
}
function localVideoControls() {
  const available = authenticated && videoSource === "local" && localVideoSupported();
  $("local-video-controls").hidden = videoSource !== "local";
  $("local-video-find").disabled = !available || localBusy;
  $("local-video-device").disabled = !available || localBusy || !localDevices.length;
  $("local-video-start").disabled = !available || localBusy || !$("local-video-device").value;
  $("local-video-stop").disabled = !localStream && !localBusy;
  for (const id of ["local-video-size", "local-video-fps"]) $(id).disabled = !available || localBusy;
  if (videoSource === "local" && !localVideoSupported()) {
    $("local-video-notice").textContent = "PC 캡처는 이 PC의 Open-KVM-PC.cmd로 콘솔을 열어 사용하세요. 일반 HTTP Pi 주소에서는 브라우저가 장치 접근을 차단합니다. HTTPS 콘솔에서도 사용할 수 있습니다.";
  }
}
function stopLocalVideo(message = "PC 캡처 영상 연결 대기") {
  localGeneration++;
  localBusy = false;
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  $("local-video").srcObject = null;
  $("local-video").hidden = true;
  if (videoSource === "local") {
    videoReady = videoLoaded = false;
    $("video-placeholder").hidden = false;
    $("video-status").textContent = $("video-message").textContent = message;
    $("local-video-notice").textContent = message;
    stopCapture(); fullscreenUI();
  }
  localVideoControls();
}
function changeVideoSource(value) {
  stopLocalVideo();
  stopCapture();
  videoSource = value === "pi" ? "pi" : "local";
  $("video-source").value = videoSource;
  $("video").removeAttribute("src"); $("video").hidden = true;
  videoStarted = videoReady = videoLoaded = false;
  $("video-placeholder").hidden = false;
  $("video-status").textContent = $("video-message").textContent = videoSource === "local" ? "PC 장치를 찾아 캡처보드를 선택하세요." : "Pi 영상 신호 확인 중";
  localVideoControls(); fullscreenUI();
}
function localVideoError(error) {
  return ({NotAllowedError: "카메라 권한이 거부되었습니다. 주소창의 사이트 권한에서 카메라를 허용하세요.",
    NotFoundError: "영상 장치를 찾지 못했습니다. 이 PC에 캡처보드 USB가 연결되어 있는지 확인하세요.",
    NotReadableError: "영상 장치를 열지 못했습니다. OBS나 AVerMedia 프로그램 등 장치를 사용 중인 앱을 종료한 뒤 다시 연결하세요.",
    OverconstrainedError: "선택한 장치를 사용할 수 없습니다. PC 장치 찾기로 목록을 갱신하세요."})[error.name] || `PC 영상 연결 실패: ${error.message}`;
}
async function findLocalDevices() {
  if (!authenticated || videoSource !== "local" || !localVideoSupported() || localBusy) return;
  stopLocalVideo();
  const generation = localGeneration;
  localBusy = true; localVideoControls();
  $("local-video-notice").textContent = "카메라 권한을 허용하면 이 PC의 영상 장치를 찾습니다…";
  let probe;
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (generation !== localGeneration) return;
    if (!devices.some(device => device.kind === "videoinput" && device.label)) {
      probe = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
      if (generation !== localGeneration) return;
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    if (generation !== localGeneration) return;
    localDevices = devices.filter(device => device.kind === "videoinput" && device.deviceId);
    const previous = $("local-video-device").value;
    $("local-video-device").replaceChildren(...localDevices.map((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId; option.textContent = device.label || `영상 장치 ${index + 1}`;
      return option;
    }));
    $("local-video-device").value = (localDevices.find(device => device.deviceId === previous)
      || localDevices.find(device => /avermedia|live gamer|capture|캡처|캡쳐/i.test(device.label)) || localDevices[0])?.deviceId || "";
    $("local-video-notice").textContent = localDevices.length ? `영상 장치 ${localDevices.length}개를 찾았습니다. 캡처보드를 선택하고 ‘영상 연결’을 누르세요.` : "영상 장치가 없습니다. 캡처보드의 USB 연결과 Windows 카메라 권한을 확인하세요.";
  } catch (error) {
    if (generation === localGeneration) $("local-video-notice").textContent = localVideoError(error);
  } finally {
    if (probe) probe.getTracks().forEach(track => track.stop());
    if (generation === localGeneration) { localBusy = false; localVideoControls(); }
  }
}
async function startLocalVideo() {
  if (!authenticated || videoSource !== "local" || !localVideoSupported() || localBusy || !$("local-video-device").value) return;
  stopLocalVideo();
  const generation = localGeneration;
  localBusy = true; localVideoControls();
  $("local-video-notice").textContent = "선택한 캡처보드에 연결 중…";
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: false, video: {
      deviceId: {exact: $("local-video-device").value}, ...localVideoConstraints()
    }});
    if (generation !== localGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
    localStream = stream;
    for (const track of stream.getVideoTracks()) track.addEventListener("ended", () => {
      if (localStream === stream) stopLocalVideo("PC 캡처 장치 연결이 끊겼습니다. 장치를 다시 찾아 연결하세요.");
    });
    $("local-video").srcObject = stream;
    $("local-video").hidden = false;
    await $("local-video").play();
    if (generation !== localGeneration) return;
    videoReady = true;
    videoLoaded = $("local-video").readyState >= 2 && $("local-video").videoWidth > 0;
    $("video-placeholder").hidden = true;
    localVideoStatus();
    $("local-video-notice").textContent = `연결됨 · ${stream.getVideoTracks()[0].label || "선택한 캡처보드"}`;
    fullscreenUI();
  } catch (error) {
    if (generation === localGeneration) {
      stopLocalVideo();
      $("local-video-notice").textContent = localVideoError(error);
    }
  } finally {
    if (generation === localGeneration) { localBusy = false; localVideoControls(); }
  }
}
$("video-source").addEventListener("change", () => { changeVideoSource($("video-source").value); status(); });
$("local-video-find").addEventListener("click", findLocalDevices);
$("local-video-start").addEventListener("click", startLocalVideo);
$("local-video-stop").addEventListener("click", () => stopLocalVideo());
$("local-video-device").addEventListener("change", () => { stopLocalVideo(); localVideoControls(); });
$("local-video").addEventListener("loadeddata", () => {
  if (localStream && videoSource === "local") { videoLoaded = $("local-video").videoWidth > 0; fullscreenUI(); }
});
function isVideoFullscreen() { return document.fullscreenElement === $("viewer"); }
function fullscreenUI() {
  const active = isVideoFullscreen();
  const supported = typeof $("viewer").requestFullscreen === "function" && document.fullscreenEnabled !== false;
  $("video-fullscreen").disabled = fullscreenChanging || (!active && (!authenticated || !supported));
  $("video-fullscreen").textContent = active ? "전체 화면 종료" : "전체 화면";
  $("video-fullscreen").setAttribute("aria-pressed", String(active));
  $("video-fullscreen").title = !supported ? "이 브라우저는 전체 화면을 지원하지 않습니다." : !authenticated ? "콘솔 로그인 후 사용할 수 있습니다." : "영상 및 설정 전체 화면 전환";
  $("fullscreen-exit").disabled = fullscreenChanging;
}
async function exitVideoFullscreen() {
  if (!isVideoFullscreen()) return;
  stopCapture();
  try { await document.exitFullscreen(); }
  catch { notice("전체 화면을 종료하지 못했습니다. 브라우저의 전체 화면 종료 기능을 사용하세요."); }
  finally { fullscreenUI(); }
}
$("video-fullscreen").addEventListener("click", async () => {
  if (fullscreenChanging) return;
  if (isVideoFullscreen()) { await exitVideoFullscreen(); return; }
  if (!authenticated) return;
  stopCapture();
  if (typeof $("viewer").requestFullscreen !== "function" || document.fullscreenEnabled === false) {
    notice("이 브라우저에서는 영상 전체 화면을 사용할 수 없습니다."); return;
  }
  fullscreenChanging = true; fullscreenUI();
  try { await $("viewer").requestFullscreen(); }
  catch { notice("전체 화면 전환에 실패했습니다. 브라우저의 전체 화면 허용 여부를 확인하세요."); }
  finally { fullscreenChanging = false; fullscreenUI(); }
});
$("fullscreen-exit").addEventListener("click", event => { event.stopPropagation(); exitVideoFullscreen(); });
document.addEventListener("fullscreenchange", () => {
  fullscreenUI();
  if (isVideoFullscreen()) {
    if (!authenticated) { exitVideoFullscreen(); return; }
    $("screen").focus();
  } else stopCapture();
});
document.addEventListener("fullscreenerror", () => {
  fullscreenChanging = false; fullscreenUI();
  notice("브라우저가 영상 전체 화면 전환을 허용하지 않았습니다.");
});
function usbControls() {
  const blocked = !authenticated || !usbConnected || typing;
  $("capture").disabled = blocked;
  $("release").disabled = !usbConnected;
  document.querySelectorAll("[data-keys]").forEach(button => { button.disabled = blocked; });
  for (const id of ["type-text", "text-layout", "text-send"]) $(id).disabled = blocked;
  $("text-ime").disabled = blocked || $("text-layout").value !== "ko";
  $("text-stop").disabled = !typing || typingCancelled;
  $("screen").setAttribute("aria-disabled", String(!usbConnected));
}
function showLogin() {
  authenticated = false;
  clipboardGeneration++;
  stopLocalVideo();
  cancelTextEntry();
  $("type-text").value = "";
  stopCapture();
  videoReady = videoLoaded = false;
  exitVideoFullscreen(); fullscreenUI();
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
    if (result.code === "usb_disconnected") { usbConnected = false; usbControls(); }
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  return result;
}
function input(data, failFast = false) {
  if (!authenticated) return Promise.resolve();
  if (!usbConnected && data.type !== "release") { notice(usbHint); return Promise.resolve(); }
  pending++;
  const task = chain.then(() => api("/api/input", data));
  chain = task.catch(error => {
    notice(error.message);
    if (data.type !== "release") stopCapture();
  }).finally(() => pending--);
  return failFast ? task : chain;
}
function cancelTextEntry() {
  if (!typing) return;
  typingCancelled = true;
  $("text-status").textContent = "입력 중지 중…";
  usbControls();
}
async function typeText() {
  if (typing || !authenticated) return;
  if (!usbConnected) { notice(usbHint); return; }
  let plan;
  try { plan = KVMText.plan($("type-text").value, $("text-layout").value || "us", $("text-ime").value || "AltRight"); }
  catch (error) { $("text-status").textContent = error.message; return; }
  typing = true; typingCancelled = false;
  let progress = 0, korean = false, failure = null;
  stopCapture(); usbControls();
  $("text-status").textContent = `입력 중 · 0 / ${plan.total}자`;
  try {
    await chain;
    for (const step of plan.steps) {
      if (typingCancelled || !authenticated || !usbConnected) break;
      await input({type: "tap", codes: step.codes}, true);
      if (typeof step.ime === "boolean") korean = step.ime;
      if (step.progress) progress = step.progress;
      $("text-status").textContent = `입력 중 · ${progress} / ${plan.total}자`;
      if (step.delay) await new Promise(resolve => setTimeout(resolve, step.delay));
    }
  } catch (error) { failure = error.message; }
  finally {
    if (authenticated && usbConnected) {
      try {
        if (korean) await input({type: "tap", codes: ($("text-ime").value || "AltRight").split(",")}, true);
        await input({type: "release"}, true);
      } catch (error) { failure = failure || error.message; }
    }
    const cancelled = typingCancelled || !authenticated || !usbConnected;
    typing = false; usbControls();
    $("text-status").textContent = failure ? `입력 실패 · ${progress} / ${plan.total}자 · ${failure}`
      : cancelled ? `입력 중지 · ${progress} / ${plan.total}자` : `입력 완료 · ${plan.total}자`;
  }
}
$("type-text").addEventListener("focus", stopCapture);
$("text-layout").addEventListener("change", usbControls);
$("text-send").addEventListener("click", typeText);
$("text-stop").addEventListener("click", cancelTextEntry);
function captureUI() {
  $("capture").textContent = capturing ? "키보드 제어 종료" : "키보드 제어 시작";
  $("capture-label").hidden = !capturing;
}
function stopCapture() {
  const wasCapturing = capturing;
  capturing = keyboardOnly = false;
  keys.clear(); pulsedKeys.clear(); dx = dy = wheel = buttons = 0; mouseDirty = false;
  releaseKeyboardLock();
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
  if (typing) return;
  if (!usbConnected) { notice(usbHint); return; }
  if (capturing) { stopCapture(); return; }
  capturing = keyboardOnly = true;
  $("screen").focus(); captureUI(); input({type: "heartbeat"});
  requestKeyboardLock();
});
$("screen").addEventListener("click", async event => {
  if (typing) return;
  if (event.target?.closest?.("#fullscreen-controls")) return;
  if (!authenticated || document.pointerLockElement === $("screen")) return;
  if (!usbConnected) { notice(usbHint); return; }
  try { await $("screen").requestPointerLock(); }
  catch { notice("마우스 캡처를 사용할 수 없습니다. 키보드 제어 버튼을 사용하세요."); }
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === $("screen")) {
    if (!usbConnected || typing) { document.exitPointerLock(); return; }
    capturing = true; keyboardOnly = false; $("screen").focus();
    captureUI(); input({type: "heartbeat"});
    requestKeyboardLock();
  } else if (!keyboardOnly) stopCapture();
});
document.addEventListener("pointerlockerror", () => notice("브라우저가 마우스 캡처를 허용하지 않았습니다."));
// 2026-10-10 01:00 KST: IME/focus changes can omit modifier key events; trust the current flags.
function syncModifiers(event) {
  for (const [flag, left, right] of [
    ["shiftKey", "ShiftLeft", "ShiftRight"], ["ctrlKey", "ControlLeft", "ControlRight"],
    ["altKey", "AltLeft", "AltRight"], ["metaKey", "MetaLeft", "MetaRight"]
  ]) {
    if (typeof event[flag] !== "boolean") continue;
    // AltGr may expose a synthetic Ctrl flag; do not invent a physical Ctrl key.
    if (flag === "ctrlKey" && (event.key === "AltGraph" || event.getModifierState?.("AltGraph"))) continue;
    if (!event[flag]) { keys.delete(left); keys.delete(right); }
    else if (!keys.has(left) && !keys.has(right)) keys.add(left);
  }
}
for (const type of ["keydown", "keyup"]) document.addEventListener(type, event => {
  const code = physicalCode(event);
  if (type === "keydown" && isReleaseChord(event, code) && (capturing || typing || isVideoFullscreen())) {
    event.preventDefault(); cancelTextEntry(); stopCapture(); exitVideoFullscreen(); return;
  }
  if (typing) return;
  if (!capturing) return;
  event.preventDefault();
  if (!code) { $("keyboard-help").textContent = `${releaseHint} 이 키는 브라우저에서 USB 키 코드로 식별되지 않습니다.`; return; }
  if (momentaryKeys.has(code)) {
    syncModifiers(event);
    if (type === "keyup" && pulsedKeys.delete(code)) return;
    if (type === "keydown") { if (event.repeat) return; pulsedKeys.add(code); }
    const restore = keyboardCodes();
    input({type: "tap", codes: keyboardCodes([code, ...keys]), restore_codes: restore});
    return;
  }
  const previous = [...keys].join("\0");
  if (type === "keydown") {
    keys.add(code);
  } else keys.delete(code);
  syncModifiers(event);
  if (type === "keydown" && event.repeat && previous === [...keys].join("\0")) return;
  const copying = type === "keydown" && code === "KeyC" && !event.repeat && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  const sent = input({type: "keyboard", codes: keyboardCodes()}, copying);
  if (copying) {
    clipboardCopyTask = sent.then(() => { if (authenticated) return copyTargetClipboard(); }).catch(() => {});
  }
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
  cancelTextEntry();
  stopCapture(); input({type: "release"});
});
$("logout").addEventListener("click", async () => {
  cancelTextEntry();
  stopCapture();
  await chain;
  try { await api("/api/logout", {}); } catch (error) { notice(error.message); }
  showLogin();
});
document.querySelectorAll("[data-keys]").forEach(button => button.addEventListener("click", () => {
  if (typing) return;
  stopCapture();
  input({type: "tap", codes: button.dataset.keys.split(",")});
}));
window.addEventListener("blur", () => { cancelTextEntry(); stopCapture(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelTextEntry(); stopCapture(); } });
window.addEventListener("pagehide", () => {
  clipboardGeneration++;
  cancelTextEntry();
  stopLocalVideo();
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
    usbConnected = ready && connected;
    if (!usbConnected) cancelTextEntry();
    usbControls();
    if (!usbConnected && capturing) stopCapture();
    $("connection").textContent = connected ? "USB 연결됨" : "콘솔 연결됨";
    $("connection").classList.add("ok");
    $("usb-status").textContent = !ready ? "USB gadget 설정 필요" : connected ? "키보드 · 마우스 연결됨" : `장치 준비됨 · 대상 USB 연결 대기 (${result.hid.usb_state || "unknown"})`;
    $("usb-guide").hidden = usbConnected;
    $("clipboard-agent-status").textContent = result.clipboard?.agent_ready ? "대상 Windows 도우미 연결됨 · Ctrl+C로 이 PC에 텍스트 복사" : "대상 Windows 도우미 연결 대기";
    if (videoSource === null) changeVideoSource(result.video.enabled ? "pi" : "local");
    localVideoControls();
    if (videoSource === "local") { fullscreenUI(); return; }
    $("video-status").textContent = result.video.error || (result.video.ready ? `${result.video.size} · ${result.video.fps} fps` : result.video.enabled ? "영상 신호 대기" : "캡처 장치 미설정");
    $("video-message").textContent = result.video.error || "화면 영상은 HDMI 캡처 장치를 설정한 뒤 표시됩니다.";
    videoReady = Boolean(result.video.ready);
    if (result.video.ready && !videoStarted) {
      videoLoaded = false;
      $("video").src = "/api/video"; videoStarted = true;
      $("video").hidden = false; $("video-placeholder").hidden = true;
    }
    if (!result.video.ready) {
      videoLoaded = false;
      $("video").hidden = true; $("video-placeholder").hidden = false;
      $("video").removeAttribute("src"); videoStarted = false;
      stopCapture();
    }
    // Some MJPEG browsers delay load while the stream remains open; decoded dimensions prove a frame exists.
    if (videoReady && videoStarted && !$("video").hidden && $("video").naturalWidth > 0 && $("video").naturalHeight > 0) videoLoaded = true;
    fullscreenUI();
  } catch (error) {
    if (authenticated) { cancelTextEntry(); stopCapture(); notice(`연결 확인 실패: ${error.message}`); $("connection").textContent = "연결 끊김"; }
  }
}
$("video").addEventListener("load", () => { videoLoaded = videoStarted && videoReady; fullscreenUI(); });
$("video").addEventListener("error", () => {
  videoStarted = videoLoaded = false;
  stopCapture(); fullscreenUI();
});
status();
setInterval(status, 3000);
