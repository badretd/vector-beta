"""Launch Vector: local server + browser app window."""
from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser


def _find_chromium() -> str | None:
    candidates = [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "brave-browser",
        "microsoft-edge",
        "msedge",
    ]
    for name in candidates:
        path = shutil.which(name)
        if path:
            return path
    for path in (
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
    ):
        if os.path.exists(path):
            return path
    return None


def _wait_and_open(port: int, host: str, app_mode: bool, browser: str | None) -> None:
    deadline = time.time() + 25
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            try:
                sock.connect((host if host not in ("0.0.0.0", "::") else "127.0.0.1", port))
                break
            except OSError:
                time.sleep(0.25)
    else:
        return
    url = f"http://{'127.0.0.1' if host in ('0.0.0.0', '::') else host}:{port}/"
    if browser:
        chrome = shutil.which(browser) or browser
    else:
        chrome = _find_chromium()
    if app_mode and chrome:
        try:
            subprocess.Popen(
                [
                    chrome,
                    f"--app={url}",
                    "--window-size=1180,820",
                    "--class=Vector",
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return
        except OSError:
            pass
    webbrowser.open(url, new=1)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Vector — a small curious program")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="do not open a window")
    parser.add_argument("--browser", default=None, help="browser executable for app mode")
    parser.add_argument("--tab", action="store_true", help="open a normal browser tab")
    parser.add_argument("--demo", action="store_true", help="use the offline demo companion")
    parser.add_argument("--data-dir", default=None, help="override the data directory")
    parser.add_argument("--log-level", default=None)
    args = parser.parse_args(argv)

    if args.data_dir:
        os.environ["VECTOR_DATA_DIR"] = os.path.abspath(os.path.expanduser(args.data_dir))
    if args.demo:
        os.environ["VECTOR_MOCK_LLM"] = "1"

    # Import after env is set: config resolves paths at import time.
    import uvicorn

    from .config import SETTINGS_PATH
    from .server import app, get_state

    state = get_state()
    if args.log_level:
        import logging

        logging.getLogger().setLevel(getattr(logging, args.log_level.upper(), logging.INFO))
    if args.demo:
        state.settings.update({"llm": {"mock": True}})
        state.llm.configure(state.settings.all())
        state.asr.configure(state.settings.all())

    url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host}:{args.port}/"
    print()
    print("  ██╗   ██╗███████╗ ██████╗████████╗ ██████╗ ██████╗ ")
    print("  ██║   ██║██╔════╝██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗")
    print("  ██║   ██║█████╗  ██║        ██║   ██║   ██║██████╔╝")
    print("  ╚██╗ ██╔╝██╔══╝  ██║        ██║   ██║   ██║██╔══██╗")
    print("   ╚████╔╝ ███████╗╚██████╗   ██║   ╚██████╔╝██║  ██║")
    print("    ╚═══╝  ╚══════╝ ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝")
    print()
    print(f"  Vector is waking up at {url}")
    print(f"  Settings: {SETTINGS_PATH}")
    print("  No text-to-speech: Vector only types. Press Ctrl+C to stop.")
    print()

    if not args.no_browser:
        threading.Thread(
            target=_wait_and_open,
            args=(args.port, args.host, not args.tab, args.browser),
            daemon=True,
        ).start()

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=(args.log_level or "warning").lower(),
        access_log=False,
    )


if __name__ == "__main__":
    main()
