"""2026-10-09 22:35 KST: CodexCode - capture frame boundaries and failure reporting."""
import io
import unittest
from unittest.mock import Mock
from zero2w_kvm.video import Video


class Chunks:
    def __init__(self, chunks):
        self.chunks = iter(chunks)

    def read1(self, size):
        return next(self.chunks, b"")


class VideoTests(unittest.TestCase):
    def test_jpeg_boundaries_cross_reads_and_publish_last_frame(self):
        video = Video()
        video.process = Mock()
        video.process.stdout = Chunks([b"noise\xff", b"\xd8first\xff\xd9\xff\xd8second", b"\xff\xd9"])
        video.process.poll.return_value = 1
        video._read()
        self.assertEqual(video.sequence, 2)
        self.assertEqual(video.frame, b"\xff\xd8second\xff\xd9")
        self.assertIsNotNone(video.error)

    def test_missing_capture_device_is_reported(self):
        video = Video("/a/nonexistent/capture-device")
        video.start()
        self.assertIn("does not exist", video.error)
        self.assertIsNone(video.process)
        video.close()

    def test_oversized_capture_terminates_child(self):
        video = Video()
        video.process = Mock()
        video.process.stdout = io.BytesIO(b"x" * (4 * 1024 * 1024 + 1))
        video.process.poll.return_value = None
        video._read()
        self.assertEqual(video.error, "Capture frame exceeded 4 MiB")
        video.process.terminate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
