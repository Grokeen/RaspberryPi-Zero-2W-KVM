"""2026-10-09 22:25 KST: CodexCode - authenticated LAN console and USB input API."""
import argparse
from collections import defaultdict
import hmac
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
import re
import secrets
import signal
import threading
import time
from urllib.parse import urlsplit
from . import __version__
from .hid import Controller, ControlBusyError
from .video import Video

LOG = logging.getLogger("zero2w-kvm")
STATIC = Path(__file__).with_name("static")


class Application:
    def __init__(self, token, controller=None, video=None):
        if len(token) < 24:
            raise ValueError("Use an access token of at least 24 characters")
        self.token = token
        self.controller = controller or Controller()
        self.video = video or Video()
        self.sessions = {}
        self.attempts = defaultdict(list)
        self.lock = threading.Lock()
        self.closed = threading.Event()

    def login(self, token, address):
        now = time.monotonic()
        with self.lock:
            self.attempts = defaultdict(list, {
                ip: [stamp for stamp in stamps if now - stamp < 60]
                for ip, stamps in self.attempts.items() if stamps and now - stamps[-1] < 60})
            attempts = self.attempts[address]
            if len(attempts) >= 5:
                return None, 429
            if not isinstance(token, str) or not hmac.compare_digest(token.encode(), self.token.encode()):
                attempts.append(now)
                return None, 401
            self.sessions = {key: expiry for key, expiry in self.sessions.items() if expiry > now}
            if len(self.sessions) >= 128:
                return None, 503
            session = secrets.token_urlsafe(32)
            self.sessions[session] = now + 8 * 60 * 60
            return session, 200

    def identity(self, headers):
        authorization = headers.get("Authorization", "")
        if authorization.startswith("Bearer ") and hmac.compare_digest(
                authorization[7:].encode(), self.token.encode()):
            return "bearer"
        cookie = SimpleCookie()
        try:
            cookie.load(headers.get("Cookie", ""))
            session = cookie["kvm_session"].value
        except (KeyError, ValueError, CookieError):
            return None
        with self.lock:
            return session if self.sessions.get(session, 0) > time.monotonic() else None

    def logout(self, identity):
        with self.lock:
            self.sessions.pop(identity, None)
        with self.controller.lock:
            if self.controller.owner == identity:
                try:
                    self.controller.release()
                except OSError:
                    # Revocation succeeds even when USB is disconnected; watchdog retries release.
                    pass

    def watchdog(self):
        while not self.closed.wait(0.5):
            try:
                self.controller.expire()
            except OSError as error:
                LOG.debug("Release will be retried: %s", error)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, app):
        self.app = app
        self.slots = threading.BoundedSemaphore(32)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        request.settimeout(5)
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "Zero2WKVM/" + __version__

    def log_message(self, format, *args):
        LOG.info("%s %s", self.client_address[0], format % args)

    def _headers(self, status, mime="application/json; charset=utf-8", length=None, cookie=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        if length is not None:
            self.send_header("Content-Length", str(length))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def _json(self, status, data, cookie=None):
        body = json.dumps(data).encode()
        self._headers(status, length=len(body), cookie=cookie)
        self.wfile.write(body)

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True  # Non-browser clients must still authenticate.
        return origin in (f"http://{self.headers.get('Host')}", f"https://{self.headers.get('Host')}")

    def _body(self):
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Chunked request bodies are not supported")
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Content-Type must be application/json")
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 8192:
            raise ValueError("JSON body must be 1..8192 bytes")
        body = json.loads(self.rfile.read(length))
        if not isinstance(body, dict):
            raise ValueError("JSON body must be an object")
        return body

    def do_GET(self):
        path = urlsplit(self.path).path
        assets = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8")}
        try:
            if path in assets:
                filename, mime = assets[path]
                body = (STATIC / filename).read_bytes()
                self._headers(200, mime, len(body))
                self.wfile.write(body)
                return
            if path not in ("/api/status", "/api/video"):
                self._json(404, {"error": "Not found"})
                return
            identity = self.server.app.identity(self.headers)
            if not identity:
                self._json(401, {"error": "Authentication required"})
                return
            if path == "/api/status":
                self._json(200, {"version": __version__, "hid": self.server.app.controller.status(),
                                 "video": self.server.app.video.status()})
            else:
                self._video(identity)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass

    def _video(self, identity):
        video = self.server.app.video
        sequence, frame = video.next_frame(-1) if video.device else (0, None)
        if not frame or video.error:
            self._json(503, {"error": video.error or "Video capture is not configured"})
            return
        self._headers(200, "multipart/x-mixed-replace; boundary=frame")
        while not self.server.app.closed.is_set() and self.server.app.identity(self.headers) == identity:
            self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                             + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n")
            self.wfile.flush()
            previous = sequence
            sequence, frame = video.next_frame(previous)
            if sequence == previous or video.error or not frame:
                break

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            if not self._origin_ok():
                self._json(403, {"error": "Cross-origin requests are forbidden"})
                return
            body = self._body()
            if path == "/api/login":
                session, status = self.server.app.login(body.get("token"), self.client_address[0])
                if session:
                    self._json(200, {"ok": True}, f"kvm_session={session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800")
                else:
                    self._json(status, {"error": "Login rate limit reached" if status == 429 else "Login failed"})
                return
            identity = self.server.app.identity(self.headers)
            if not identity:
                self._json(401, {"error": "Authentication required"})
                return
            if path == "/api/input":
                try:
                    self.server.app.controller.update(body, identity)
                except OSError as error:
                    # A HID EPIPE is a device failure, not a broken HTTP client socket.
                    self._json(503, {"error": f"USB input unavailable: {error}"})
                    return
                self._json(200, {"ok": True})
            elif path == "/api/logout":
                self.server.app.logout(identity)
                self._json(200, {"ok": True}, "kvm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
            else:
                self._json(404, {"error": "Not found"})
        except (ValueError, UnicodeError) as error:
            self.close_connection = True
            self._json(400, {"error": str(error)})
        except ControlBusyError as error:
            self._json(409, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except OSError as error:
            self._json(503, {"error": f"USB input unavailable: {error}"})


def main():
    parser = argparse.ArgumentParser(description="Raspberry Pi Zero 2 W USB console")
    parser.add_argument("--host", default=os.getenv("KVM_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("KVM_PORT", "8080")))
    parser.add_argument("--token-file", default=os.getenv("KVM_TOKEN_FILE", "/etc/zero2w-kvm/access.token"))
    parser.add_argument("--keyboard", default="/dev/hidg0")
    parser.add_argument("--mouse", default="/dev/hidg1")
    parser.add_argument("--video-device", default=os.getenv("KVM_VIDEO_DEVICE") or None)
    parser.add_argument("--video-size", default=os.getenv("KVM_VIDEO_SIZE", "640x480"))
    parser.add_argument("--video-fps", type=int, default=int(os.getenv("KVM_VIDEO_FPS", "10")))
    args = parser.parse_args()
    if not re.fullmatch(r"[1-9]\d{1,3}x[1-9]\d{1,3}", args.video_size) or not 1 <= args.video_fps <= 30:
        parser.error("Invalid video size or frame rate (1..30)")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    token = Path(args.token_file).read_text().strip()
    app = Application(token, Controller(args.keyboard, args.mouse),
                      Video(args.video_device, args.video_size, args.video_fps))
    server = Server((args.host, args.port), app)
    app.video.start()
    threading.Thread(target=app.watchdog, daemon=True).start()
    def terminate(signum, frame):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, terminate)
    LOG.info("Console listening on %s:%s", args.host, args.port)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        app.closed.set()
        server.server_close()
        app.video.close()
        try:
            app.controller.release()
        except OSError:
            pass
