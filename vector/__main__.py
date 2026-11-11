"""Launch Vector: local server + browser app window."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path

from . import __version__


def _ensure_std_streams() -> None:
    """Replace missing stdio with a harmless sink.

    PyInstaller's windowed builds (and ``pythonw.exe``) set ``sys.stdout`` and
    ``sys.stderr`` to ``None`` on Windows.  Some libraries call methods such as
    ``isatty()`` on those streams while configuring themselves; giving them a
    real stream avoids crashes without changing where the app logs, because
    Vector writes its own log file and in-app log separately.
    """
    for name in ("stdout", "stderr"):
        if getattr(sys, name) is None:
            setattr(
                sys,
                name,
                open(os.devnull, "w", encoding="utf-8", errors="replace"),
            )


def _echo(message: str = "", *, err: bool = False) -> None:
    """Print when stdio exists (a windowed build may write to os.devnull)."""
    stream = sys.stderr if err else sys.stdout
    if stream is not None:
        print(message, file=stream)


def _windows_browser_paths() -> list[Path]:
    local = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    roots = [Path(p) for p in (program_files, program_files_x86, local) if p]
    relative = (
        "Google/Chrome/Application/chrome.exe",
        "Google/Chrome Beta/Application/chrome.exe",
        "Chromium/Application/chrome.exe",
        "Microsoft/Edge/Application/msedge.exe",
        "BraveSoftware/Brave-Browser/Application/brave.exe",
    )
    return [root / rel for root in roots for rel in relative]


def _windows_browser_from_registry() -> str | None:
    """Read the App Paths entries written by Chrome/Edge/Brave installers."""
    try:
        import winreg
    except ImportError:  # not on Windows
        return None
    for exe in ("chrome.exe", "msedge.exe", "brave.exe"):
        key_path = rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}"
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
                try:
                    with winreg.OpenKey(
                        hive, key_path, 0, winreg.KEY_READ | view
                    ) as key:
                        value, _ = winreg.QueryValueEx(key, None)
                except OSError:
                    continue
                value = str(value).strip().strip('"')
                if value and Path(value).is_file():
                    return value
    return None


def _find_chromium() -> str | None:
    """Locate a Chrome/Chromium-family browser on Linux, macOS or Windows."""
    if sys.platform == "win32":
        for path in _windows_browser_paths():
            if path.is_file():
                return str(path)
        return _windows_browser_from_registry()

    if sys.platform == "darwin":
        home = Path.home()
        paths = [
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            home / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            Path("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
        ]
        for path in paths:
            if path.is_file():
                return str(path)
        return None

    candidates = [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "brave-browser",
        "microsoft-edge",
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
        args = [
            chrome,
            f"--app={url}",
            "--window-size=1180,820",
            "--no-first-run",
            "--no-default-browser-check",
        ]
        if sys.platform.startswith("linux"):
            args.append("--class=Vector")
        kwargs: dict[str, object] = {
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
        }
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.DETACHED_PROCESS
        else:
            kwargs["start_new_session"] = True
        try:
            subprocess.Popen(args, **kwargs)  # type: ignore[arg-type]
            return
        except OSError:
            pass
    webbrowser.open(url, new=1)


def _run_self_test() -> int:
    """Check that a frozen build can import its native libraries and write data.

    Used by the release workflow on every platform.  Writes a small JSON report
    because ``console=False`` builds have no attached stdout on Windows.
    """
    from .asr import VAD_WINDOW, SileroVAD
    from .config import DATA_DIR, WEB_DIR

    import av
    import ctranslate2
    import faster_whisper
    import numpy as np
    import onnxruntime

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    probe = DATA_DIR / ".vector-write-test"
    probe.write_text("ok", encoding="utf-8")
    probe.unlink()

    index = WEB_DIR / "index.html"
    if not index.is_file():
        raise RuntimeError(f"bundled web assets are missing: {index}")

    vad = SileroVAD()
    score = vad.probability(np.zeros(VAD_WINDOW, dtype=np.float32))

    report = {
        "ok": True,
        "version": __version__,
        "data_dir": str(DATA_DIR),
        "web_dir": str(WEB_DIR),
        "ctranslate2": getattr(ctranslate2, "__version__", "unknown"),
        "faster_whisper": getattr(faster_whisper, "__version__", "unknown"),
        "onnxruntime": onnxruntime.__version__,
        "av": av.__version__,
        "silero_probability": round(float(score), 6),
    }
    (DATA_DIR / "self-test.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    _echo(json.dumps(report, indent=2))
    return 0


def main(argv: list[str] | None = None) -> None:
    _ensure_std_streams()
    parser = argparse.ArgumentParser(description="Vector — a small curious program")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="do not open a window")
    parser.add_argument("--browser", default=None, help="browser executable for app mode")
    parser.add_argument("--tab", action="store_true", help="open a normal browser tab")
    parser.add_argument("--demo", action="store_true", help="use the offline demo companion")
    parser.add_argument("--data-dir", default=None, help="override the data directory")
    parser.add_argument("--log-level", default=None)
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="verify bundled libraries and writable paths, then exit",
    )
    parser.add_argument("--version", action="version", version=f"Vector {__version__}")
    args = parser.parse_args(argv)

    if args.data_dir:
        os.environ["VECTOR_DATA_DIR"] = os.path.abspath(os.path.expanduser(args.data_dir))
    if args.demo:
        os.environ["VECTOR_MOCK_LLM"] = "1"

    if args.self_test:
        try:
            raise SystemExit(_run_self_test())
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001
            if sys.stderr is not None:
                traceback.print_exc()
            _echo(f"self-test failed: {exc}", err=True)
            raise SystemExit(1) from exc

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
    _echo()
    _echo("  ██╗   ██╗███████╗ ██████╗████████╗ ██████╗ ██████╗ ")
    _echo("  ██║   ██║██╔════╝██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗")
    _echo("  ██║   ██║█████╗  ██║        ██║   ██║   ██║██████╔╝")
    _echo("  ╚██╗ ██╔╝██╔══╝  ██║        ██║   ██║   ██║██╔══██╗")
    _echo("   ╚████╔╝ ███████╗╚██████╗   ██║   ╚██████╔╝██║  ██║")
    _echo("    ╚═══╝  ╚══════╝ ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝")
    _echo()
    _echo(f"  Vector is waking up at {url}")
    _echo(f"  Settings: {SETTINGS_PATH}")
    _echo("  No text-to-speech: Vector only types. Press Ctrl+C to stop.")
    _echo()

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
        # Vector installs its own file + in-app logging before this point.
        # Uvicorn's dictConfig would replace it and its colour formatter calls
        # sys.stdout.isatty(), which is exactly what windowed builds lack.
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
