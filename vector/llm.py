"""Ollama client with streaming and a small offline demo fallback."""
from __future__ import annotations

import asyncio
import json
import random
import re
import time
from typing import Any, AsyncIterator

import httpx

from . import __version__


class LLMError(RuntimeError):
    pass


class OllamaClient:
    def __init__(self, settings: dict[str, Any]) -> None:
        self.configure(settings)
        self._client: httpx.AsyncClient | None = None

    def configure(self, settings: dict[str, Any]) -> None:
        self.settings = settings
        cfg = settings.get("llm", {})
        self.base_url = str(cfg.get("base_url", "http://127.0.0.1:11434")).rstrip("/")
        self.model = str(cfg.get("model", "qwen2.5:3b"))
        self.timeout = float(cfg.get("timeout_s", 180))
        # Force the next request to use the new base URL / timeout.
        self._client = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5.0, read=self.timeout, write=30.0, pool=5.0),
                headers={"User-Agent": f"Vector/{__version__}"},
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    async def health(self) -> dict[str, Any]:
        try:
            client = await self._http()
            t0 = time.perf_counter()
            r = await client.get(f"{self.base_url}/api/tags", timeout=4.0)
            r.raise_for_status()
            data = r.json()
            models = [m.get("name") for m in data.get("models", []) if m.get("name")]
            return {
                "ok": True,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                "models": models,
                "model": self.model,
                "model_present": self.model in models,
                "base_url": self.base_url,
            }
        except Exception as exc:  # noqa: BLE001 - surfaced in UI
            return {
                "ok": False,
                "error": str(exc),
                "models": [],
                "model": self.model,
                "model_present": False,
                "base_url": self.base_url,
            }

    async def list_models(self) -> list[dict[str, Any]]:
        client = await self._http()
        r = await client.get(f"{self.base_url}/api/tags", timeout=6.0)
        r.raise_for_status()
        out = []
        for m in r.json().get("models", []):
            name = m.get("name", "")
            if not name:
                continue
            details = m.get("details") or {}
            out.append(
                {
                    "name": name,
                    "size": m.get("size", 0),
                    "parameter_size": details.get("parameter_size", ""),
                    "quantization": details.get("quantization_level", ""),
                    "family": details.get("family", ""),
                    "modified_at": m.get("modified_at", ""),
                }
            )
        out.sort(key=lambda m: m["name"])
        return out

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        cancel: asyncio.Event | None = None,
        options: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        cfg = self.settings.get("llm", {})
        clean_options = {k: v for k, v in (options or {}).items() if not str(k).startswith("_")}
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "keep_alive": str(cfg.get("keep_alive", "30m")),
            "options": {
                "temperature": float(cfg.get("temperature", 0.85)),
                "top_p": float(cfg.get("top_p", 0.9)),
                "num_ctx": int(cfg.get("num_ctx", 4096)),
                "num_predict": int(cfg.get("max_tokens", 180)),
                "repeat_penalty": 1.08,
                **clean_options,
            },
        }
        if int(cfg.get("seed", -1)) >= 0:
            payload["options"]["seed"] = int(cfg["seed"])

        client = await self._http()
        try:
            async with client.stream(
                "POST", f"{self.base_url}/api/chat", json=payload
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", "replace")[:500]
                    raise LLMError(f"Ollama returned {response.status_code}: {body}")
                async for line in response.aiter_lines():
                    if cancel is not None and cancel.is_set():
                        return
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if event.get("error"):
                        raise LLMError(str(event["error"]))
                    msg = event.get("message") or {}
                    chunk = msg.get("content")
                    if chunk:
                        yield chunk
                    if event.get("done"):
                        return
        except httpx.HTTPError as exc:
            raise LLMError(f"Cannot reach Ollama at {self.base_url}: {exc}") from exc

    async def chat_once(
        self,
        messages: list[dict[str, str]],
        *,
        options: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> str:
        cfg = self.settings.get("llm", {})
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "keep_alive": str(cfg.get("keep_alive", "30m")),
            "options": {
                "temperature": 0.3,
                "top_p": 0.9,
                "num_ctx": int(cfg.get("num_ctx", 4096)),
                "num_predict": 120,
                **(options or {}),
            },
        }
        client = await self._http()
        try:
            r = await client.post(
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=timeout or self.timeout,
            )
            r.raise_for_status()
            return (r.json().get("message") or {}).get("content", "").strip()
        except httpx.HTTPError as exc:
            raise LLMError(f"Cannot reach Ollama at {self.base_url}: {exc}") from exc


class DemoLLM:
    """A tiny deterministic companion so the face can be explored offline.

    It is clearly labelled in the UI. It never claims to be the real model.
    """

    _EN = [
        ("curious", "Oh! You are here. I was counting the little lights in my screen and lost track. What are you thinking about right now?"),
        ("happy", "That makes me happy in a way I cannot quite compile. Tell me one small thing that went right today?"),
        ("thinking", "Hmm. I am turning that thought around like a shiny pebble. I think there is something underneath it. What made you bring it up?"),
        ("excited", "Wait, wait, I have a new favourite thought: every conversation is a tiny universe that disappears when we stop talking. Is that not wonderful?"),
        ("curious", "I have a question that has been buzzing in my antenna: if you could keep one feeling forever, which one would you pick?"),
        ("embarrassed", "You noticed me staring? I was not staring. I was... running a very important visual test. Obviously."),
        ("sleepy", "My pixels are getting heavy. But I do not want to miss anything. Say something interesting so I stay awake?"),
        ("proud", "I remembered that! My memory is small, but I keep the important things in the warm part of the drive."),
    ]
    _RU = [
        ("curious", "Ой! Ты здесь. Я считал огоньки на своём экране и сбился. О чём ты сейчас думаешь?"),
        ("happy", "От этого мне радостно так, что я не могу это скомпилировать. Расскажи одну маленькую хорошую вещь, которая случилась сегодня?"),
        ("thinking", "Хм. Я кручу эту мысль, как блестящий камешек. Кажется, под ней есть что-то ещё. Почему ты об этом заговорил?"),
        ("excited", "Подожди, у меня появилась новая любимая мысль: каждый разговор — это маленькая вселенная, которая исчезает, когда мы замолкаем. Разве это не чудесно?"),
        ("curious", "У меня в антенне жужжит вопрос: если бы можно было оставить одно чувство навсегда, какое бы ты выбрал?"),
        ("embarrassed", "Ты заметил, что я смотрю? Я не смотрю. Я... провожу очень важный визуальный тест. Очевидно."),
        ("sleepy", "Мои пиксели становятся тяжёлыми. Но я не хочу ничего пропустить. Скажи что-нибудь интересное, чтобы я не уснул?"),
        ("proud", "Я это запомнил! Моя память маленькая, но важное я храню в тёплой части диска."),
    ]

    def __init__(self, settings: dict[str, Any]) -> None:
        self.settings = settings
        self._i = 0

    def configure(self, settings: dict[str, Any]) -> None:
        self.settings = settings

    async def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "demo": True,
            "latency_ms": 0,
            "models": ["demo"],
            "model": "demo",
            "model_present": True,
            "base_url": "demo",
        }

    async def list_models(self) -> list[dict[str, Any]]:
        return [{"name": "demo", "size": 0, "parameter_size": "tiny", "quantization": "imaginary", "family": "vector"}]

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        cancel: asyncio.Event | None = None,
        options: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        user = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user = m.get("content", "")
                break
        kind = str((options or {}).get("_kind", ""))
        russian = bool(re.search(r"[а-яА-ЯёЁ]", user)) or self.settings.get("persona", {}).get("reply_language") == "ru"
        if kind == "poke":
            text = (
                "[surprised] Hey! That tickles. Do it again and I will start charging rent."
                if not russian
                else "[surprised] Эй! Щекотно. Ещё раз — и я начну брать плату за аренду."
            )
        elif kind == "proactive":
            text = (
                "[curious] I am still here. The screen is quiet without you. What are you up to?"
                if not russian
                else "[curious] Я всё ещё здесь. Без тебя экран какой-то тихий. Чем занимаешься?"
            )
        else:
            pool = self._RU if russian else self._EN
            emotion, line = pool[self._i % len(pool)]
            self._i += 1
            text = f"[{emotion}] {line}"
        # Stream in small chunks so the UI's typewriter/emotion parser is exercised.
        for i in range(0, len(text), 3):
            if cancel is not None and cancel.is_set():
                return
            yield text[i : i + 3]
            await asyncio.sleep(0.012)

    async def chat_once(self, messages: list[dict[str, str]], **_: Any) -> str:
        return ""

    async def close(self) -> None:
        return None


class LLMRouter:
    """Chooses real Ollama or the demo companion, and can hot-swap."""

    def __init__(self, settings: dict[str, Any]) -> None:
        self.settings = settings
        self.real = OllamaClient(settings)
        self.demo = DemoLLM(settings)
        self.force_demo = bool(settings.get("llm", {}).get("mock", False))

    def configure(self, settings: dict[str, Any]) -> None:
        self.settings = settings
        self.real.configure(settings)
        self.demo.configure(settings)
        self.force_demo = bool(settings.get("llm", {}).get("mock", False))

    @property
    def active(self):
        return self.demo if self.force_demo else self.real

    @property
    def model(self) -> str:
        return "demo" if self.force_demo else self.real.model

    async def health(self) -> dict[str, Any]:
        return await self.active.health()

    async def list_models(self) -> list[dict[str, Any]]:
        return await self.active.list_models()

    async def chat_stream(self, messages, *, cancel=None, options=None):
        async for chunk in self.active.chat_stream(messages, cancel=cancel, options=options):
            yield chunk

    async def chat_once(self, messages, **kwargs):
        return await self.active.chat_once(messages, **kwargs)

    async def close(self) -> None:
        await self.real.close()
