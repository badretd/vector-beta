"""Configuration handling for Vector 2.

Settings are a nested JSON document stored under ``data/settings.json``.
Defaults are intentionally calm: every knob the UI exposes has a safe value,
unknown/older keys are preserved across upgrades, and a bad import can never
brick the app.
"""
from __future__ import annotations

import copy
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from .characters import (
    CHARACTER_PACKS,
    CUSTOM_PACK_ID,
    MAX_CUSTOM_NAME,
    MAX_CUSTOM_PROMPT,
    PACK_IDS,
    SKIN_IDS,
    pack_for_legacy,
    resolve_character,
)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("VECTOR_DATA_DIR", ROOT / "data")).expanduser()
WEB_DIR = ROOT / "web"
SETTINGS_PATH = DATA_DIR / "settings.json"
HISTORY_PATH = DATA_DIR / "history.json"
LOG_DIR = DATA_DIR / "logs"

# The default face is a tiny white-on-black pixel sprite. The palette is kept
# separate from the UI theme so a paper room can have a mint face, or a mint
# room can have a cream face.
DEFAULT_PALETTE = {
    "ink": "#f2f2f2",
    "inkSoft": "#8a8a8a",
    "pupil": "#000000",
    "mouth": "#f2f2f2",
    "blush": "#c98b8b",
    "tear": "#9db8c8",
    "sparkle": "#d8d8d8",
    "accent": "#e6c06a",
    "accent2": "#d8d8d8",
    "glow": "#ffffff",
}

LANGUAGES = ("auto", "en", "ru", "de", "es", "fr", "uk", "pl", "it", "pt", "zh", "ja")
THEMES = ("mono", "mint", "paper")
FACE_STYLES = ("original", "pixel")
PALETTES = ("mono", "mint", "paper")

DEFAULTS: dict[str, Any] = {
    "version": 3,
    "app": {
        "language": "en",
        "theme": "mono",
        "onboarded": False,
        "pack_chosen": False,
        "reduced_motion": False,
        "sound": True,
        "ui_scale": 1.0,
        "first_run_hint": True,
    },
    "character": {
        "pack": "vector",
        "custom": {
            "name": "",
            "prompt": "",
            "skin": "vector12",
            "palette": "mono",
        },
    },
    "llm": {
        "base_url": "http://127.0.0.1:11434",
        "model": "qwen2.5:3b",
        "temperature": 0.85,
        "top_p": 0.9,
        "num_ctx": 4096,
        "max_tokens": 180,
        "history_turns": 10,
        "timeout_s": 180,
        "keep_alive": "30m",
        "seed": -1,
        "mock": False,
    },
    "asr": {
        "enabled": True,
        "model": "small",
        "device": "auto",
        "compute_type": "auto",
        "language": "auto",
        "beam_size": 5,
        "live_partials": True,
        "partial_interval_ms": 1000,
        "vad": "silero",
        "vad_sensitivity": 0.55,
        "silence_ms": 900,
        "min_speech_ms": 260,
        "max_utterance_s": 30,
        "pre_roll_ms": 300,
    },
    "input": {
        "mode": "silence",
        "hotkey": "F2",
        "auto": {
            "threshold": 3,
            "force_after_ms": 6500,
            "max_buffer_chars": 700,
            "question_boost": True,
            "name_boost": True,
            "keywords": [],
            "ignore_keywords": [],
        },
    },
    "persona": {
        "preset": "vector",
        "name": "",
        "user_name": "",
        "custom": "",
        "reply_language": "auto",
        "verbosity": "short",
        "playfulness": 0.8,
        "warmth": 0.8,
        "curiosity": 0.9,
    },
    "face": {
        "skin": "vector12",
        "style": "original",
        "palette_name": "mono",
        "palette": {},
        "scale": 1.0,
        "separation": "inset",
        "eye_tracking": True,
        "blink": True,
        "breathing": True,
        "particles": False,
        "glow": False,
        "antenna": False,
    },
    "engagement": {
        "proactive": True,
        "idle_min_seconds": 150,
        "proactive_max_per_hour": 4,
        "mood": True,
        "affection": 50,
        "curiosity": 70,
        "energy": 75,
        "remember_facts": True,
        "mirror_user_emotion": True,
        "sleep_after_minutes": 4,
    },
    "debug": {
        "hotkey": "Ctrl+Shift+D",
        "log_level": "INFO",
    },
}


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge *patch* into a copy of *base*.

    Lists are replaced wholesale (that is what a user expects from keyword
    lists and palettes). ``None`` deletes a key.
    """
    out = copy.deepcopy(base)
    for key, value in patch.items():
        if value is None:
            out.pop(key, None)
        elif isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def _color(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text if _HEX_RE.match(text) else fallback


def migrate_legacy_character(raw: dict[str, Any], merged: dict[str, Any]) -> dict[str, Any]:
    """Give settings written before character packs a sensible initial pack.

    Existing users see the pack chooser once because their old preset may have
    been removed. Their history and every other setting are untouched.
    """
    persona = raw.get("persona") if isinstance(raw.get("persona"), dict) else {}
    face = raw.get("face") if isinstance(raw.get("face"), dict) else {}
    pack_id = pack_for_legacy(persona.get("preset", "vector"), face.get("style", "original"))
    pack = CHARACTER_PACKS[pack_id]
    merged.setdefault("character", {})["pack"] = pack_id
    merged["face"]["skin"] = pack.skin
    merged["face"]["style"] = "original" if pack.skin == "vector12" else "pixel"
    old_name = str(persona.get("name") or "").strip()
    if old_name and old_name not in {"Vector", "MOSS", "Lumen", "Nib", "ZIP"}:
        merged["persona"]["name"] = old_name[:40]
    else:
        merged["persona"]["name"] = pack.name
    merged["persona"]["preset"] = pack_id
    # Show the pack chooser once, even for people who finished onboarding
    # before character packs existed.
    merged["app"]["pack_chosen"] = False
    return merged


def sanitize(settings: dict[str, Any]) -> dict[str, Any]:
    """Keep values inside sane ranges so a bad import cannot brick the app."""
    try:
        s = settings
        s["app"]["ui_scale"] = _clamp(float(s["app"].get("ui_scale", 1.0)), 0.75, 1.6)
        s["app"]["onboarded"] = bool(s["app"].get("onboarded", False))
        s["app"]["pack_chosen"] = bool(s["app"].get("pack_chosen", False))
        s["app"]["reduced_motion"] = bool(s["app"].get("reduced_motion", False))
        s["app"]["sound"] = bool(s["app"].get("sound", True))
        s["app"]["first_run_hint"] = bool(s["app"].get("first_run_hint", True))

        character = s.setdefault("character", {})
        if not isinstance(character, dict):
            character = {}
        pack = str(character.get("pack") or "vector").strip().lower()
        if pack not in PACK_IDS:
            pack = "vector"
        character["pack"] = pack
        custom = character.get("custom")
        if not isinstance(custom, dict):
            custom = {}
        custom["name"] = str(custom.get("name") or "").strip()[:MAX_CUSTOM_NAME]
        custom["prompt"] = str(custom.get("prompt") or "").strip()[:MAX_CUSTOM_PROMPT]
        custom_skin = str(custom.get("skin") or "vector12").strip().lower()
        if custom_skin not in SKIN_IDS:
            custom_skin = "vector12"
        custom["skin"] = custom_skin
        custom_palette = str(custom.get("palette") or "mono").strip().lower()
        if custom_palette == "ink":
            custom_palette = "mono"
        if custom_palette not in PALETTES:
            custom_palette = "mono"
        custom["palette"] = custom_palette
        character["custom"] = custom
        s["character"] = character
        resolved = resolve_character(s)
        s["face"]["skin"] = resolved["skin"]
        s["face"]["style"] = "original" if resolved["skin"] == "vector12" else "pixel"
        previous_preset = str(s["persona"].get("preset") or "")
        persona_name = str(s["persona"].get("name") or "").strip()[:40]
        previous_pack = CHARACTER_PACKS.get(previous_preset)
        if (
            pack != CUSTOM_PACK_ID
            and previous_pack is not None
            and previous_pack.name == persona_name
        ):
            persona_name = resolved["name"]
        s["persona"]["name"] = persona_name
        s["persona"]["preset"] = pack if pack != CUSTOM_PACK_ID else "vector"

        s["llm"]["temperature"] = _clamp(float(s["llm"]["temperature"]), 0.0, 2.0)
        s["llm"]["top_p"] = _clamp(float(s["llm"]["top_p"]), 0.05, 1.0)
        s["llm"]["num_ctx"] = int(_clamp(int(s["llm"]["num_ctx"]), 512, 131072))
        s["llm"]["max_tokens"] = int(_clamp(int(s["llm"]["max_tokens"]), 32, 4096))
        s["llm"]["history_turns"] = int(_clamp(int(s["llm"]["history_turns"]), 0, 60))
        s["llm"]["timeout_s"] = int(_clamp(int(s["llm"].get("timeout_s", 180)), 10, 600))
        s["llm"]["mock"] = bool(s["llm"].get("mock", False))

        s["asr"]["beam_size"] = int(_clamp(int(s["asr"]["beam_size"]), 1, 10))
        s["asr"]["silence_ms"] = int(_clamp(int(s["asr"]["silence_ms"]), 250, 5000))
        s["asr"]["min_speech_ms"] = int(_clamp(int(s["asr"]["min_speech_ms"]), 80, 2000))
        s["asr"]["max_utterance_s"] = int(_clamp(int(s["asr"]["max_utterance_s"]), 3, 120))
        s["asr"]["partial_interval_ms"] = int(_clamp(int(s["asr"]["partial_interval_ms"]), 300, 5000))
        s["asr"]["vad_sensitivity"] = _clamp(float(s["asr"]["vad_sensitivity"]), 0.0, 1.0)
        s["asr"]["live_partials"] = bool(s["asr"].get("live_partials", True))
        s["asr"]["enabled"] = bool(s["asr"].get("enabled", True))

        s["input"]["auto"]["threshold"] = int(_clamp(int(s["input"]["auto"]["threshold"]), 1, 10))
        s["input"]["auto"]["force_after_ms"] = int(_clamp(int(s["input"]["auto"]["force_after_ms"]), 500, 30000))
        s["face"]["scale"] = _clamp(float(s["face"]["scale"]), 0.6, 1.8)
        if s["face"].get("separation") == "auto":
            # The old "auto" meant a whole-cell gap. It now means the softer
            # edge inset, so existing settings migrate without a version bump.
            s["face"]["separation"] = "inset"
        if s["face"].get("separation") not in ("inset", "gap", "trim", "off"):
            s["face"]["separation"] = "inset"
        s["engagement"]["idle_min_seconds"] = int(_clamp(int(s["engagement"]["idle_min_seconds"]), 20, 3600))
        s["engagement"]["sleep_after_minutes"] = int(_clamp(int(s["engagement"]["sleep_after_minutes"]), 1, 120))
        for key in ("affection", "curiosity", "energy"):
            s["engagement"][key] = int(_clamp(int(s["engagement"][key]), 0, 100))

        if s["input"]["mode"] not in ("silence", "hotkey", "auto"):
            s["input"]["mode"] = "silence"

        for key in ("keywords", "ignore_keywords"):
            value = s["input"]["auto"].get(key, [])
            if isinstance(value, str):
                value = [part.strip() for part in value.replace("\n", ",").split(",") if part.strip()]
            if not isinstance(value, list):
                value = []
            s["input"]["auto"][key] = [str(v).strip() for v in value if str(v).strip()][:80]

        if s["app"].get("theme") == "ink":
            s["app"]["theme"] = "mono"
        if s["app"].get("theme") not in THEMES:
            s["app"]["theme"] = "mono"
        if s["face"].get("style") == "minimal":
            s["face"]["style"] = "original"
        if s["face"].get("style") not in FACE_STYLES:
            s["face"]["style"] = "original"
        if s["face"].get("palette_name") == "ink":
            s["face"]["palette_name"] = "mono"
        if s["face"].get("palette_name") not in PALETTES:
            s["face"]["palette_name"] = "mono"

        palette = s["face"].get("palette")
        if not isinstance(palette, dict):
            palette = {}
        clean_palette: dict[str, str] = {}
        for key, fallback in DEFAULT_PALETTE.items():
            if key in palette:
                clean_palette[key] = _color(palette[key], fallback)
        s["face"]["palette"] = clean_palette

        if s["asr"]["language"] not in LANGUAGES:
            s["asr"]["language"] = "auto"
        if s["persona"]["reply_language"] not in LANGUAGES:
            s["persona"]["reply_language"] = "auto"
        if s["persona"].get("verbosity") not in ("short", "medium"):
            s["persona"]["verbosity"] = "short"
    except (KeyError, TypeError, ValueError):
        return copy.deepcopy(DEFAULTS)
    return s


class SettingsStore:
    """Thread-safe settings holder with atomic disk persistence."""

    def __init__(self, path: Path = SETTINGS_PATH) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._settings: dict[str, Any] = copy.deepcopy(DEFAULTS)
        self.load()

    def load(self) -> dict[str, Any]:
        with self._lock:
            if self.path.exists():
                try:
                    raw = json.loads(self.path.read_text(encoding="utf-8"))
                    if not isinstance(raw, dict):
                        raise ValueError("settings must be an object")
                    merged = _deep_merge(DEFAULTS, raw)
                    if "character" not in raw:
                        merged = migrate_legacy_character(raw, merged)
                    self._settings = sanitize(merged)
                except (OSError, json.JSONDecodeError, ValueError):
                    self._settings = copy.deepcopy(DEFAULTS)
            else:
                self._settings = copy.deepcopy(DEFAULTS)
            return copy.deepcopy(self._settings)

    def all(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._settings)

    def get(self, path: str, default: Any = None) -> Any:
        cur: Any = self.all()
        for part in path.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur

    def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            merged = _deep_merge(self._settings, patch)
            self._settings = sanitize(merged)
            self.save_locked()
            return copy.deepcopy(self._settings)

    def replace(self, settings: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._settings = sanitize(_deep_merge(DEFAULTS, settings))
            self.save_locked()
            return copy.deepcopy(self._settings)

    def reset(self) -> dict[str, Any]:
        with self._lock:
            self._settings = copy.deepcopy(DEFAULTS)
            self.save_locked()
            return copy.deepcopy(self._settings)

    def save_locked(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(f".tmp.{os.getpid()}")
        tmp.write_text(
            json.dumps(self._settings, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(self.path)
        # Remember when the file was touched for the debug panel.
        self._settings.setdefault("_meta", {})
        self._settings["_meta"]["saved_at"] = time.time()


def settings_for_client(settings: dict[str, Any]) -> dict[str, Any]:
    """Remove server-only bits before sending settings to the browser."""
    out = copy.deepcopy(settings)
    out.pop("_meta", None)
    return out
