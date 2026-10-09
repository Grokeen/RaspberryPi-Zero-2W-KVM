"""2026-10-09 22:25 KST: CodexCode - one optional V4L2 capture shared by viewers."""
from pathlib import Path
import subprocess
import threading
import time


class Video:
    def __init__(self, device=None, size="640x480", fps=10):
        self.device, self.size, self.fps = device, size, fps
        self.condition = threading.Condition()
        self.frame, self.sequence = None, 0
        self.error = None
        self.process = None
        self.closed = False
        self.thread = None

    def start(self):
        if not self.device:
            return
        if not Path(self.device).exists():
            self.error = f"Video device does not exist: {self.device}"
            return
        try:
            self.process = subprocess.Popen([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
                "-f", "v4l2", "-framerate", str(self.fps), "-video_size", self.size,
                "-i", self.device, "-an", "-threads", "1", "-c:v", "mjpeg",
                "-q:v", "6", "-f", "image2pipe", "pipe:1",
            ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except OSError as error:
            self.error = str(error)
            return
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        buffer = bytearray()
        while not self.closed:
            chunk = self.process.stdout.read1(65536)
            if not chunk:
                break
            buffer.extend(chunk)
            if len(buffer) > 4 * 1024 * 1024:
                self.error = "Capture frame exceeded 4 MiB"
                break
            while True:
                start = buffer.find(b"\xff\xd8")
                end = buffer.find(b"\xff\xd9", start + 2) if start >= 0 else -1
                if end < 0:
                    break
                with self.condition:
                    self.frame = bytes(buffer[start:end + 2])
                    self.sequence += 1
                    self.condition.notify_all()
                del buffer[:end + 2]
        if not self.closed:
            self.error = self.error or "Capture stopped; check the device, format and HDMI signal"
            if self.process.poll() is None:
                self.process.terminate()
        with self.condition:
            self.condition.notify_all()

    def next_frame(self, previous, timeout=5):
        with self.condition:
            self.condition.wait_for(
                lambda: self.sequence != previous or self.error or self.closed, timeout)
            return self.sequence, self.frame

    def status(self):
        return {"enabled": bool(self.device), "ready": bool(self.frame) and not self.error,
                "device": self.device, "size": self.size, "fps": self.fps, "error": self.error}

    def close(self):
        self.closed = True
        with self.condition:
            self.condition.notify_all()
        if self.process:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=3)
            if self.thread:
                self.thread.join(timeout=2)
            self.process.stdout.close()
