"""Conversation state, auto-submit heuristics, memory, and turn orchestration."""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from .config import HISTORY_PATH, SettingsStore
from .emotions import (
    EmotionStreamParser,
    infer_emotion,
    user_sentiment,
)
from .llm import LLMError, LLMRouter
from .prompts import (
    build_system_prompt,
    poke_instruction,
    proactive_instruction,
    wake_instruction,
)

Broadcast = Callable[[dict[str, Any]], Awaitable[None]]


def now() -> float:
    return time.time()


def make_id() -> str:
    return uuid.uuid4().hex[:12]


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------

class ConversationStore:
    def __init__(self, path: Path = HISTORY_PATH) -> None:
        self.path = path
        self.messages: list[dict[str, Any]] = []
        self.facts: list[str] = []
        self.user_name: str = ""
        self.started_at = now()
        self.stats: dict[str, Any] = {
            "user_messages": 0,
            "assistant_messages": 0,
            "user_chars": 0,
            "assistant_chars": 0,
            "sessions": 1,
        }
        self.load()

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        self.messages = list(data.get("messages") or [])
        self.facts = [str(f) for f in (data.get("facts") or [])][:60]
        self.user_name = str(data.get("user_name") or "")
        self.started_at = float(data.get("started_at") or now())
        self.stats.update(data.get("stats") or {})
        self.stats["sessions"] = int(self.stats.get("sessions", 1))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": 1,
            "started_at": self.started_at,
            "updated_at": now(),
            "messages": self.messages[-1000:],
            "facts": self.facts,
            "user_name": self.user_name,
            "stats": self.stats,
        }
        tmp = self.path.with_suffix(f".tmp.{os.getpid()}")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def add(
        self,
        role: str,
        text: str,
        *,
        emotions: list[str] | None = None,
        lang: str = "",
        kind: str = "chat",
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        message = {
            "id": make_id(),
            "role": role,
            "text": text,
            "ts": now(),
            "emotions": emotions or [],
            "lang": lang,
            "kind": kind,
        }
        if meta:
            message["meta"] = meta
        self.messages.append(message)
        if len(self.messages) > 1200:
            self.messages = self.messages[-1000:]
        key = "user" if role == "user" else "assistant"
        self.stats[f"{key}_messages"] = int(self.stats.get(f"{key}_messages", 0)) + 1
        self.stats[f"{key}_chars"] = int(self.stats.get(f"{key}_chars", 0)) + len(text)
        return message

    def recent(self, count: int) -> list[dict[str, Any]]:
        if count <= 0:
            return []
        return self.messages[-count:]

    def clear(self) -> None:
        self.messages = []
        self.started_at = now()
        self.stats.update(
            {"user_messages": 0, "assistant_messages": 0, "user_chars": 0, "assistant_chars": 0}
        )
        self.save()

    def snapshot(self) -> dict[str, Any]:
        return {
            "messages": self.messages[-400:],
            "facts": self.facts,
            "user_name": self.user_name,
            "started_at": self.started_at,
            "stats": self.stats,
        }


# --------------------------------------------------------------------------
# Auto-submit judge
# --------------------------------------------------------------------------

_EN_INTERROGATIVE = {
    "what", "why", "how", "who", "where", "when", "which", "whose", "whom",
    "can", "could", "would", "will", "should", "do", "does", "did", "are", "is",
    "am", "was", "were", "have", "has", "had", "may", "might", "shall",
}
_RU_INTERROGATIVE = {
    "что", "почему", "зачем", "как", "кто", "где", "когда", "какой", "какая",
    "какое", "какие", "который", "чей", "сколько", "можно", "можешь", "может",
    "будешь", "есть", "правда", "разве", "неужели", "давай", "расскажи",
    "объясни", "скажи", "помоги", "хочешь", "знаешь", "думаешь", "любишь",
}
_EN_GREETING = {
    "hi", "hello", "hey", "yo", "hiya", "morning", "evening", "good", "bye",
    "goodbye", "night", "thanks", "thank", "please",
}
_RU_GREETING = {
    "привет", "здравствуй", "здравствуйте", "хай", "доброе", "добрый", "утро",
    "вечер", "пока", "прощай", "спасибо", "пожалуйста", "спокойной",
}
_EN_BACKCHANNEL = {
    "ok", "okay", "yes", "yeah", "yep", "no", "nope", "sure", "right", "hmm",
    "mm", "mhm", "uh", "um", "ah", "oh", "i", "see", "cool", "nice",
}
_RU_BACKCHANNEL = {
    "да", "нет", "угу", "ага", "ок", "окей", "хорошо", "ясно", "понял",
    "поняла", "мм", "мгм", "эм", "ну", "вот", "так", "конечно",
}
_INCOMPLETE_END = {
    "and", "but", "or", "because", "so", "if", "that", "which", "when", "while",
    "и", "но", "или", "потому", "что", "если", "который", "которая", "когда",
    "пока", "чтобы", "как", "чем",
}
_EN_NAME = {"vector", "vect", "вектор"}
_EN_REQUEST = {
    "tell", "show", "explain", "help", "give", "let", "make", "find", "remember",
    "listen", "look", "come", "stay", "talk", "say", "imagine", "pretend",
}
_RU_REQUEST = {
    "расскажи", "покажи", "объясни", "помоги", "дай", "давай", "сделай",
    "найди", "запомни", "послушай", "посмотри", "поговори", "скажи",
    "представь", "останься",
}


@dataclass
class AutoDecision:
    send: bool
    score: int
    reasons: list[str] = field(default_factory=list)
    language: str = "en"

    def as_dict(self) -> dict[str, Any]:
        return {
            "send": self.send,
            "score": self.score,
            "reasons": self.reasons,
            "language": self.language,
        }


def detect_language(text: str) -> str:
    if re.search(r"[а-яА-ЯёЁ]", text):
        return "ru"
    return "en"


class AutoSendJudge:
    """Scores whether an utterance is addressed to Vector.

    This is intentionally explainable: the debug panel shows every point.
    """

    def judge(
        self,
        text: str,
        *,
        settings: dict[str, Any],
        pending_question: bool = False,
    ) -> AutoDecision:
        raw = text.strip()
        if not raw:
            return AutoDecision(False, -99, ["empty"], "en")
        lang = detect_language(raw)
        low = raw.lower()
        words = re.findall(r"[a-zа-яё']+", low)
        wordset = set(words)
        score = 0
        reasons: list[str] = []
        cfg = settings.get("input", {}).get("auto", {})

        custom = [str(k).lower().strip() for k in cfg.get("keywords", []) if str(k).strip()]
        ignored = [str(k).lower().strip() for k in cfg.get("ignore_keywords", []) if str(k).strip()]
        if any(k in low for k in ignored):
            return AutoDecision(False, -10, ["ignored keyword"], lang)
        hits = [k for k in custom if k in low]
        if hits:
            score += 5
            reasons.append(f"custom keyword +5 ({', '.join(hits[:3])})")

        name_hit = bool(wordset & _EN_NAME) or "вектор" in low
        if name_hit and cfg.get("name_boost", True):
            score += 4
            reasons.append("called by name +4")

        if cfg.get("question_boost", True):
            if raw.rstrip().endswith("?"):
                score += 3
                reasons.append("question mark +3")

            interrogatives = _RU_INTERROGATIVE if lang == "ru" else _EN_INTERROGATIVE
            inter_hits = wordset & interrogatives
            if inter_hits:
                score += 2
                reasons.append(f"interrogative +2 ({', '.join(sorted(inter_hits)[:3])})")

        greetings = _RU_GREETING if lang == "ru" else _EN_GREETING
        greet_hits = wordset & greetings
        if greet_hits:
            score += 2
            reasons.append(f"greeting/thanks +2 ({', '.join(sorted(greet_hits)[:3])})")

        requests = _RU_REQUEST if lang == "ru" else _EN_REQUEST
        req_hits = wordset & requests
        if req_hits:
            score += 2
            reasons.append(f"request verb +2 ({', '.join(sorted(req_hits)[:3])})")

        if pending_question:
            score += 3
            reasons.append("Vector asked a question +3")

        if len(words) >= 12:
            score += 1
            reasons.append("long utterance +1")

        if words and words[-1] in _INCOMPLETE_END:
            score -= 3
            reasons.append("trailing conjunction -3")

        backchannels = _RU_BACKCHANNEL if lang == "ru" else _EN_BACKCHANNEL
        if len(words) <= 3 and wordset and wordset <= backchannels and not pending_question:
            score -= 3
            reasons.append("backchannel -3")

        if len(words) <= 2 and not name_hit and not raw.rstrip().endswith("?") and not pending_question:
            score -= 2
            reasons.append("very short -2")

        threshold = int(cfg.get("threshold", 3))
        send = score >= threshold
        reasons.append(f"score {score} / threshold {threshold} -> {'send' if send else 'hold'}")
        return AutoDecision(send, score, reasons, lang)


# --------------------------------------------------------------------------
# Fact extraction
# --------------------------------------------------------------------------

_EN_NAME_RE = re.compile(
    r"\b(?:my name is|call me)\s+([A-ZА-ЯЁ][\w\-]{1,24})", re.IGNORECASE
)
_RU_NAME_RE = re.compile(
    r"\b(?:меня зовут|зови меня)\s+([А-ЯЁA-Z][\w\-]{1,24})", re.IGNORECASE
)
_EN_LIKE_RE = re.compile(
    r"\bi (?:really )?(?:like|love|enjoy|hate|prefer)\s+(.{3,90}?)(?:[.!?]|$)", re.IGNORECASE
)
_RU_LIKE_RE = re.compile(
    r"\b(?:я (?:очень )?(?:люблю|обожаю|ненавижу|предпочитаю)|мне (?:очень )?нравится)\s+(.{3,90}?)(?:[.!?]|$)",
    re.IGNORECASE,
)
_EN_REMEMBER_RE = re.compile(
    r"\b(?:remember(?: that)?|don't forget(?: that)?|keep in mind(?: that)?)\s+(.{3,140}?)(?:[.!?]|$)",
    re.IGNORECASE,
)
_RU_REMEMBER_RE = re.compile(
    r"\b(?:запомни(?:,? что)?|не забудь(?:,? что)?|учти(?:,? что)?)\s+(.{3,140}?)(?:[.!?]|$)",
    re.IGNORECASE,
)


def extract_memories(text: str, existing: list[str]) -> tuple[list[str], str]:
    """Return new facts and an updated user name (may be empty)."""
    new: list[str] = []
    name = ""
    m = _EN_NAME_RE.search(text) or _RU_NAME_RE.search(text)
    if m:
        candidate = m.group(1).strip()
        if candidate.lower() not in {"not", "just", "so", "very", "a", "an", "the", "не", "просто", "очень"}:
            name = candidate[:30]
            fact = f"User's name is {name}"
            if fact.lower() not in {f.lower() for f in existing}:
                new.append(fact)
    for regex, label in (
        (_EN_LIKE_RE, "User likes"),
        (_RU_LIKE_RE, "User likes"),
        (_EN_REMEMBER_RE, "Remember"),
        (_RU_REMEMBER_RE, "Remember"),
    ):
        for match in regex.finditer(text):
            value = re.sub(r"\s+", " ", match.group(1)).strip(" ,;")
            if not value or len(value) < 3:
                continue
            fact = f"{label}: {value}"
            if fact.lower() not in {f.lower() for f in existing} and fact.lower() not in {f.lower() for f in new}:
                new.append(fact[:180])
    return new[:4], name


# --------------------------------------------------------------------------
# Turn manager
# --------------------------------------------------------------------------

class TurnManager:
    def __init__(
        self,
        *,
        settings: SettingsStore,
        llm: LLMRouter,
        conversation: ConversationStore,
        broadcast: Broadcast,
        log: Callable[..., None] | None = None,
        has_clients: Callable[[], bool] | None = None,
    ) -> None:
        self.settings_store = settings
        self.llm = llm
        self.conversation = conversation
        self.broadcast = broadcast
        self.log = log or (lambda *a, **k: None)
        self.has_clients = has_clients
        self.judge = AutoSendJudge()
        self.pending_parts: list[str] = []
        self.pending_since = 0.0
        self.pending_decision: AutoDecision | None = None
        self._force_task: asyncio.Task | None = None
        self._generation_task: asyncio.Task | None = None
        self._cancel = asyncio.Event()
        self.current_id: str | None = None
        self.current_text: str = ""
        self.current_emotions: list[str] = []
        self.current_kind: str = "chat"
        self.status = "idle"
        self.last_activity = now()
        self.last_proactive = 0.0
        self.last_poke = 0.0
        self.last_user_text = ""
        self.last_assistant_text = ""
        self._proactive_history: list[float] = []
        self._closed = False

    # -- helpers --------------------------------------------------------
    @property
    def settings(self) -> dict[str, Any]:
        return self.settings_store.all()

    def pending_text(self) -> str:
        return " ".join(p for p in self.pending_parts if p).strip()

    def _pending_question(self) -> bool:
        return self.last_assistant_text.rstrip().endswith("?")

    def _set_status(self, status: str, detail: str = "") -> None:
        if self.status == status and not detail:
            return
        self.status = status
        asyncio.create_task(
            self.broadcast({"type": "state", "status": status, "detail": detail})
        )

    async def _emit_mood(self) -> None:
        e = self.settings.get("engagement", {})
        await self.broadcast(
            {
                "type": "mood",
                "affection": int(e.get("affection", 50)),
                "curiosity": int(e.get("curiosity", 70)),
                "energy": int(e.get("energy", 75)),
            }
        )

    async def _emit_memory(self) -> None:
        await self.broadcast(
            {
                "type": "memory",
                "facts": list(self.conversation.facts),
                "user_name": self.conversation.user_name,
            }
        )

    def _save(self) -> None:
        try:
            self.conversation.save()
        except OSError as exc:
            self.log("error", "Failed to save history: %s", exc)

    # -- input ----------------------------------------------------------
    async def handle_transcript(self, text: str, meta: dict[str, Any] | None = None) -> None:
        text = (text or "").strip()
        if not text:
            return
        self.last_activity = now()
        self.last_user_text = text
        mode = self.settings.get("input", {}).get("mode", "silence")
        meta = meta or {}
        await self.broadcast({"type": "input_received", "text": text, "mode": mode, "meta": meta})

        if mode == "hotkey":
            self._add_pending(text)
            await self.broadcast(
                {
                    "type": "pending",
                    "text": self.pending_text(),
                    "mode": mode,
                    "auto_send": False,
                    "score": None,
                    "reasons": ["hotkey mode: press submit to send"],
                }
            )
            self._set_status("holding", "press submit")
            return

        if mode == "auto":
            self._add_pending(text)
            decision = self.judge.judge(
                self.pending_text(),
                settings=self.settings,
                pending_question=self._pending_question(),
            )
            self.pending_decision = decision
            await self.broadcast(
                {
                    "type": "auto_decision",
                    "text": self.pending_text(),
                    "score": decision.score,
                    "reasons": decision.reasons,
                    "send": decision.send,
                    "threshold": self.settings.get("input", {}).get("auto", {}).get("threshold", 3),
                }
            )
            if decision.send:
                await self.force_send_pending(reason="auto")
            else:
                await self.broadcast(
                    {
                        "type": "pending",
                        "text": self.pending_text(),
                        "mode": mode,
                        "auto_send": True,
                        "score": decision.score,
                        "reasons": decision.reasons,
                    }
                )
                self._set_status("holding", "auto: waiting for more context")
                self._schedule_force()
            return

        # silence mode
        if self.pending_parts:
            self._add_pending(text)
            await self.force_send_pending(reason="silence")
        else:
            await self.respond(text)

    def _add_pending(self, text: str) -> None:
        self.pending_parts.append(text)
        self.pending_since = now()
        max_chars = int(self.settings.get("input", {}).get("auto", {}).get("max_buffer_chars", 700))
        joined = self.pending_text()
        if len(joined) > max_chars:
            self.pending_parts = [joined[-max_chars:]]

    def _schedule_force(self) -> None:
        if self._force_task and not self._force_task.done():
            self._force_task.cancel()
        delay = int(self.settings.get("input", {}).get("auto", {}).get("force_after_ms", 6500)) / 1000
        self._force_task = asyncio.create_task(self._force_after(delay))

    async def _force_after(self, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            if self.pending_text() and self.status != "generating":
                await self.force_send_pending(reason="auto-timeout")
        except asyncio.CancelledError:
            return

    async def force_send_pending(self, reason: str = "manual") -> None:
        text = self.pending_text()
        self.pending_parts = []
        self.pending_since = 0.0
        self.pending_decision = None
        if self._force_task and not self._force_task.done():
            self._force_task.cancel()
        await self.broadcast({"type": "pending_clear"})
        if not text:
            return
        await self.respond(text, meta={"submit_reason": reason})

    async def handle_text(self, text: str) -> None:
        text = (text or "").strip()
        if not text:
            return
        self.last_activity = now()
        self.pending_parts = []
        await self.broadcast({"type": "pending_clear"})
        await self.respond(text)

    async def handle_submit(self, flush_text: str = "") -> None:
        flush_text = (flush_text or "").strip()
        if flush_text:
            self._add_pending(flush_text)
        if not self.pending_text():
            self._set_status("idle")
            await self.broadcast({"type": "state", "status": "idle", "detail": ""})
            return
        await self.force_send_pending(reason="hotkey")

    # -- generation -----------------------------------------------------
    async def respond(
        self,
        text: str,
        *,
        kind: str = "chat",
        instruction: str = "",
        meta: dict[str, Any] | None = None,
    ) -> None:
        if kind == "chat":
            self.last_user_text = text
            user_msg = self.conversation.add(
                "user",
                text,
                lang=detect_language(text),
                meta=meta,
            )
            self._save()
            sentiment = user_sentiment(text)
            self._update_mood_from_user(sentiment)
            inferred = infer_emotion(text)
            if self.settings.get("engagement", {}).get("mirror_user_emotion", True):
                await self.broadcast(
                    {
                        "type": "user_emotion",
                        "emotion": inferred,
                        "intensity": 0.65,
                        "sentiment": round(sentiment, 2),
                    }
                )
            await self.broadcast({"type": "user_message", "message": user_msg})
            await self._emit_mood()
            self._learn(text)
        else:
            instruction = instruction or ""

        old_id = self.current_id
        if old_id:
            await self.broadcast({"type": "assistant_cancelled", "id": old_id})
        self.cancel_generation(notify=False)
        cancel = asyncio.Event()
        self._cancel = cancel
        self.current_id = make_id()
        self.current_text = ""
        self.current_emotions = []
        self.current_kind = kind
        self._set_status("generating", kind)
        self._generation_task = asyncio.create_task(
            self._generate(self.current_id, text if kind == "chat" else "", kind, instruction, cancel)
        )

    def _update_mood_from_user(self, sentiment: float) -> None:
        if not self.settings.get("engagement", {}).get("mood", True):
            return
        s = self.settings
        e = s.get("engagement", {})
        affection = int(e.get("affection", 50) + round(sentiment * 2.5))
        curiosity = int(e.get("curiosity", 70) + 1)
        energy = int(e.get("energy", 75) - (1 if sentiment < -0.3 else 0))
        self.settings_store.update(
            {
                "engagement": {
                    "affection": max(0, min(100, affection)),
                    "curiosity": max(0, min(100, curiosity)),
                    "energy": max(0, min(100, energy)),
                }
            }
        )

    def _learn(self, text: str) -> None:
        if not self.settings.get("engagement", {}).get("remember_facts", True):
            return
        new, name = extract_memories(text, self.conversation.facts)
        if name:
            self.conversation.user_name = name
            self.settings_store.update({"persona": {"user_name": name}})
        if new:
            for fact in new:
                if fact.lower() not in {f.lower() for f in self.conversation.facts}:
                    self.conversation.facts.append(fact)
            self.conversation.facts = self.conversation.facts[-60:]
            self._save()
            asyncio.create_task(self._emit_memory())
            self.log("info", "Memory updated: %s", new)
        elif name:
            self._save()
            asyncio.create_task(self._emit_memory())

    def _messages_for_prompt(self, instruction: str = "") -> list[dict[str, str]]:
        s = self.settings
        turns = int(s.get("llm", {}).get("history_turns", 10))
        facts = list(self.conversation.facts)
        user_name = self.conversation.user_name or s.get("persona", {}).get("user_name", "")
        system = build_system_prompt(s, facts=facts, user_name=user_name)
        messages: list[dict[str, str]] = [{"role": "system", "content": system}]
        history = self.conversation.recent(turns * 2 + 2)
        for m in history:
            role = m.get("role")
            if role not in ("user", "assistant"):
                continue
            text = str(m.get("text") or "").strip()
            if text:
                messages.append({"role": role, "content": text})
        if instruction:
            messages.append({"role": "system", "content": instruction})
        # Keep the prompt inside the context window (rough 3.4 chars/token).
        budget = int(s.get("llm", {}).get("num_ctx", 4096) * 3.2)
        total = sum(len(m["content"]) for m in messages)
        while total > budget and len(messages) > 3:
            removed = messages.pop(1)
            total -= len(removed["content"])
        return messages

    async def _generate(
        self,
        gen_id: str,
        user_text: str,
        kind: str,
        instruction: str,
        cancel: asyncio.Event,
    ) -> None:
        parser = EmotionStreamParser()
        full_text = ""
        emotions: list[str] = []
        current_emotion = "neutral"
        started = now()
        failed = False
        try:
            messages = self._messages_for_prompt(instruction)
            await self.broadcast(
                {
                    "type": "assistant_start",
                    "id": gen_id,
                    "kind": kind,
                    "ts": started,
                }
            )
            options = {"_kind": kind}
            delta_buffer = ""
            last_flush = time.monotonic()
            speaking = False

            async def flush_delta() -> None:
                nonlocal delta_buffer, last_flush, speaking
                if not delta_buffer:
                    return
                if not speaking:
                    speaking = True
                    self._set_status("speaking", kind)
                await self.broadcast(
                    {
                        "type": "assistant_delta",
                        "id": gen_id,
                        "text": delta_buffer,
                        "emotion": current_emotion,
                    }
                )
                delta_buffer = ""
                last_flush = time.monotonic()

            async for chunk in self.llm.chat_stream(messages, cancel=cancel, options=options):
                if cancel.is_set():
                    break
                for ev_kind, value in parser.feed(chunk):
                    if ev_kind == "emotion":
                        # Flush pending visible text before the face changes so
                        # the text and the expression stay in sync.
                        await flush_delta()
                        current_emotion = value or "neutral"
                        if not emotions or emotions[-1] != current_emotion:
                            emotions.append(current_emotion)
                        await self.broadcast(
                            {
                                "type": "emotion",
                                "emotion": current_emotion,
                                "intensity": 0.9,
                                "duration": 5200,
                                "source": "llm",
                                "id": gen_id,
                            }
                        )
                    else:
                        text = value or ""
                        if not text:
                            continue
                        full_text += text
                        delta_buffer += text
                        if len(delta_buffer) >= 56 or time.monotonic() - last_flush >= 0.04:
                            await flush_delta()
            for ev_kind, value in parser.flush():
                if ev_kind == "text" and value:
                    full_text += value
                    delta_buffer += value
            await flush_delta()
            if cancel.is_set():
                return
            full_text = re.sub(r"[ \t]+", " ", full_text).strip()
            full_text = re.sub(r"\n{3,}", "\n\n", full_text)
            if not full_text:
                lang = "ru" if self.settings.get("app", {}).get("language") == "ru" else "en"
                full_text = (
                    "…мой экран моргнул и мысль потерялась. Скажи ещё раз?"
                    if lang == "ru"
                    else "…my screen blinked and the thought fell out. Say that again?"
                )
                if not emotions:
                    emotions = ["confused"]
                    current_emotion = "confused"
                    await self.broadcast(
                        {
                            "type": "emotion",
                            "emotion": "confused",
                            "intensity": 0.8,
                            "duration": 5000,
                            "source": "fallback",
                        }
                    )
            if not emotions:
                inferred = infer_emotion(full_text)
                emotions = [inferred]
                await self.broadcast(
                    {
                        "type": "emotion",
                        "emotion": inferred,
                        "intensity": 0.7,
                        "duration": 4500,
                        "source": "inferred",
                    }
                )
            message = self.conversation.add(
                "assistant",
                full_text,
                emotions=emotions,
                kind=kind,
                meta={"duration_ms": round((now() - started) * 1000)},
            )
            self.last_assistant_text = full_text
            self.last_activity = now()
            self._save()
            self._update_mood_from_assistant(emotions)
            await self._emit_mood()
            await self.broadcast({"type": "assistant_end", "message": message})
            self.log("info", "Assistant reply (%s) in %.1fs: %s", kind, now() - started, full_text[:160])
        except asyncio.CancelledError:
            self.log("info", "Generation cancelled")
            return
        except LLMError as exc:
            failed = True
            self.log("error", "LLM error: %s", exc)
            await self.broadcast({"type": "assistant_cancelled", "id": gen_id})
            await self.broadcast({"type": "error", "scope": "llm", "message": str(exc)})
            self._set_status("error", "llm")
            return
        except Exception as exc:  # noqa: BLE001
            failed = True
            self.log("error", "Generation failed: %s", exc)
            await self.broadcast({"type": "assistant_cancelled", "id": gen_id})
            await self.broadcast(
                {"type": "error", "scope": "llm", "message": f"{type(exc).__name__}: {exc}"}
            )
            self._set_status("error", "llm")
            return
        finally:
            if self.current_id == gen_id:
                if not failed:
                    self._set_status("idle")
                self._generation_task = None

    def _update_mood_from_assistant(self, emotions: list[str]) -> None:
        if not self.settings.get("engagement", {}).get("mood", True):
            return
        e = self.settings.get("engagement", {})
        affection = int(e.get("affection", 50))
        energy = int(e.get("energy", 75))
        curiosity = int(e.get("curiosity", 70))
        for emo in emotions:
            if emo in ("love", "happy", "laugh", "proud", "wink"):
                affection += 1
            elif emo in ("excited", "surprised"):
                energy += 1
            elif emo in ("curious", "thinking"):
                curiosity += 1
            elif emo in ("sad", "angry", "scared"):
                energy -= 1
        self.settings_store.update(
            {
                "engagement": {
                    "affection": max(0, min(100, affection)),
                    "curiosity": max(0, min(100, curiosity)),
                    "energy": max(0, min(100, energy)),
                }
            }
        )

    def cancel_generation(self, notify: bool = True) -> None:
        self._cancel.set()
        task = self._generation_task
        if task and not task.done():
            task.cancel()
        if notify and self.current_id:
            asyncio.create_task(
                self.broadcast({"type": "assistant_cancelled", "id": self.current_id})
            )
        self._generation_task = None
        self.current_id = None
        if notify:
            self._set_status("idle")

    async def poke(self) -> None:
        if self.status == "generating":
            return
        if now() - self.last_poke < 6:
            return
        self.last_poke = now()
        self.last_activity = now()
        await self.respond(
            "",
            kind="poke",
            instruction=poke_instruction(self.settings),
        )

    async def proactive_loop(self) -> None:
        while not self._closed:
            await asyncio.sleep(15)
            try:
                await self._maybe_proactive()
            except asyncio.CancelledError:
                return
            except Exception as exc:  # noqa: BLE001
                self.log("warning", "Proactive loop error: %s", exc)

    async def _maybe_proactive(self) -> None:
        s = self.settings
        if not s.get("engagement", {}).get("proactive", True):
            return
        if self.has_clients is not None and not self.has_clients():
            return
        if self.status != "idle" or self.pending_text():
            return
        idle_s = now() - self.last_activity
        threshold = int(s.get("engagement", {}).get("idle_min_seconds", 150))
        if idle_s < threshold:
            return
        # Energy decays slowly while alone.
        e = s.get("engagement", {})
        if int(e.get("energy", 75)) > 10:
            self.settings_store.update({"engagement": {"energy": max(0, int(e.get("energy", 75)) - 1)}})
        limit = int(s.get("engagement", {}).get("proactive_max_per_hour", 4))
        cutoff = now() - 3600
        self._proactive_history = [t for t in self._proactive_history if t > cutoff]
        if len(self._proactive_history) >= limit:
            return
        if now() - self.last_proactive < 45:
            return
        self.last_proactive = now()
        self._proactive_history.append(now())
        self.log("info", "Proactive nudge after %.0fs idle", idle_s)
        instruction = proactive_instruction(s, int(idle_s))
        if int(e.get("energy", 75)) < 20:
            instruction += " You are very sleepy; let that show."
        await self.respond("", kind="proactive", instruction=instruction)

    async def wake(self) -> None:
        if self.status == "generating":
            return
        if now() - self.last_proactive < 60:
            return
        self.last_proactive = now()
        await self.respond("", kind="wake", instruction=wake_instruction(self.settings))

    async def close(self) -> None:
        self._closed = True
        self.cancel_generation(notify=False)
        if self._force_task and not self._force_task.done():
            self._force_task.cancel()
