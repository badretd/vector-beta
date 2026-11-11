"""Filesystem locations for source checkouts and frozen (PyInstaller) builds.

A source checkout keeps everything inside the repository: ``web/`` is read
from the project root and ``data/`` sits next to it.  An installed build must
not write into the installation directory (``Program Files`` is read-only),
so settings, history, logs and downloaded models go to the per-user data
directory instead.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "Vector"


def is_frozen() -> bool:
    """True when running from a PyInstaller bundle."""
    return bool(getattr(sys, "frozen", False))


def resource_dir() -> Path:
    """Read-only directory that contains bundled resources such as ``web/``.

    PyInstaller points ``sys._MEIPASS`` at the extracted ``_internal`` folder
    in both one-file and one-folder builds.  In a source checkout, the
    repository root is the parent of the ``vector`` package.
    """
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        return Path(bundled)
    return Path(__file__).resolve().parent.parent


def writable_data_dir() -> Path:
    """Per-user directory for settings, history, logs and Whisper models.

    ``VECTOR_DATA_DIR`` (also set by ``--data-dir``) always wins.  Development
    runs keep using ``<repo>/data``; frozen builds use the OS convention:

    * Windows: ``%LOCALAPPDATA%\\Vector``
    * macOS:   ``~/Library/Application Support/Vector``
    * Linux:   ``$XDG_DATA_HOME/Vector`` (usually ``~/.local/share/Vector``)
    """
    override = os.environ.get("VECTOR_DATA_DIR")
    if override:
        return Path(override).expanduser()
    if not is_frozen():
        return resource_dir() / "data"

    try:
        from platformdirs import user_data_dir
    except ImportError:  # pragma: no cover - only possible in a broken build
        # Keep the app usable even if the (tiny, pure-Python) dependency was
        # not collected by the packager.
        if sys.platform == "win32":
            base = Path(os.environ.get("LOCALAPPDATA") or Path.home())
        elif sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path(
                os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share"
            )
        return base / APP_NAME
    return Path(user_data_dir(APP_NAME, appauthor=False))
