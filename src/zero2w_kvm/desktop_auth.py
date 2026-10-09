"""2026-10-10 00:03 KST: CodexCode - file-backed authentication for the internal adapter."""
import hmac
import json
from pathlib import Path
from websockify.auth_plugins import BasicHTTPAuth


class FileBasicAuth(BasicHTTPAuth):
    def __init__(self, src=None):
        credentials = json.loads(Path(src).read_text())
        self.username = credentials['username']
        self.password = credentials['password']
        if not isinstance(self.username, str) or not isinstance(self.password, str) or len(self.password) < 24:
            raise ValueError('Invalid internal desktop adapter credentials')

    def validate_creds(self, username, password):
        return (hmac.compare_digest(username.encode(), self.username.encode())
                and hmac.compare_digest(password.encode(), self.password.encode()))
