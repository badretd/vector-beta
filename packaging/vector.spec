# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Vector.

Build from the repository root:

    pyinstaller --noconfirm --clean packaging/vector.spec

Outputs:
    dist/Vector/Vector        (Windows: Vector.exe, Linux: Vector)
    dist/Vector.app           (macOS only)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

REPO_ROOT = Path(SPECPATH).resolve().parent  # noqa: F821 - injected by PyInstaller
VERSION = os.environ.get("VECTOR_VERSION", "0.0.0-dev")
ICON_DIR = REPO_ROOT / "packaging" / "icons"

datas: list[tuple[str, str]] = [(str(REPO_ROOT / "web"), "web")]
binaries: list[tuple[str, str]] = []
hiddenimports: list[str] = ["platformdirs", "websockets"]

# Native wheels and their data files.  collect_all() includes package data
# (faster-whisper's Silero ONNX asset, onnxruntime providers, tokenizer
# binaries) as well as hidden imports that static analysis would miss.
for package in (
    "faster_whisper",
    "ctranslate2",
    "onnxruntime",
    "av",
    "tokenizers",
    "huggingface_hub",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

# uvicorn resolves its loop/protocol implementations dynamically.  uvloop is
# intentionally excluded: it is not available on Windows and the asyncio loop
# is all Vector needs.
hiddenimports += [name for name in collect_submodules("uvicorn") if "uvloop" not in name]

if sys.platform == "win32":
    icon = str(ICON_DIR / "vector.ico")
elif sys.platform == "darwin":
    icon = str(ICON_DIR / "vector.icns")
else:
    icon = str(ICON_DIR / "vector.png")

codesign_identity = os.environ.get("MACOS_SIGN_IDENTITY") or None
entitlements_file = os.environ.get("MACOS_ENTITLEMENTS") or None

a = Analysis(
    [str(REPO_ROOT / "main.py")],
    pathex=[str(REPO_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "pytest",
        "uvloop",
        "torch",
        "IPython",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Vector",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=codesign_identity,
    entitlements_file=entitlements_file,
    icon=icon if sys.platform == "win32" else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Vector",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Vector.app",
        icon=icon,
        bundle_identifier="com.badretd.vector",
        version=VERSION,
        info_plist={
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "11.0",
            "LSApplicationCategoryType": "public.app-category.utilities",
            "NSMicrophoneUsageDescription": (
                "Vector transcribes your speech locally. Audio never leaves this computer."
            ),
        },
        codesign_identity=codesign_identity,
        entitlements_file=entitlements_file,
    )
