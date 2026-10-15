"""2026-10-15 23:10 KST: CodexCode - loopback-only access to a fixed Pi console.

Browsers permit capture devices on localhost. Forward the existing authenticated
console unchanged, including MJPEG and WebSocket traffic; no tokens are stored.
"""
import argparse
from email.parser import BytesHeaderParser
import json
import logging
import re
import select
import socket
import socketserver
import threading
import webbrowser

LOG = logging.getLogger("zero2w-kvm-local")


class LocalConsole(socketserver.ThreadingTCPServer):
    daemon_threads = True

    def __init__(self, port, target):
        self.target = target
        self.slots = threading.BoundedSemaphore(32)
        # Loopback only: this is a browser entry point for this PC, not a LAN relay.
        super().__init__(("127.0.0.1", port), Forwarder)

    def process_request(self, request, client_address):
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


class Forwarder(socketserver.BaseRequestHandler):
    def reply(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.request.sendall((f"HTTP/1.1 {status}\r\nContent-Type: application/json\r\n"
                              f"Content-Length: {len(payload)}\r\nConnection: close\r\n"
                              "Cache-Control: no-store\r\n\r\n").encode() + payload)

    def handle(self):
        try:
            self.request.settimeout(5)
            initial = bytearray()
            while b"\r\n\r\n" not in initial:
                chunk = self.request.recv(8192)
                if not chunk:
                    return
                initial.extend(chunk)
                if len(initial) > 65536:
                    self.reply("431 Request Header Fields Too Large", {"error": "Headers too large"})
                    return
            raw_headers = bytes(initial).split(b"\r\n\r\n", 1)[0]
            request_line, header_lines = raw_headers.split(b"\r\n", 1)
            parts = request_line.split(b" ")
            if len(parts) != 3 or parts[0] not in (b"GET", b"POST") or not parts[1].startswith(b"/"):
                self.reply("400 Bad Request", {"error": "Expected a console GET or POST"})
                return
            headers = BytesHeaderParser().parsebytes(header_lines + b"\r\n\r\n")
            port = self.server.server_address[1]
            allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
            hosts = headers.get_all("Host", [])
            if len(hosts) != 1 or hosts[0] not in allowed:
                self.reply("403 Forbidden", {"error": "Use the localhost console address"})
                return
            origins = headers.get_all("Origin", [])
            if origins and (len(origins) != 1 or origins[0] != f"http://{hosts[0]}"):
                self.reply("403 Forbidden", {"error": "Cross-origin access is not allowed"})
                return
            if parts[1] == b"/__local_kvm__/status":
                self.reply("200 OK", {"service": "zero2w-kvm-local", "pi_host": self.server.target[0],
                                      "pi_port": self.server.target[1]})
                return
            try:
                upstream = socket.create_connection(self.server.target, timeout=5)
            except OSError:
                self.reply("502 Bad Gateway", {"error": "Cannot connect to the Raspberry Pi console"})
                return
            with upstream:
                upstream.sendall(initial)
                # Keep original Host/Origin/cookies for the Pi's same-origin checks.
                # Raw forwarding also preserves WebSocket upgrades and streamed video.
                sockets = (self.request, upstream)
                while True:
                    readable, _, _ = select.select(sockets, [], [], 60)
                    if not readable:
                        return
                    for source in readable:
                        data = source.recv(65536)
                        if not data:
                            return
                        destination = upstream if source is self.request else self.request
                        destination.sendall(data)
        except (OSError, ValueError):
            # Closed tabs and upstream outages must not log cookies or request bodies.
            return


def main(argv=None):
    parser = argparse.ArgumentParser(description="Open the Pi KVM through localhost for PC capture")
    parser.add_argument("--pi-host", required=True)
    parser.add_argument("--pi-port", type=int, default=8080)
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[A-Za-z0-9.-]+", args.pi_host) or not all(1 <= port <= 65535 for port in (args.pi_port, args.port)):
        parser.error("Specify a Pi hostname/IPv4 address and ports in 1..65535")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    with LocalConsole(args.port, (args.pi_host, args.pi_port)) as server:
        url = f"http://127.0.0.1:{server.server_address[1]}/"
        LOG.info("KVM PC capture console: %s", url)
        if args.open_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
