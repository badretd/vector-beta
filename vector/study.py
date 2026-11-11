"""Study-mode data: sticky notes and a small vocabulary list.

This store is deliberately separate from ``settings.json`` and ``history.json``:
notes and words change often, can be imported/exported on their own, and should
never make the settings file hard to read.
"""
from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import NOTE_COLORS, STUDY_PATH

NOTE_LIMIT = 100
NOTE_TEXT_MAX = 2000
NOTE_WIDTH_MIN = 160
NOTE_WIDTH_MAX = 480
SHARED_NOTE_LIMIT = 8
SHARED_NOTE_CHARS = 300
WORD_LIMIT = 1000
WORD_TERM_MAX = 80
WORD_TEXT_MAX = 500
WORD_SOURCE_MAX = 80


def _now() -> float:
    return time.time()


def _make_id() -> str:
    return uuid.uuid4().hex[:12]


def _text(value: Any, limit: int) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def _clamp_float(value: Any, low: float, high: float, fallback: float) -> float:
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return fallback


def _color(value: Any) -> str:
    color = str(value or "").strip().lower()
    return color if color in NOTE_COLORS else NOTE_COLORS[0]


def _note(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    note_id = str(raw.get("id") or "").strip()[:24] or _make_id()
    created = _clamp_float(raw.get("created_at"), 0, 10**12, _now())
    updated = _clamp_float(raw.get("updated_at"), 0, 10**12, created)
    return {
        "id": note_id,
        "text": _text(raw.get("text"), NOTE_TEXT_MAX),
        "x": round(_clamp_float(raw.get("x"), 0, 100, 8), 2),
        "y": round(_clamp_float(raw.get("y"), 0, 100, 20), 2),
        "width": int(_clamp_float(raw.get("width"), NOTE_WIDTH_MIN, NOTE_WIDTH_MAX, 220)),
        "color": _color(raw.get("color")),
        "share": bool(raw.get("share", False)),
        "created_at": created,
        "updated_at": updated,
    }


def _word(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    term = _text(raw.get("term"), WORD_TERM_MAX)
    if not term:
        return None
    created = _clamp_float(raw.get("created_at"), 0, 10**12, _now())
    updated = _clamp_float(raw.get("updated_at"), 0, 10**12, created)
    return {
        "id": str(raw.get("id") or "").strip()[:24] or _make_id(),
        "term": term,
        "meaning": _text(raw.get("meaning"), WORD_TEXT_MAX),
        "example": _text(raw.get("example"), WORD_TEXT_MAX),
        "language": _text(raw.get("language"), 12),
        "source": _text(raw.get("source"), WORD_SOURCE_MAX),
        "created_at": created,
        "updated_at": updated,
    }


class StudyStore:
    """Thread-safe notes/vocabulary store with atomic persistence."""

    def __init__(self, path: Path = STUDY_PATH) -> None:
        self.path = path
        self._lock = threading.RLock()
        self.notes: list[dict[str, Any]] = []
        self.vocabulary: list[dict[str, Any]] = []
        self.load()

    # -- persistence ----------------------------------------------------

    def load(self) -> None:
        with self._lock:
            self.notes = []
            self.vocabulary = []
            if not self.path.exists():
                return
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return
            if not isinstance(data, dict):
                return
            notes = [_note(item) for item in (data.get("notes") or [])]
            words = [_word(item) for item in (data.get("vocabulary") or [])]
            self.notes = [item for item in notes if item][-NOTE_LIMIT:]
            self.vocabulary = [item for item in words if item][-WORD_LIMIT:]

    def save(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "version": 1,
                "updated_at": _now(),
                "notes": self.notes[-NOTE_LIMIT:],
                "vocabulary": self.vocabulary[-WORD_LIMIT:],
            }
            tmp = self.path.with_suffix(f".tmp.{os.getpid()}")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self.path)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "version": 1,
                "notes": copy.deepcopy(self.notes),
                "vocabulary": copy.deepcopy(self.vocabulary),
            }

    def replace(self, data: dict[str, Any]) -> dict[str, Any]:
        """Replace the whole study document, used by import and tests."""
        if not isinstance(data, dict):
            data = {}
        notes = [_note(item) for item in (data.get("notes") or [])]
        words = [_word(item) for item in (data.get("vocabulary") or [])]
        with self._lock:
            self.notes = [item for item in notes if item][-NOTE_LIMIT:]
            self.vocabulary = [item for item in words if item][-WORD_LIMIT:]
            self.save()
            return self.snapshot()

    # -- notes ----------------------------------------------------------

    def add_note(self, raw: dict[str, Any] | None = None) -> dict[str, Any]:
        raw = raw or {}
        note = _note({**raw, "id": "", "created_at": _now(), "updated_at": _now()})
        assert note is not None
        with self._lock:
            self.notes.append(note)
            self.notes = self.notes[-NOTE_LIMIT:]
            self.save()
            return copy.deepcopy(note)

    def update_note(self, note_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(patch, dict):
            return None
        with self._lock:
            for index, note in enumerate(self.notes):
                if note["id"] != note_id:
                    continue
                merged = {**note, **patch, "id": note_id, "updated_at": _now()}
                clean = _note(merged)
                if clean is None:
                    return None
                self.notes[index] = clean
                self.save()
                return copy.deepcopy(clean)
            return None

    def delete_note(self, note_id: str) -> bool:
        with self._lock:
            before = len(self.notes)
            self.notes = [note for note in self.notes if note["id"] != note_id]
            changed = len(self.notes) != before
            if changed:
                self.save()
            return changed

    def shared_notes(self) -> list[str]:
        """Return the notes the study prompt is allowed to see."""
        with self._lock:
            out: list[str] = []
            for note in self.notes:
                if not note.get("share"):
                    continue
                text = note.get("text", "").strip()
                if not text:
                    continue
                out.append(text[:SHARED_NOTE_CHARS])
                if len(out) >= SHARED_NOTE_LIMIT:
                    break
            return out

    # -- vocabulary -----------------------------------------------------

    def add_word(self, raw: dict[str, Any] | None = None) -> dict[str, Any] | None:
        raw = raw or {}
        word = _word({**raw, "id": "", "created_at": _now(), "updated_at": _now()})
        if word is None:
            return None
        with self._lock:
            self.vocabulary.append(word)
            self.vocabulary = self.vocabulary[-WORD_LIMIT:]
            self.save()
            return copy.deepcopy(word)

    def update_word(self, word_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(patch, dict):
            return None
        with self._lock:
            for index, word in enumerate(self.vocabulary):
                if word["id"] != word_id:
                    continue
                merged = {**word, **patch, "id": word_id, "updated_at": _now()}
                clean = _word(merged)
                if clean is None:
                    raise ValueError("term cannot be empty")
                self.vocabulary[index] = clean
                self.save()
                return copy.deepcopy(clean)
            return None

    def delete_word(self, word_id: str) -> bool:
        with self._lock:
            before = len(self.vocabulary)
            self.vocabulary = [word for word in self.vocabulary if word["id"] != word_id]
            changed = len(self.vocabulary) != before
            if changed:
                self.save()
            return changed

    def clear_vocabulary(self) -> None:
        with self._lock:
            self.vocabulary = []
            self.save()
