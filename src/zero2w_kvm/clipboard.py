"""2026-10-16 00:25 KST: CodexCode - explicit, text-only clipboard jobs for one Windows USB target."""
import hashlib
import hmac
import io
from pathlib import Path
import secrets
import threading
import time
import zipfile


# 2026-10-16 03:22 KST: the installed Pi and source installer build the same target Windows bundle.
def windows_helper(server, token, bundle=False):
    static = Path(__file__).with_name("static")
    helper = (static / "windows-clipboard-helper.ps1").read_text(encoding="utf-8")
    helper = helper.replace("__KVM_SERVER__", server).replace("__KVM_AGENT_TOKEN__", token).encode("utf-8-sig")
    if not bundle:
        return helper
    commands = {
        "Start": ('KVM-Windows-Clipboard.ps1', '', 'if errorlevel 1 pause'),
        "Install": ('KVM-Windows-Clipboard-Setup.ps1', ' -Action Install', 'pause'),
        "Uninstall": ('KVM-Windows-Clipboard-Setup.ps1', ' -Action Uninstall', 'pause'),
        "Check": ('KVM-Windows-Clipboard.ps1', ' -CheckNetwork', 'pause'),
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("KVM-Windows-Clipboard.ps1", helper)
        archive.writestr("KVM-Windows-Clipboard-Setup.ps1", (static / "windows-clipboard-setup.ps1").read_text(encoding="utf-8").encode("utf-8-sig"))
        for name, (script, arguments, ending) in commands.items():
            command = f'@echo off\r\nsetlocal\r\npowershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0{script}"{arguments}\r\n{ending}\r\n'
            archive.writestr(f"{name}-KVM-Clipboard.cmd", command.encode("ascii"))
        archive.writestr("README.txt", (
            "조종당하는 Windows에서 압축을 푸세요. Pi USB 데이터 케이블이 연결되어 있어야 합니다.\r\n"
            "Install-KVM-Clipboard.cmd: 최초 한 번 실행해 현재 사용자 자동 실행을 설정합니다. 관리자 권한은 필요 없습니다.\r\n"
            "설치 후 USB 재연결과 Windows 로그인 시 자동으로 동작합니다. USB가 없으면 대기합니다.\r\n"
            "Start-KVM-Clipboard.cmd: 설치 없이 수동 실행합니다. 창을 닫으면 종료됩니다.\r\n"
            "Check-KVM-Clipboard.cmd: USB/네트워크/인증과 자동 도우미의 마지막 상태를 확인합니다. 클립보드는 읽지 않습니다.\r\n"
            "Uninstall-KVM-Clipboard.cmd: 자동 실행을 제거하고 도우미를 종료합니다.\r\n"
            "설치 위치: %LOCALAPPDATA%\\Zero2WKVM-Clipboard. 이 폴더에서도 제거 파일을 실행할 수 있습니다.\r\n"
            "KVM 콘솔의 대상 Windows 도우미 연결됨 표시 후 Ctrl+C로 텍스트를 복사하세요.\r\n"
            "대상 Windows에서 Pi 서버로 네트워크 통신이 필요합니다. 이 묶음에는 도우미 전용 인증 정보가 있습니다.\r\n"
        ).encode("utf-8-sig"))
    return output.getvalue()


class ClipboardBridge:
    limit = 65536

    def __init__(self, console_token, clock=time.monotonic):
        # 2026-10-16 02:03 KST: retire old paired helpers that could run on the controller PC.
        self.agent_token = hmac.new(console_token.encode(), b"zero2w-kvm/clipboard-agent/v2", hashlib.sha256).hexdigest()
        self.clock = clock
        self.lock = threading.Lock()
        self.last_seen = None
        self.job = None

    def accepts_agent(self, token):
        return isinstance(token, str) and hmac.compare_digest(token.encode(), self.agent_token.encode())

    def status(self):
        with self.lock:
            return {"agent_ready": self.last_seen is not None and self.clock() - self.last_seen < 5,
                    "text_limit": self.limit}

    def create(self, owner):
        with self.lock:
            now = self.clock()
            if self.last_seen is None or now - self.last_seen >= 5:
                raise ConnectionError("대상 Windows 도우미가 연결되지 않았습니다. 클립보드 설정의 실행 묶음을 조종당하는 Windows로 옮겨 실행하세요. 현재 조종하는 PC에서 실행하면 안 됩니다.")
            identity = secrets.token_urlsafe(18)
            self.job = {"id": identity, "owner": owner, "expires": now + 10, "dispatched": False, "last_dispatch": None, "ready": False}
            return identity

    def poll(self):
        with self.lock:
            self.last_seen = self.clock()
            if self.job and self.job["expires"] <= self.clock():
                self.job = None
            # 2026-10-16 03:22 KST: retry a lost poll response/restarted helper within the original job deadline.
            if self.job and not self.job["ready"] and (not self.job["dispatched"] or self.clock() - self.job["last_dispatch"] >= 2):
                self.job["dispatched"] = True
                self.job["last_dispatch"] = self.clock()
                return self.job["id"]
            return None

    def complete(self, identity, text=None, error=None):
        if error is not None:
            if error not in ("no_text", "busy", "too_large"):
                raise ValueError("Invalid clipboard error")
        elif not isinstance(text, str) or len(text.encode("utf-8")) > self.limit:
            raise ValueError("Clipboard text must be at most 65536 UTF-8 bytes")
        with self.lock:
            if not self.job or self.job["id"] != identity or not self.job["dispatched"] or self.job["ready"] or self.job["expires"] <= self.clock():
                raise KeyError("Clipboard request expired")
            self.job.update(ready=True, text=text if error is None else None, error=error)

    def result(self, identity, owner):
        with self.lock:
            if not self.job or self.job["id"] != identity or self.job["owner"] != owner or self.job["expires"] <= self.clock():
                raise KeyError("Clipboard request expired")
            if not self.job["ready"]:
                return {"ready": False}
            result = {"ready": True, "text": self.job["text"], "error": self.job["error"]}
            self.job = None  # Consume once; do not retain clipboard history.
            return result

    def cancel(self, owner):
        with self.lock:
            if self.job and self.job["owner"] == owner:
                self.job = None

    def expire(self):
        with self.lock:
            if self.job and self.job["expires"] <= self.clock():
                self.job = None
