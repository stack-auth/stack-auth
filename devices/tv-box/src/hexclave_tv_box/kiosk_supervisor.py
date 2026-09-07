"""Supervise the Cage/Cog renderer as one observable appliance process."""

from __future__ import annotations

import argparse
import logging
import os
import signal
import subprocess
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from .state import atomic_write

LOGGER = logging.getLogger("hexclave-tv-box-kiosk")
READINESS_TIMEOUT_SECONDS = 45
LIVENESS_GRACE_SECONDS = 15
POLL_SECONDS = 1


@dataclass(frozen=True)
class ProcessInfo:
    parent_pid: int
    name: str


@dataclass(frozen=True)
class RendererHealth:
    cage: bool
    cog: bool
    web_process: bool

    @property
    def ready(self) -> bool:
        return self.cage and self.cog and self.web_process

    def summary(self) -> str:
        return ",".join(
            f"{name}={'ready' if present else 'missing'}"
            for name, present in (
                ("cage", self.cage),
                ("cog", self.cog),
                ("web-process", self.web_process),
            )
        )


def read_process_table(proc_root: Path = Path("/proc")) -> dict[int, ProcessInfo]:
    """Read only process names and parent IDs; never inspect process arguments or environments."""
    result: dict[int, ProcessInfo] = {}
    try:
        entries = list(proc_root.iterdir())
    except OSError:
        return result
    for entry in entries:
        if not entry.name.isdecimal():
            continue
        try:
            status_lines = (entry / "status").read_text(encoding="utf-8").splitlines()
            values = {
                key: value.strip()
                for line in status_lines
                if ":" in line
                for key, value in (line.split(":", maxsplit=1),)
            }
            result[int(entry.name)] = ProcessInfo(
                parent_pid=int(values["PPid"]),
                name=values["Name"],
            )
        except (KeyError, OSError, UnicodeError, ValueError):
            # Processes may exit between listing /proc and reading status.
            continue
    return result


def descendant_processes(process_table: Mapping[int, ProcessInfo], root_pid: int) -> dict[int, ProcessInfo]:
    descendants: dict[int, ProcessInfo] = {}
    frontier = [root_pid]
    while frontier:
        parent_pid = frontier.pop()
        children = {
            pid: info
            for pid, info in process_table.items()
            if info.parent_pid == parent_pid and pid not in descendants
        }
        descendants.update(children)
        frontier.extend(children)
    return descendants


def renderer_health(process_table: Mapping[int, ProcessInfo], cage_pid: int) -> RendererHealth:
    cage = process_table.get(cage_pid)
    descendants = descendant_processes(process_table, cage_pid)
    names = {info.name for info in descendants.values()}
    return RendererHealth(
        cage=cage is not None and cage.name == "cage",
        cog="cog" in names,
        web_process="WPEWebProcess" in names,
    )


def _health_value(state: str, health: RendererHealth | None = None) -> str:
    suffix = "" if health is None else f" {health.summary()}"
    return f"{state}{suffix}\n"


def _terminate_exact_tree(process: subprocess.Popen[bytes], process_reader: Callable[[], dict[int, ProcessInfo]]) -> None:
    if process.poll() is not None:
        return
    processes = process_reader()
    descendants = descendant_processes(processes, process.pid)
    # Stopping Cog first follows its normal lifecycle and lets Cage close its
    # single surface cleanly. Any process that ignores SIGTERM remains inside
    # the systemd cgroup and is covered by the unit's bounded SIGKILL fallback.
    ordered = sorted(
        descendants.items(),
        key=lambda item: (item[1].name != "cog", item[1].name != "WPEWebProcess", item[0]),
    )
    for pid, _info in ordered:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
    try:
        process.terminate()
    except ProcessLookupError:
        return


def supervise(
    command: Sequence[str],
    *,
    health_path: Path,
    process_reader: Callable[[], dict[int, ProcessInfo]] = read_process_table,
    monotonic: Callable[[], float] = time.monotonic,
    sleeper: Callable[[float], None] = time.sleep,
    process_factory: Callable[[Sequence[str]], subprocess.Popen[bytes]] = subprocess.Popen,
    readiness_timeout: int = READINESS_TIMEOUT_SECONDS,
    liveness_grace: int = LIVENESS_GRACE_SECONDS,
) -> int:
    if readiness_timeout <= 0 or liveness_grace <= 0:
        raise ValueError("TV Box kiosk supervision intervals must be positive.")

    process = process_factory(command)
    stopping = False
    last_health_value: str | None = None

    def publish_health(state: str, health: RendererHealth | None = None) -> None:
        nonlocal last_health_value
        value = _health_value(state, health)
        if value == last_health_value:
            return
        atomic_write(health_path, value, 0o600)
        last_health_value = value

    def request_stop(_signal_number: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    previous_sigterm = signal.signal(signal.SIGTERM, request_stop)
    previous_sigint = signal.signal(signal.SIGINT, request_stop)
    try:
        started_at = monotonic()
        missing_since: float | None = None
        was_ready = False
        publish_health("starting")
        LOGGER.info("kiosk-supervisor-started")

        while True:
            if stopping:
                publish_health("stopping")
                _terminate_exact_tree(process, process_reader)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    LOGGER.warning("kiosk-renderer-stop-timeout")
                return 0

            return_code = process.poll()
            if return_code is not None:
                publish_health("exited")
                LOGGER.error("kiosk-renderer-exited code=%s", return_code)
                return return_code if return_code != 0 else 1

            now = monotonic()
            health = renderer_health(process_reader(), process.pid)
            if health.ready:
                if not was_ready:
                    LOGGER.info("kiosk-renderer-ready")
                was_ready = True
                missing_since = None
                publish_health("ready", health)
            elif not was_ready:
                publish_health("starting", health)
                if now - started_at >= readiness_timeout:
                    LOGGER.error("kiosk-renderer-readiness-timeout %s", health.summary())
                    publish_health("failed-readiness", health)
                    _terminate_exact_tree(process, process_reader)
                    return 1
            else:
                if missing_since is None:
                    missing_since = now
                    LOGGER.warning("kiosk-renderer-degraded %s", health.summary())
                publish_health("degraded", health)
                if now - missing_since >= liveness_grace:
                    LOGGER.error("kiosk-renderer-liveness-timeout %s", health.summary())
                    publish_health("failed-liveness", health)
                    _terminate_exact_tree(process, process_reader)
                    return 1
            sleeper(POLL_SECONDS)
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)
        signal.signal(signal.SIGINT, previous_sigint)


def main() -> None:
    parser = argparse.ArgumentParser(description="Supervise the Hexclave TV Box Cage/Cog renderer.")
    parser.add_argument("--health-file", type=Path, required=True)
    parser.add_argument("--cookie-jar", type=Path, required=True)
    parser.add_argument("url")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if os.environ.get("WLR_LIBINPUT_NO_DEVICES") != "1":
        raise RuntimeError("TV Box kiosk requires explicit no-input Cage operation.")
    return_code = supervise(
        [
            "/usr/bin/cage",
            "--",
            "/usr/bin/cog",
            "--platform=wl",
            f"--cookie-jar=sqlite:{arguments.cookie_jar}",
            "--webprocess-failure=exit",
            "--enable-write-console-messages-to-stdout=false",
            arguments.url,
        ],
        health_path=arguments.health_file,
    )
    raise SystemExit(return_code)


if __name__ == "__main__":
    main()
