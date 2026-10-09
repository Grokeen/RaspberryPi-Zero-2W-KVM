// 2026-10-09 23:34 KST: CodexCode - noVNC desktop, shared login and isolated Pi input.
"use strict";
const el = id => document.getElementById(id);
let rfb = null, connected = false, requested = false, authenticated = false;
let attempt = 0;
function message(value) { el("pi-notice").textContent = value; }
function state(label, ok = false) {
  el("pi-connection").textContent = label;
  el("pi-connection").classList.toggle("ok", ok);
}
async function api(path, data) {
  const response = await fetch(path, {method: data === undefined ? "GET" : "POST",
    credentials: "same-origin", headers: data === undefined ? {} : {"Content-Type": "application/json"},
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(5000)});
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      authenticated = false; disconnect();
      el("pi-login").hidden = false; el("pi-console").hidden = true; state("로그인 필요");
    }
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  return result;
}
function controls() {
  el("pi-connect").disabled = requested || connected;
  el("pi-disconnect").disabled = !requested && !connected;
  el("pi-placeholder").hidden = requested || connected;
}
function disconnect() {
  attempt++;
  const current = rfb;
  rfb = null; requested = connected = false;
  if (current) current.disconnect();
  controls();
  if (authenticated) state("연결 종료");
}
async function refresh() {
  try {
    const status = await api("/api/pi/status");
    authenticated = true;
    el("pi-login").hidden = true; el("pi-console").hidden = false;
    el("pi-service").textContent = status.ready ? "Pi 데스크톱 서비스 준비됨" : status.error;
    if (!rfb) state(status.ready ? "연결 준비" : "서비스 확인 필요", status.ready);
    return status;
  } catch (error) {
    if (authenticated) message(error.message);
    return null;
  }
}
async function connect() {
  disconnect(); requested = true; controls(); message(""); state("화면 연결 중");
  const requestId = ++attempt;
  try {
    const status = await refresh();
    if (requestId !== attempt) return;
    if (!status?.ready) throw new Error(status?.error || "로그인과 Pi 데스크톱 서비스를 확인하세요.");
    const {default: RFB} = await import("/novnc/core/rfb.js");
    if (requestId !== attempt) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const current = new RFB(el("pi-screen"), `${scheme}://${location.host}/api/pi/vnc`,
                            {shared: true, wsProtocols: ["binary"]});
    rfb = current;
    current.scaleViewport = true;
    current.resizeSession = false;
    current.compressionLevel = 2;
    current.qualityLevel = 5;
    current.viewOnly = el("pi-view-only").checked;
    current.addEventListener("connect", () => {
      if (rfb !== current) return;
      requested = false; connected = true; controls(); state("Pi 화면 연결됨", true); current.focus();
    });
    current.addEventListener("disconnect", event => {
      if (rfb !== current) return;
      rfb = null; requested = connected = false; controls(); state("연결 종료");
      if (!event.detail.clean) message("화면 연결이 끊겼습니다. 다시 연결해 주세요.");
    });
    current.addEventListener("securityfailure", () => message("Pi VNC 인증에 실패했습니다. VNC 설정을 확인하세요."));
  } catch (error) { if (requestId === attempt) { disconnect(); message(error.message); } }
}
el("pi-login-form").addEventListener("submit", async event => {
  event.preventDefault(); event.submitter.disabled = true;
  try { await api("/api/login", {token: el("pi-token").value}); el("pi-token").value = ""; message(""); await refresh(); }
  catch (error) { message(error.message); }
  finally { event.submitter.disabled = false; }
});
el("pi-connect").addEventListener("click", connect);
el("pi-disconnect").addEventListener("click", disconnect);
el("pi-view-only").addEventListener("change", () => { if (rfb) rfb.viewOnly = el("pi-view-only").checked; });
el("pi-keyboard").addEventListener("click", () => rfb?.focus());
el("pi-escape").addEventListener("click", () => { if (connected && !rfb.viewOnly) { rfb.sendKey(0xff1b, "Escape"); rfb.focus(); } });
el("pi-tab").addEventListener("click", () => { if (connected && !rfb.viewOnly) { rfb.sendKey(0xff09, "Tab"); rfb.focus(); } });
el("pi-fullscreen").addEventListener("click", async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await el("pi-screen").requestFullscreen(); }
  catch { message("브라우저가 전체 화면을 허용하지 않았습니다."); }
});
el("pi-logout").addEventListener("click", async () => {
  disconnect();
  try { await api("/api/logout", {}); } catch (error) { message(error.message); }
  authenticated = false; el("pi-login").hidden = false; el("pi-console").hidden = true; state("로그인 필요");
});
window.addEventListener("pagehide", disconnect);
refresh();
setInterval(refresh, 5000);
