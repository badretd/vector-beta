"""FastAPI server: local HTTP API, WebSocket bridge, static UI, and logs."""
from __future__ import annotations

import asyncio
import collections
import json
import logging
import platform
import sys
import time
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .asr import ASREngine, AudioSession, SAMPLE_RATE
from .config import (
    DATA_DIR,
    DEFAULTS,
    LOG_DIR,
    WEB_DIR,
    SettingsStore,
    settings_for_client,
)
from .dialogue import ConversationStore, TurnManager
from .characters import character_payload
from .emotions import EMOTIONS, emotion_payload
from .llm import LLMRouter

LOG = logging.getLogger("vector")


# --------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------

class RingLogHandler(logging.Handler):
    def __init__(self, capacity: int = 800) -> None:
        super().__init__()
        self.records: collections.deque[dict[str, Any]] = collections.deque(maxlen=capacity)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._broadcast = None

    def bind(self, loop: asyncio.AbstractEventLoop, broadcast) -> None:
        self._loop = loop
        self._broadcast = broadcast

    def emit(self, record: logging.LogRecord) -> None:
        try:
            item = {
                "ts": record.created,
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record),
            }
            if record.exc_info:
                item["traceback"] = "".join(traceback.format_exception(*record.exc_info))[-4000:]
            self.records.append(item)
            if self._loop and self._broadcast and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(
                        self._broadcast({"type": "log", "entry": item})
                    )
                )
        except Exception:  # noqa: BLE001 - logging must never crash
            pass


LOG_HANDLER = RingLogHandler()


def configure_logging(level: str = "INFO") -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    for h in list(root.handlers):
        root.removeHandler(h)
    fmt = logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s")
    file_handler = logging.FileHandler(LOG_DIR / "vector.log", encoding="utf-8")
    file_handler.setFormatter(fmt)
    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(fmt)
    LOG_HANDLER.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(file_handler)
    root.addHandler(stream)
    root.addHandler(LOG_HANDLER)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpx2").setLevel(logging.WARNING)
    logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
    logging.getLogger("faster_whisper").setLevel(logging.WARNING)


# --------------------------------------------------------------------------
# WebSocket hub
# --------------------------------------------------------------------------

class _Client:
    __slots__ = ("ws", "queue", "task")

    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=256)
        self.task: asyncio.Task | None = None


class WebSocketHub:
    """Fan out events through per-client queues.

    A slow or stuck browser can never delay the turn manager or the other
    clients. When a queue is full we drop the oldest frame: fresh state is
    more useful than stale state.
    """

    def __init__(self) -> None:
        self.clients: dict[WebSocket, _Client] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        client = _Client(ws)
        client.task = asyncio.create_task(self._writer(client))
        async with self._lock:
            self.clients[ws] = client

    async def _writer(self, client: _Client) -> None:
        try:
            while True:
                payload = await client.queue.get()
                await client.ws.send_text(payload)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - client went away
            pass
        finally:
            async with self._lock:
                self.clients.pop(client.ws, None)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            client = self.clients.pop(ws, None)
        if client and client.task and not client.task.done():
            client.task.cancel()

    async def broadcast(self, event: dict[str, Any]) -> None:
        async with self._lock:
            clients = list(self.clients.values())
        if not clients:
            return
        payload = json.dumps(event, ensure_ascii=False, default=str)
        for client in clients:
            if client.queue.full():
                try:
                    client.queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                client.queue.put_nowait(payload)
            except asyncio.QueueFull:
                pass


# --------------------------------------------------------------------------
# Application state
# --------------------------------------------------------------------------

class AppState:
    def __init__(self) -> None:
        self.settings = SettingsStore()
        configure_logging(self.settings.get("debug.log_level", "INFO"))
        self.conversation = ConversationStore()
        self.hub = WebSocketHub()
        self.llm = LLMRouter(self.settings.all())
        self.asr_status: dict[str, Any] = {
            "ready": False,
            "loading": False,
            "model": self.settings.get("asr.model", "small"),
            "device": "auto",
            "compute_type": "auto",
            "error": "",
        }
        self.asr = ASREngine(self.settings.all(), self._on_asr_status)
        self.turn = TurnManager(
            settings=self.settings,
            llm=self.llm,
            conversation=self.conversation,
            broadcast=self.hub.broadcast,
            log=lambda level, msg, *a: LOG.log(getattr(logging, level.upper(), logging.INFO), msg, *a),
            has_clients=lambda: bool(self.hub.clients),
        )
        self.started_at = time.time()
        self.last_transcript: dict[str, Any] = {}
        self.last_partial: dict[str, Any] = {}
        self.health_cache: dict[str, Any] = {}
        self.health_at = 0.0
        self.asr_task: asyncio.Task | None = None
        self.proactive_task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self.mic_active = False
        self.sessions: set[AudioSession] = set()

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        LOG_HANDLER.bind(self._loop, self.hub.broadcast)
        LOG.info("Vector %s starting; data dir %s", __version__, DATA_DIR)
        await self.refresh_health()
        self.asr_task = asyncio.create_task(self._preload_asr())
        self.proactive_task = asyncio.create_task(self.turn.proactive_loop())

    async def stop(self) -> None:
        await self.turn.close()
        if self.asr_task:
            self.asr_task.cancel()
        if self.proactive_task:
            self.proactive_task.cancel()
        await self.asr.close()
        await self.llm.close()
        LOG.info("Vector stopped")

    def _on_asr_status(self, status: dict[str, Any]) -> None:
        self.asr_status = status
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(
                lambda: asyncio.create_task(
                    self.hub.broadcast({"type": "asr_status", "status": status})
                )
            )

    async def _preload_asr(self) -> None:
        if not self.settings.get("asr.enabled", True):
            return
        try:
            LOG.info("Loading speech model %s...", self.settings.get("asr.model", "small"))
            ok = await self.asr.ensure_loaded()
            if ok:
                LOG.info("Speech model ready on %s/%s", self.asr.device, self.asr.compute_type)
            else:
                LOG.error("Speech model failed: %s", self.asr._last_error)
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001
            LOG.exception("ASR preload failed: %s", exc)

    async def refresh_health(self) -> dict[str, Any]:
        health = await self.llm.health()
        health["asr"] = self.asr.status()
        health["version"] = __version__
        self.health_cache = health
        self.health_at = time.time()
        return health

    async def apply_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        before = self.settings.all()
        new = self.settings.update(patch)
        self.llm.configure(new)
        self.asr.configure(new)
        for session in list(self.sessions):
            session.configure(new)
        asr_keys = ("model", "device", "compute_type", "vad")
        if any(before.get("asr", {}).get(k) != new.get("asr", {}).get(k) for k in asr_keys):
            LOG.info("ASR settings changed; reloading model")
            if self.asr_task and not self.asr_task.done():
                self.asr_task.cancel()
            self.asr_task = asyncio.create_task(self._preload_asr())
        if (
            before.get("llm", {}).get("base_url") != new.get("llm", {}).get("base_url")
            or before.get("llm", {}).get("model") != new.get("llm", {}).get("model")
            or before.get("llm", {}).get("mock") != new.get("llm", {}).get("mock")
        ):
            asyncio.create_task(self.refresh_health())
        if before.get("debug", {}).get("log_level") != new.get("debug", {}).get("log_level"):
            logging.getLogger().setLevel(getattr(logging, str(new["debug"]["log_level"]).upper(), logging.INFO))
        client_settings = settings_for_client(new)
        await self.hub.broadcast({"type": "settings", "settings": client_settings})
        LOG.info("Settings updated: %s", ", ".join(sorted(patch.keys())))
        return client_settings

    def hello(self) -> dict[str, Any]:
        return {
            "type": "hello",
            "version": __version__,
            "settings": settings_for_client(self.settings.all()),
            "history": self.conversation.snapshot(),
            "health": self.health_cache,
            "asr": self.asr.status(),
            "emotions": emotion_payload(),
            "characters": character_payload(),
            "input_modes": ["silence", "hotkey", "auto"],
            "server": {
                "started_at": self.started_at,
                "platform": platform.platform(),
                "python": sys.version.split()[0],
                "data_dir": str(DATA_DIR),
                "no_tts": True,
            },
        }

    def debug_snapshot(self) -> dict[str, Any]:
        prompt = ""
        try:
            prompt = self.turn._messages_for_prompt()[0]["content"]
        except Exception:  # noqa: BLE001
            pass
        return {
            "version": __version__,
            "settings": settings_for_client(self.settings.all()),
            "defaults": settings_for_client(DEFAULTS),
            "history": self.conversation.snapshot(),
            "logs": list(LOG_HANDLER.records)[-500:],
            "health": self.health_cache,
            "asr": self.asr.status(),
            "last_transcript": self.last_transcript,
            "last_partial": self.last_partial,
            "turn": {
                "status": self.turn.status,
                "pending": self.turn.pending_text(),
                "last_user": self.turn.last_user_text,
                "last_assistant": self.turn.last_assistant_text,
            },
            "prompt": prompt,
            "server": {
                "started_at": self.started_at,
                "platform": platform.platform(),
                "python": sys.version.split()[0],
                "data_dir": str(DATA_DIR),
                "clients": len(self.hub.clients),
                "mic_active": self.mic_active,
            },
        }


STATE: AppState | None = None


def get_state() -> AppState:
    global STATE
    if STATE is None:
        STATE = AppState()
    return STATE


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    state = get_state()
    await state.start()
    yield
    await state.stop()


app = FastAPI(title="Vector", version=__version__, lifespan=lifespan)


@app.middleware("http")
async def no_cache_static(request, call_next):
    """Local app: always serve fresh UI files so edits show up on reload."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.endswith((".html", ".js", ".css", ".json", ".svg")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
async def health() -> dict[str, Any]:
    state = get_state()
    if time.time() - state.health_at > 10:
        await state.refresh_health()
    return {
        **state.health_cache,
        "asr": state.asr.status(),
        "version": __version__,
        "no_tts": True,
        "mic_active": state.mic_active,
    }


@app.get("/api/settings")
async def get_settings() -> dict[str, Any]:
    return settings_for_client(get_state().settings.all())


@app.patch("/api/settings")
async def patch_settings(patch: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if not isinstance(patch, dict):
        raise HTTPException(400, "settings patch must be an object")
    return await get_state().apply_settings(patch)


@app.post("/api/settings/reset")
async def reset_settings() -> dict[str, Any]:
    state = get_state()
    before = state.settings.all()
    new = state.settings.reset()
    state.llm.configure(new)
    state.asr.configure(new)
    for session in list(state.sessions):
        session.configure(new)
    asr_keys = ("model", "device", "compute_type", "vad")
    if any(before.get("asr", {}).get(k) != new.get("asr", {}).get(k) for k in asr_keys):
        if state.asr_task and not state.asr_task.done():
            state.asr_task.cancel()
        state.asr_task = asyncio.create_task(state._preload_asr())
    await state.hub.broadcast({"type": "settings", "settings": settings_for_client(new)})
    asyncio.create_task(state.refresh_health())
    LOG.info("Settings reset to defaults")
    return settings_for_client(new)


@app.get("/api/models")
async def models() -> dict[str, Any]:
    state = get_state()
    try:
        items = await state.llm.list_models()
        return {"ok": True, "models": items, "active": state.llm.model}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "models": [], "active": state.llm.model}


@app.get("/api/characters")
async def characters() -> dict[str, Any]:
    return character_payload()


@app.get("/api/presets")
async def presets() -> dict[str, Any]:
    return {
        "characters": character_payload(),
        "emotions": emotion_payload(),
        "defaults": settings_for_client(DEFAULTS),
    }


@app.get("/api/history")
async def history() -> dict[str, Any]:
    return get_state().conversation.snapshot()


@app.delete("/api/history")
async def clear_history() -> dict[str, Any]:
    state = get_state()
    state.turn.cancel_generation(notify=False)
    state.conversation.clear()
    await state.hub.broadcast({"type": "history_cleared"})
    LOG.info("Conversation history cleared")
    return {"ok": True}


@app.get("/api/debug")
async def debug() -> dict[str, Any]:
    return get_state().debug_snapshot()


@app.get("/api/prompt")
async def prompt() -> dict[str, Any]:
    state = get_state()
    try:
        text = state.turn._messages_for_prompt()[0]["content"]
    except Exception as exc:  # noqa: BLE001
        text = f"prompt unavailable: {exc}"
    return {"prompt": text}


@app.get("/api/export")
async def export() -> JSONResponse:
    state = get_state()
    data = {
        "app": "vector",
        "version": __version__,
        "exported_at": time.time(),
        "settings": settings_for_client(state.settings.all()),
        "history": state.conversation.snapshot(),
    }
    return JSONResponse(
        data,
        headers={"Content-Disposition": "attachment; filename=vector-export.json"},
    )


@app.post("/api/import")
async def import_data(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
    state = get_state()
    if "settings" in data and isinstance(data["settings"], dict):
        await state.apply_settings(data["settings"])
    if "history" in data and isinstance(data["history"], dict):
        state.turn.cancel_generation(notify=False)
        hist = data["history"]
        state.conversation.messages = list(hist.get("messages") or [])[-1000:]
        state.conversation.facts = [str(f) for f in (hist.get("facts") or [])][:60]
        state.conversation.user_name = str(hist.get("user_name") or "")
        state.conversation.save()
        await state.hub.broadcast({"type": "history_replaced", "history": state.conversation.snapshot()})
    LOG.info("Imported data")
    return {"ok": True}


@app.get("/api/locales")
async def locales() -> dict[str, Any]:
    out = []
    loc_dir = WEB_DIR / "locales"
    if loc_dir.exists():
        for path in sorted(loc_dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                out.append({"code": path.stem, "name": data.get("_name", path.stem)})
            except (OSError, json.JSONDecodeError):
                continue
    return {"locales": out}


@app.get("/api/emotions")
async def emotions() -> dict[str, Any]:
    return {"emotions": emotion_payload(), "tags": list(EMOTIONS.keys())}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    state = get_state()
    await state.hub.connect(ws)
    session: AudioSession | None = None

    async def emit(event: dict[str, Any]) -> None:
        nonlocal state
        if event.get("type") == "transcript":
            state.last_transcript = event
        elif event.get("type") == "asr_partial":
            state.last_partial = event
        try:
            await ws.send_text(json.dumps(event, ensure_ascii=False, default=str))
        except Exception:  # noqa: BLE001 - client vanished mid-send
            return
        if event.get("type") == "transcript" and event.get("final"):
            # VAD can end an utterance without the user stopping the mic. Route
            # it through the turn manager here so silence/auto modes work live.
            await state.turn.handle_transcript(event.get("text", ""), event)

    session = AudioSession(state.settings.all(), state.asr, emit)
    state.sessions.add(session)
    try:
        await ws.send_text(json.dumps(state.hello(), ensure_ascii=False, default=str))
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("bytes") is not None:
                if not state.settings.get("asr.enabled", True):
                    continue
                raw = message["bytes"]
                if len(raw) < 4 or len(raw) % 4 != 0:
                    continue
                samples = np.frombuffer(raw, dtype=np.float32).copy()
                # Guard against absurd payloads (max ~2 seconds per message).
                if samples.size > SAMPLE_RATE * 2:
                    samples = samples[-SAMPLE_RATE * 2 :]
                await session.feed(samples)
                continue
            raw_text = message.get("text")
            if not raw_text:
                continue
            try:
                data = json.loads(raw_text)
            except json.JSONDecodeError:
                continue
            kind = data.get("type")
            if kind == "text":
                text = str(data.get("text") or "").strip()
                if text:
                    # Typed input wins over any in-flight speech so a stale
                    # partial cannot arrive after the user has sent text.
                    session.reset()
                    await state.turn.handle_text(text)
            elif kind == "submit":
                flush_text = await session.flush(emit_transcript=False)
                await state.turn.handle_submit(flush_text)
            elif kind == "audio_start":
                session.reset()
                state.mic_active = True
                await state.hub.broadcast({"type": "mic", "active": True})
                LOG.info("Microphone stream started")
            elif kind == "audio_end":
                # flush() emits the transcript, and emit() routes it to the
                # turn manager, so there is no second handle_transcript call.
                await session.flush()
                state.mic_active = False
                await state.hub.broadcast({"type": "mic", "active": False})
            elif kind == "cancel":
                state.turn.cancel_generation()
            elif kind == "poke":
                await state.turn.poke()
            elif kind == "wake":
                await state.turn.wake()
            elif kind == "add_fact":
                text = str(data.get("text") or "").strip()[:300]
                if text and text.lower() not in {f.lower() for f in state.conversation.facts}:
                    state.conversation.facts.append(text)
                    state.conversation.facts = state.conversation.facts[-60:]
                    state.conversation.save()
                    await state.hub.broadcast(
                        {
                            "type": "memory",
                            "facts": list(state.conversation.facts),
                            "user_name": state.conversation.user_name,
                        }
                    )
                    LOG.info("Fact added: %s", text)
            elif kind == "delete_fact":
                text = str(data.get("text") or "").strip()
                before = len(state.conversation.facts)
                state.conversation.facts = [
                    f for f in state.conversation.facts if f.lower() != text.lower()
                ]
                if len(state.conversation.facts) != before:
                    state.conversation.save()
                    await state.hub.broadcast(
                        {
                            "type": "memory",
                            "facts": list(state.conversation.facts),
                            "user_name": state.conversation.user_name,
                        }
                    )
            elif kind == "clear_facts":
                state.conversation.facts = []
                state.conversation.save()
                await state.hub.broadcast(
                    {
                        "type": "memory",
                        "facts": [],
                        "user_name": state.conversation.user_name,
                    }
                )
            elif kind == "set_mode":
                mode = str(data.get("mode") or "silence")
                if mode in ("silence", "hotkey", "auto"):
                    await state.apply_settings({"input": {"mode": mode}})
                    await state.hub.broadcast({"type": "mode", "mode": mode})
            elif kind == "ping":
                await ws.send_text(json.dumps({"type": "pong", "ts": time.time()}))
            elif kind == "client_log":
                level = str(data.get("level", "info")).upper()
                LOG.log(getattr(logging, level, logging.INFO), "client: %s", data.get("message", ""))
            elif kind == "get_debug":
                await ws.send_text(
                    json.dumps(
                        {"type": "debug", "data": state.debug_snapshot()},
                        ensure_ascii=False,
                        default=str,
                    )
                )
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        LOG.exception("WebSocket error: %s", exc)
    finally:
        state.mic_active = False
        if session is not None:
            state.sessions.discard(session)
            await session.close()
        await state.hub.disconnect(ws)
        LOG.info("Client disconnected")


# Serve the UI. Keep the API routes above; this catch-all comes last.
if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
