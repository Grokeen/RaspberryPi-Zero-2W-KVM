"""2026-10-23 22:24 KST: CodexCode - Pi-owned, cancellable background USB text jobs."""
import secrets
import threading

from .hid import ControlBusyError


IME_KEYS = {"AltRight", "Lang1", "ControlLeft,Space", "ShiftLeft,Space", "MetaLeft,Space"}
PLAIN = dict(zip(" \t\n-=[]\\;'`,./", ["Space", "Tab", "Enter", "Minus", "Equal", "BracketLeft",
                                      "BracketRight", "Backslash", "Semicolon", "Quote", "Backquote",
                                      "Comma", "Period", "Slash"]))
SHIFTED = dict(zip('_+{}|:"~<>?', ["Minus", "Equal", "BracketLeft", "BracketRight", "Backslash",
                                 "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash"]))
SHIFTED.update({letter: f"Digit{(index + 1) % 10}" for index, letter in enumerate("!@#$%^&*()")})
BRITISH = {'"': ["ShiftLeft", "Digit2"], "@": ["ShiftLeft", "Quote"], "#": ["Backslash"],
           "~": ["ShiftLeft", "Backslash"], "\\": ["IntlBackslash"], "|": ["ShiftLeft", "IntlBackslash"],
           "£": ["ShiftLeft", "Digit3"], "¬": ["ShiftLeft", "Backquote"]}
INITIALS = ["r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g"]
VOWELS = ["k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l"]
FINALS = ["", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "T", "d", "w", "c", "z", "x", "v", "g"]
JAMO = dict(zip("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ", INITIALS))
JAMO.update(zip("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ", ["k", "o", "i", "O", "j", "p", "u", "P", "h", "y", "n", "b", "m", "l"]))


def ascii_keys(letter, layout):
    if layout == "gb" and letter in BRITISH:
        return BRITISH[letter][:]
    if "a" <= letter <= "z":
        return ["Key" + letter.upper()]
    if "A" <= letter <= "Z":
        return ["ShiftLeft", "Key" + letter]
    if "0" <= letter <= "9":
        return ["Digit" + letter]
    if letter in PLAIN:
        return [PLAIN[letter]]
    if letter in SHIFTED:
        return ["ShiftLeft", SHIFTED[letter]]
    return None


def plan_text(text, layout="us", ime="AltRight"):
    # 2026-10-23 22:24 KST: validate the entire request before acquiring or writing USB.
    if not isinstance(text, str) or not text:
        raise ValueError("입력할 텍스트를 적거나 붙여 넣으세요.")
    if not isinstance(layout, str) or layout not in ("us", "gb", "ko"):
        raise ValueError("입력 방식을 확인하세요.")
    if not isinstance(ime, str) or ime not in IME_KEYS:
        raise ValueError("대상 기기의 한/영 전환키를 선택하세요.")
    letters = text.replace("\r\n", "\n").replace("\r", "\n")
    if len(letters) > 2000:
        raise ValueError("한 번에 입력할 수 있는 텍스트는 2,000자까지입니다.")
    steps, korean = [], False

    def switch_mode(next_mode):
        nonlocal korean
        if next_mode != korean:
            steps.append({"codes": ime.split(","), "ime": next_mode, "delay": 150})
            korean = next_mode

    for index, letter in enumerate(letters):
        keys, code = ascii_keys(letter, layout), ord(letter)
        if keys:
            switch_mode(False)
            steps.append({"codes": keys})
        elif layout == "ko" and 0xAC00 <= code <= 0xD7A3:
            switch_mode(True)
            offset = code - 0xAC00
            strokes = INITIALS[offset // 588] + VOWELS[offset % 588 // 28] + FINALS[offset % 28]
            steps.extend({"codes": ascii_keys(key, "us")} for key in strokes)
        elif layout == "ko" and letter in JAMO:
            switch_mode(False)
            switch_mode(True)
            steps.append({"codes": ascii_keys(JAMO[letter], "us")})
            switch_mode(False)
        else:
            raise ValueError(f"{index + 1}번째 문자는 지원하지 않습니다. 한글은 ‘한글 두벌식 + 영문’을 선택하세요. 이모지 등은 지원하지 않습니다.")
        steps[-1]["progress"] = index + 1
    switch_mode(False)
    return {"steps": steps, "total": len(letters)}


class TextEntry:
    def __init__(self, controller, authorized=lambda identity: True):
        self.controller = controller
        self.authorized = authorized
        self.lock = threading.RLock()
        self.job = None
        self.thread = None
        self.cancelled = threading.Event()

    def _active(self):
        return self.job is not None and self.job["state"] in ("running", "stopping")

    def status(self, identity):
        with self.lock:
            own = self.job and self.job["owner"] == identity
            job = {key: self.job[key] for key in ("id", "state", "progress", "total", "error")} if own else None
            return {"busy": self._active(), "job": job}

    def start(self, identity, text, layout="us", ime="AltRight"):
        plan = plan_text(text, layout, ime)
        with self.lock:
            if self._active():
                raise ControlBusyError("텍스트 입력이 진행 중입니다. 완료하거나 중지한 뒤 다시 보내세요.")
            # Release physical keys before claiming the lease for this complete job.
            self.controller.update({"type": "heartbeat"}, identity)
            self.controller.update({"type": "release"}, identity)
            self.controller.update({"type": "heartbeat"}, identity)
            self.cancelled = threading.Event()
            self.job = {"id": secrets.token_urlsafe(18), "owner": identity, "state": "running",
                        "progress": 0, "total": plan["total"], "error": None}
            self.thread = threading.Thread(target=self._run, args=(identity, plan, ime), daemon=True)
            self.thread.start()
            return self.status(identity)

    def cancel(self, identity, job_id=None):
        with self.lock:
            if not self.job or self.job["owner"] != identity or (job_id is not None and self.job["id"] != job_id):
                raise KeyError("Text job not found")
            if self._active():
                self.job["state"] = "stopping"
                self.cancelled.set()
            return self.status(identity)

    def input(self, event, identity):
        with self.lock:
            if self._active():
                # Browser blur/pagehide may send a stale release. Only explicit cancel stops a job.
                if event.get("type") == "release" and self.job["owner"] == identity:
                    return
                raise ControlBusyError("Pi에서 텍스트를 입력 중입니다. 완료하거나 중지한 뒤 제어하세요.")
            self.controller.update(event, identity)

    def expire(self):
        with self.lock:
            if not self._active():
                self.controller.expire()

    def close(self):
        with self.lock:
            self.cancelled.set()
            thread = self.thread
        if thread:
            thread.join(timeout=5)

    def _run(self, identity, plan, ime):
        korean = False
        failure = None
        try:
            for step in plan["steps"]:
                with self.lock:
                    if not self.authorized(identity):
                        self.cancelled.set()
                    if self.cancelled.is_set():
                        break
                    self.controller.update({"type": "tap", "codes": step["codes"]}, identity)
                    korean = step.get("ime", korean)
                    self.job["progress"] = step.get("progress", self.job["progress"])
                if self.cancelled.wait(max(0.015, step.get("delay", 0) / 1000)):
                    break
        except OSError:
            failure = "USB 입력에 실패했습니다. 연결을 확인하세요. 자동 재전송하지 않습니다."
        finally:
            with self.lock:
                try:
                    if korean:
                        self.controller.update({"type": "tap", "codes": ime.split(",")}, identity)
                except OSError:
                    failure = failure or "한/영 입력 모드를 복원하지 못했습니다. 대상의 입력 상태를 확인하세요."
                finally:
                    try:
                        self.controller.update({"type": "release"}, identity)
                    except OSError:
                        failure = failure or "USB 키 해제에 실패했습니다. 연결을 확인하세요."
                self.job["error"] = failure
                self.job["state"] = "failed" if failure else "cancelled" if self.cancelled.is_set() else "completed"
