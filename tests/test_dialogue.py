import asyncio
import copy

import pytest

from vector.config import DEFAULTS, SettingsStore
from vector.dialogue import ConversationStore, TurnManager


class FakeLLM:
    def __init__(self):
        self.calls = 0

    async def chat_stream(self, messages, *, cancel=None, options=None):
        self.calls += 1
        for chunk in ["[happy] ", "Hello", " there!", " [curious] ", "How are you?"]:
            if cancel is not None and cancel.is_set():
                return
            yield chunk
            await asyncio.sleep(0)

    async def chat_once(self, messages, **kwargs):
        return ""


def make_turn(tmp_path, mode="silence"):
    settings = SettingsStore(tmp_path / "settings.json")
    settings.update({"input": {"mode": mode}, "engagement": {"proactive": False}})
    conversation = ConversationStore(tmp_path / "history.json")
    events = []

    async def broadcast(event):
        events.append(event)

    llm = FakeLLM()
    turn = TurnManager(
        settings=settings,
        llm=llm,
        conversation=conversation,
        broadcast=broadcast,
    )
    return turn, llm, conversation, events


async def wait_idle(turn, timeout=2.0):
    for _ in range(int(timeout / 0.01)):
        if turn.status in ("idle", "holding") and not turn._generation_task:
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"turn did not finish: {turn.status}")


def test_hotkey_buffers_then_submits(tmp_path):
    async def run():
        turn, llm, conversation, events = make_turn(tmp_path, "hotkey")
        await turn.handle_transcript("hello there")
        assert turn.pending_text() == "hello there"
        assert llm.calls == 0
        assert not conversation.messages
        await turn.handle_submit()
        await wait_idle(turn)
        assert llm.calls == 1
        assert conversation.messages[0]["role"] == "user"
        assert conversation.messages[1]["role"] == "assistant"
        assert "Hello there!" in conversation.messages[1]["text"]
        assert "happy" in conversation.messages[1]["emotions"]
        assert any(e["type"] == "pending_clear" for e in events)
        await turn.close()

    asyncio.run(run())


def test_auto_mode_holds_then_sends_on_question(tmp_path):
    async def run():
        turn, llm, conversation, events = _make_auto(tmp_path)
        await turn.handle_transcript("I was walking to the store")
        assert turn.pending_text()
        assert llm.calls == 0
        await turn.handle_transcript("Why is the sky blue?")
        await wait_idle(turn)
        assert llm.calls == 1
        assert conversation.messages[0]["role"] == "user"
        assert "Why is the sky blue?" in conversation.messages[0]["text"]
        await turn.close()

    asyncio.run(run())


def _make_auto(tmp_path):
    return make_turn(tmp_path, "auto")


def test_silence_mode_responds_immediately(tmp_path):
    async def run():
        turn, llm, conversation, events = make_turn(tmp_path, "silence")
        await turn.handle_transcript("Hello Vector!")
        await wait_idle(turn)
        assert llm.calls == 1
        assert len(conversation.messages) == 2
        await turn.close()

    asyncio.run(run())


def test_submit_without_pending_is_idle(tmp_path):
    async def run():
        turn, llm, conversation, events = make_turn(tmp_path, "hotkey")
        await turn.handle_submit()
        assert turn.status == "idle"
        assert not conversation.messages
        assert any(e.get("type") == "state" and e.get("status") == "idle" for e in events)
        await turn.close()

    asyncio.run(run())


def test_memory_extraction_on_message(tmp_path):
    async def run():
        turn, llm, conversation, events = make_turn(tmp_path, "silence")
        await turn.handle_text("My name is Alex and I love tea.")
        await wait_idle(turn)
        assert conversation.user_name == "Alex"
        assert any("tea" in f for f in conversation.facts)
        await turn.close()

    asyncio.run(run())
