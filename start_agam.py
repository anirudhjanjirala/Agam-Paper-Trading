"""
Single-terminal launcher for Agam Paper Trading Platform.
Runs both FastAPI backend (port 8000) and Next.js frontend (port 3000)
inside a single console window with unified logs and clean shutdown.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"

processes: list[subprocess.Popen[str]] = []
stop_event = threading.Event()


def stream_output(proc: subprocess.Popen[str], tag: str) -> None:
    if not proc.stdout:
        return
    try:
        for line in proc.stdout:
            text = line.rstrip()
            if text:
                print(f"[{tag}] {text}", flush=True)
    except Exception:
        pass


def terminate_tree(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            proc.terminate()
            proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def shutdown_all(*_args: object) -> None:
    if stop_event.is_set():
        return
    stop_event.set()
    print("\n[AGAM] Stopping backend & frontend cleanly...", flush=True)
    for proc in reversed(processes):
        terminate_tree(proc)


def free_port_if_busy(port: int) -> None:
    if os.name != "nt":
        return
    try:
        out = subprocess.check_output(
            ["netstat", "-ano", "-p", "TCP"],
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        pids: set[int] = set()
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[1].endswith(f":{port}") and parts[3] == "LISTENING":
                try:
                    pid = int(parts[4])
                    if pid > 0 and pid != os.getpid():
                        pids.add(pid)
                except ValueError:
                    pass
        for pid in pids:
            print(f"[AGAM] Clearing stale process on port {port} (PID {pid})...", flush=True)
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
    except Exception:
        pass


def wait_for_http(url: str, timeout_sec: float = 45.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline and not stop_event.is_set():
        try:
            with urllib.request.urlopen(url, timeout=1.5) as resp:
                if resp.status < 500:
                    return True
        except Exception:
            time.sleep(0.6)
    return False


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    signal.signal(signal.SIGINT, shutdown_all)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, shutdown_all)

    use_prod = "--prod" in sys.argv
    npm_exe = "npm.cmd" if os.name == "nt" else "npm"
    frontend_script = "start" if use_prod else "dev"

    print("=========================================================================", flush=True)
    print("        AGAM PAPER TRADING - SINGLE TERMINAL LAUNCHER", flush=True)
    print("=========================================================================", flush=True)
    free_port_if_busy(8000)
    free_port_if_busy(3000)
    print("[AGAM] Backend  : http://127.0.0.1:8000", flush=True)
    print(f"[AGAM] Frontend : http://localhost:3000 ({frontend_script})", flush=True)
    print("[AGAM] Press Ctrl+C once to stop both servers.\n", flush=True)

    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
    ]
    frontend_cmd = [npm_exe, "run", frontend_script]

    # CREATE_NO_WINDOW prevents Node/npm from spawning separate console windows on Windows
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    child_env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=str(BACKEND_DIR),
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=creation_flags,
    )
    processes.append(backend_proc)
    threading.Thread(target=stream_output, args=(backend_proc, "BACKEND"), daemon=True).start()

    frontend_proc = subprocess.Popen(
        frontend_cmd,
        cwd=str(FRONTEND_DIR),
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=creation_flags,
    )
    processes.append(frontend_proc)
    threading.Thread(target=stream_output, args=(frontend_proc, "FRONTEND"), daemon=True).start()

    def open_browser_when_ready() -> None:
        wait_for_http("http://127.0.0.1:8000/api/health", timeout_sec=30.0)
        if wait_for_http("http://localhost:3000", timeout_sec=45.0) and not stop_event.is_set():
            print("\n[AGAM] Both servers ready -> opening http://localhost:3000\n", flush=True)
            if "--no-browser" not in sys.argv:
                webbrowser.open("http://localhost:3000")

    threading.Thread(target=open_browser_when_ready, daemon=True).start()

    try:
        while not stop_event.is_set():
            if backend_proc.poll() is not None:
                print(f"[AGAM] Backend exited with code {backend_proc.returncode}.", flush=True)
                break
            if frontend_proc.poll() is not None:
                print(f"[AGAM] Frontend exited with code {frontend_proc.returncode}.", flush=True)
                break
            time.sleep(0.5)
    finally:
        shutdown_all()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
