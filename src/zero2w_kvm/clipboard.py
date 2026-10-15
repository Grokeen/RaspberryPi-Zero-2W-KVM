"""2026-10-16 00:25 KST: CodexCode - explicit, text-only clipboard jobs for one Windows USB target."""
import hashlib
import hmac
import secrets
import threading
import time


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
            self.job = {"id": identity, "owner": owner, "expires": now + 10, "dispatched": False, "ready": False}
            return identity

    def poll(self):
        with self.lock:
            self.last_seen = self.clock()
            if self.job and self.job["expires"] <= self.clock():
                self.job = None
            if self.job and not self.job["dispatched"]:
                self.job["dispatched"] = True
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
