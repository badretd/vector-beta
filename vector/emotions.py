"""Emotion protocol: tags, streaming parser, and lightweight text inference.

The LLM is asked to mark segments with tags such as ``[curious]``.  Small local
models are not always obedient, so the parser also accepts ``<curious>``,
``*curious*``, ``(curious)`` and ``[emotion: curious]``.  Unknown tags are left
alone as ordinary text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

# The canonical set. Keep this in sync with web/js/emotions.js.
EMOTIONS: dict[str, dict] = {
    "neutral": {"en": "neutral", "ru": "спокойствие", "color": "#9fb8b1"},
    "happy": {"en": "happy", "ru": "радость", "color": "#ffd166"},
    "excited": {"en": "excited", "ru": "восторг", "color": "#ffb703"},
    "curious": {"en": "curious", "ru": "любопытство", "color": "#7dffc4"},
    "thinking": {"en": "thinking", "ru": "размышление", "color": "#8ecae6"},
    "sad": {"en": "sad", "ru": "грусть", "color": "#7ad7ff"},
    "surprised": {"en": "surprised", "ru": "удивление", "color": "#ffd60a"},
    "confused": {"en": "confused", "ru": "недоумение", "color": "#c7a5ff"},
    "sleepy": {"en": "sleepy", "ru": "сонливость", "color": "#a0a8ff"},
    "angry": {"en": "angry", "ru": "злость", "color": "#ff6b6b"},
    "embarrassed": {"en": "embarrassed", "ru": "смущение", "color": "#ff8fa3"},
    "love": {"en": "love", "ru": "нежность", "color": "#ff5d8f"},
    "proud": {"en": "proud", "ru": "гордость", "color": "#ffc857"},
    "scared": {"en": "scared", "ru": "испуг", "color": "#b8a1ff"},
    "bored": {"en": "bored", "ru": "скука", "color": "#8d99ae"},
    "wink": {"en": "wink", "ru": "подмигивание", "color": "#ffd166"},
    "laugh": {"en": "laugh", "ru": "смех", "color": "#ffe066"},
    "glitch": {"en": "glitch", "ru": "глюк", "color": "#ff4d6d"},
    "listening": {"en": "listening", "ru": "внимание", "color": "#7dffc4"},
    "processing": {"en": "processing", "ru": "обработка", "color": "#8ecae6"},
}

ALIASES: dict[str, str] = {
    "joy": "happy",
    "joyful": "happy",
    "glad": "happy",
    "cheerful": "happy",
    "amused": "laugh",
    "laughing": "laugh",
    "laughs": "laugh",
    "laughter": "laugh",
    "haha": "laugh",
    "lol": "laugh",
    "interest": "curious",
    "interested": "curious",
    "question": "confused",
    "puzzled": "confused",
    "uncertain": "confused",
    "fear": "scared",
    "afraid": "scared",
    "anxious": "scared",
    "shy": "embarrassed",
    "blush": "embarrassed",
    "flustered": "embarrassed",
    "loving": "love",
    "affection": "love",
    "adore": "love",
    "tired": "sleepy",
    "drowsy": "sleepy",
    "annoyed": "angry",
    "mad": "angry",
    "furious": "angry",
    "wow": "surprised",
    "shock": "surprised",
    "shocked": "surprised",
    "calm": "neutral",
    "ok": "neutral",
    "normal": "neutral",
    "smile": "happy",
    "smiling": "happy",
    "grin": "happy",
    "sigh": "bored",
    "yawn": "sleepy",
    "cry": "sad",
    "crying": "sad",
    "tears": "sad",
    "proudly": "proud",
    "smug": "proud",
    "winking": "wink",
    "glitching": "glitch",
    "error": "glitch",
    "listening": "listening",
    "thinking": "thinking",
    "hmm": "thinking",
    "processing": "processing",
    "loading": "processing",
}

def canonical_emotion(name: str | None) -> str | None:
    if not name:
        return None
    raw = name.strip().lower()
    if ":" in raw:
        raw = raw.split(":", 1)[1]
    if "=" in raw:
        raw = raw.split("=", 1)[1]
    key = re.sub(r"[^a-z_]", "", raw)
    if not key:
        return None
    if key in EMOTIONS:
        return key
    if key in ALIASES:
        return ALIASES[key]
    # tolerate simple plurals / -ly
    for suffix in ("ing", "ed", "ly", "s"):
        if key.endswith(suffix) and key[: -len(suffix)] in ALIASES:
            return ALIASES[key[: -len(suffix)]]
    return None


@dataclass
class Segment:
    text: str
    emotion: str | None = None


@dataclass
class ParseResult:
    segments: list[Segment] = field(default_factory=list)
    emotions: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "".join(seg.text for seg in self.segments)


_OPENERS = {"[": "]", "<": ">", "*": "*", "(": ")"}
_TAG_BODY = re.compile(r"^\s*(?:emotion\s*[:=]\s*)?([a-zA-Z][a-zA-Z_\- ]{0,26})\s*$")


class EmotionStreamParser:
    """Incremental parser that never leaks a half-received tag to the UI."""

    def __init__(self) -> None:
        self._buf = ""
        self.segments: list[Segment] = []
        self.emotions: list[str] = []

    def feed(self, chunk: str) -> list[tuple[str, str | None]]:
        """Return a list of ``(kind, value)`` where kind is text or emotion."""
        self._buf += chunk
        out: list[tuple[str, str | None]] = []
        i = 0
        n = len(self._buf)
        while i < n:
            ch = self._buf[i]
            if ch in _OPENERS:
                close = _OPENERS[ch]
                end = self._buf.find(close, i + 1)
                if end == -1:
                    # Could be an incomplete tag at the tail. Hold it if short.
                    if n - i <= 34:
                        break
                    out.append(("text", ch))
                    i += 1
                    continue
                body = self._buf[i + 1 : end]
                emotion = canonical_emotion(body) if _TAG_BODY.match(body) else None
                # Parentheses are common in normal prose; only accept exact
                # single-word emotion names to avoid eating "(really)".
                if ch == "(" and (emotion is None or len(body.strip().split()) != 1):
                    emotion = None
                if emotion:
                    out.append(("emotion", emotion))
                    if not self.emotions or self.emotions[-1] != emotion:
                        self.emotions.append(emotion)
                    self._buf = self._buf[end + 1 :]
                    n = len(self._buf)
                    i = 0
                    continue
                # Unknown tag: keep the opening character as text.
                out.append(("text", ch))
                self._add_text(ch)
                i += 1
                continue
            # Consume a run of ordinary characters.
            j = i
            while j < n and self._buf[j] not in _OPENERS:
                j += 1
            if j > i:
                text = self._buf[i:j]
                out.append(("text", text))
                self._add_text(text)
                i = j
            else:
                out.append(("text", ch))
                self._add_text(ch)
                i += 1
        self._buf = self._buf[i:]
        # If we broke on an incomplete opener, everything before it is in `out`
        # already; `_buf` retains only the possible tag tail.
        return out

    def flush(self) -> list[tuple[str, str | None]]:
        out: list[tuple[str, str | None]] = []
        if self._buf:
            out.append(("text", self._buf))
            self._add_text(self._buf)
            self._buf = ""
        return out

    def _add_text(self, text: str) -> None:
        if not text:
            return
        if self.segments and self.segments[-1].emotion is None:
            self.segments[-1].text += text
        else:
            self.segments.append(Segment(text=text))


def parse_emotions(text: str) -> ParseResult:
    parser = EmotionStreamParser()
    parser.feed(text)
    parser.flush()
    return ParseResult(segments=parser.segments, emotions=parser.emotions)


# --------------------------------------------------------------------------
# Lightweight inference (used when the model forgets its tags)
# --------------------------------------------------------------------------

_POSITIVE = {
    "love", "like", "great", "awesome", "amazing", "wonderful", "happy", "glad",
    "thanks", "thank", "beautiful", "cute", "sweet", "nice", "fun", "cool",
    "рад", "рада", "люблю", "нравится", "здорово", "класс", "спасибо", "мило",
    "прекрасно", "отлично", "хорошо", "обожаю", "круто", "интересно",
}
_NEGATIVE = {
    "sad", "bad", "hate", "angry", "upset", "awful", "terrible", "tired",
    "lonely", "scared", "afraid", "sorry", "hurt", "cry", "worse", "worst",
    "грустно", "плохо", "ненавижу", "злой", "устал", "устала", "страшно",
    "одиноко", "больно", "жаль", "ужасно", "хуже",
}
_CURIOUS = {
    "what", "why", "how", "who", "where", "when", "really", "interesting",
    "tell", "explain", "что", "почему", "как", "кто", "где", "когда", "правда",
    "интересно", "расскажи", "объясни",
}
_SURPRISED = {"wow", "whoa", "really", "omg", "ого", "вау", "серьёзно", "правда"}
_LAUGH = {"haha", "lol", "hehe", "хаха", "хехе", "ахах"}


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-zа-яё]+", text.lower()))


def infer_emotion(text: str) -> str:
    words = _words(text)
    if words & _LAUGH:
        return "laugh"
    if words & _SURPRISED:
        return "surprised"
    pos = len(words & _POSITIVE)
    neg = len(words & _NEGATIVE)
    cur = len(words & _CURIOUS)
    if text.rstrip().endswith("?") or cur > pos + neg:
        return "curious"
    if pos > neg:
        return "happy"
    if neg > pos:
        return "sad"
    return "neutral"


def user_sentiment(text: str) -> float:
    """Return -1..1, used for Vector's mood and the face's mirror reaction."""
    words = _words(text)
    pos = len(words & _POSITIVE)
    neg = len(words & _NEGATIVE)
    if pos == neg == 0:
        if text.rstrip().endswith("?"):
            return 0.15
        return 0.0
    return max(-1.0, min(1.0, (pos - neg) / max(1, pos + neg)))


def emotion_payload() -> list[dict]:
    """Metadata for the frontend (stable order, no aliases)."""
    return [{"id": name, **meta} for name, meta in EMOTIONS.items()]


def emotion_tag_help() -> str:
    # listening/processing are internal face states; the model should use the
    # expressive set so its first tag does not look like a system status.
    expressive = ("neutral", "happy", "excited", "curious", "thinking", "sad",
                  "surprised", "confused", "sleepy", "angry", "embarrassed",
                  "love", "proud", "scared", "bored", "wink", "laugh", "glitch")
    return " ".join(f"[{name}]" for name in expressive)
