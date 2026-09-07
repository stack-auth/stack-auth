from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from hexclave_tv_box.kiosk_supervisor import (
    ProcessInfo,
    descendant_processes,
    renderer_health,
    supervise,
)


class FakeProcess:
    def __init__(self, pid: int = 100) -> None:
        self.pid = pid
        self.terminated = False

    def poll(self) -> int | None:
        return None

    def terminate(self) -> None:
        self.terminated = True

    def wait(self, timeout: int | None = None) -> int:
        del timeout
        return 0


class KioskSupervisorTests(unittest.TestCase):
    def test_renderer_health_requires_cage_cog_and_the_real_web_process(self) -> None:
        processes = {
            100: ProcessInfo(90, "cage"),
            101: ProcessInfo(100, "cog"),
            102: ProcessInfo(101, "bwrap"),
            103: ProcessInfo(102, "WPEWebProcess"),
            200: ProcessInfo(1, "WPEWebProcess"),
        }

        self.assertEqual(set(descendant_processes(processes, 100)), {101, 102, 103})
        health = renderer_health(processes, 100)
        self.assertTrue(health.ready)
        self.assertEqual(health.summary(), "cage=ready,cog=ready,web-process=ready")

        missing_web_process = dict(processes)
        del missing_web_process[103]
        self.assertFalse(renderer_health(missing_web_process, 100).ready)

    def test_renderer_health_never_counts_an_unrelated_process(self) -> None:
        processes = {
            100: ProcessInfo(90, "cage"),
            101: ProcessInfo(100, "cog"),
            200: ProcessInfo(1, "WPEWebProcess"),
        }

        health = renderer_health(processes, 100)
        self.assertFalse(health.ready)
        self.assertFalse(health.web_process)

    def test_readiness_timeout_fails_and_terminates_the_exact_cage_process(self) -> None:
        process = FakeProcess()
        times = iter((0.0, 0.0, 46.0))
        with tempfile.TemporaryDirectory() as directory:
            health_file = Path(directory) / "health"
            result = supervise(
                ["cage", "--", "cog"],
                health_path=health_file,
                process_reader=lambda: {100: ProcessInfo(90, "cage")},
                monotonic=lambda: next(times),
                sleeper=lambda _seconds: None,
                process_factory=lambda _command: process,
            )

            self.assertEqual(result, 1)
            self.assertTrue(process.terminated)
            self.assertEqual(
                health_file.read_text(encoding="utf-8"),
                "failed-readiness cage=ready,cog=missing,web-process=missing\n",
            )

    def test_liveness_loss_is_tolerated_briefly_then_fails_the_renderer(self) -> None:
        process = FakeProcess()
        ready = {
            100: ProcessInfo(90, "cage"),
            101: ProcessInfo(100, "cog"),
            102: ProcessInfo(101, "WPEWebProcess"),
        }
        degraded = {
            100: ProcessInfo(90, "cage"),
            101: ProcessInfo(100, "cog"),
        }
        snapshots = iter((ready, degraded, degraded))
        current_snapshot = [degraded]

        def process_reader() -> dict[int, ProcessInfo]:
            try:
                current_snapshot[0] = next(snapshots)
            except StopIteration:
                pass
            return current_snapshot[0]

        times = iter((0.0, 0.0, 1.0, 17.0))
        with tempfile.TemporaryDirectory() as directory:
            health_file = Path(directory) / "health"
            result = supervise(
                ["cage", "--", "cog"],
                health_path=health_file,
                process_reader=process_reader,
                monotonic=lambda: next(times),
                sleeper=lambda _seconds: None,
                process_factory=lambda _command: process,
            )

            self.assertEqual(result, 1)
            self.assertTrue(process.terminated)
            self.assertEqual(
                health_file.read_text(encoding="utf-8"),
                "failed-liveness cage=ready,cog=ready,web-process=missing\n",
            )


if __name__ == "__main__":
    unittest.main()
