import asyncio
import copy

import pytest

from vector.config import DEFAULTS, SettingsStore
from vector.dialogue import ConversationStore, PageSplitter, StudyCommandParser, TurnManager
from vector.study import StudyStore
from vector.study import StudyStore


class FakeLLM:
    def __init__(self):
        self.calls = 0
        self.options = []

    async def chat_stream(self, messages, *, cancel=None, options=None):
        self.calls += 1
        self.options.append(dict(options or {}))
        for chunk in ["[happy] ", "Hello", " there!", " [curious] ", "How are you?"]:
            if cancel is not None and cancel.is_set():
                return
            yield chunk
            await asyncio.sleep(0)

    async def chat_once(self, messages, **kwargs):
        return ""


class StudyFakeLLM(FakeLLM):
    async def chat_stream(self, messages, *, cancel=None, options=None):
        self.calls += 1
        self.options.append(dict(options or {}))
        for chunk in [
            "[curious] First ",
            "page explains the idea. ",
            "It has two sentences.",
            " [[pa",
            "ge]] ",
            "[happy] Second page ",
            "adds an example. ",
            "Does that make sense?",
        ]:
            if cancel is not None and cancel.is_set():
                return
            yield chunk
            await asyncio.sleep(0)


def make_turn(tmp_path, mode="silence", llm=None, settings_patch=None, study=None):
    settings = SettingsStore(tmp_path / "settings.json")
    settings.update({"input": {"mode": mode}, "engagement": {"proactive": False}})
    if settings_patch:
        settings.update(settings_patch)
    conversation = ConversationStore(tmp_path / "history.json")
    events = []

    async def broadcast(event):
        events.append(event)

    llm = llm or FakeLLM()
    turn = TurnManager(
        settings=settings,
        llm=llm,
        conversation=conversation,
        broadcast=broadcast,
        study=study,
    )
    return turn, llm, conversation, events


async def wait_idle(turn, timeout=2.0):
    for _ in range(int(timeout / 0.01)):
        if turn.status in ("idle", "holding") and not turn._generation_task:
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"turn did not finish: {turn.status}")


def test_study_notes_reach_the_prompt(tmp_path):
    turn, _llm, _conversation, _events = make_turn(
        tmp_path,
        settings_patch={"experience": {"mode": "study", "agent_read_notes": True}},
    )
    study = StudyStore(tmp_path / "study.json")
    study.add_note({"text": "Answer in English.", "share": True})
    study.add_note({"text": "private note", "share": False})
    turn.study_store = study
    system = turn._messages_for_prompt(kind="study")[0]["content"]
    assert "Answer in English." in system
    assert "private note" not in system


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


def test_page_splitter_handles_sentinel_across_chunks():
    splitter = PageSplitter(max_pages=4, page_chars=120)
    out = []
    for chunk in ["First page. [[pa", "ge]] Second", " page. [[page]] Third."]:
        out.extend(splitter.feed(chunk))
    pages = splitter.finish()
    assert "".join(text for _, text in out).replace(" ", "") == "Firstpage.Secondpage.Third."
    assert len(pages) == 3
    assert "[[page]]" not in "".join(pages)
    assert sorted({page for page, _ in out}) == [0, 1, 2]


def test_page_splitter_falls_back_to_sentences():
    splitter = PageSplitter(max_pages=4, page_chars=80)
    text = (
        "First sentence is here. Second sentence follows it. "
        "Third sentence is also here. Fourth sentence appears now. "
        "Fifth sentence ends this answer."
    )
    out = splitter.feed(text)
    pages = splitter.finish()
    assert len(pages) > 1
    assert all(len(page) <= 90 for page in pages[:-1])
    assert pages[0].strip().endswith(".")
    assert sorted({page for page, _ in out}) == list(range(len(pages)))


def test_page_splitter_caps_pages_and_merges_overflow():
    splitter = PageSplitter(max_pages=2, page_chars=80)
    text = (
        "One sentence here. Two sentence here. Three sentence here. "
        "Four sentence here. Five sentence here. Six sentence here."
    )
    splitter.feed(text)
    pages = splitter.finish()
    assert len(pages) == 2
    assert "Six sentence here." in pages[-1]


def test_page_splitter_drops_unfinished_sentinel():
    splitter = PageSplitter(max_pages=3, page_chars=120)
    out = splitter.feed("Hello [[pa")
    assert "[[pa" not in "".join(text for _, text in out)
    assert splitter.finish() == ["Hello "]


def test_study_mode_uses_pages_and_metadata(tmp_path):
    async def run():
        turn, llm, conversation, events = make_turn(
            tmp_path,
            "silence",
            llm=StudyFakeLLM(),
            settings_patch={"experience": {"mode": "study"}},
        )
        await turn.handle_text("Explain something")
        await wait_idle(turn)
        reply = conversation.messages[1]
        assert reply["kind"] == "study"
        assert reply["meta"]["page_count"] == 2
        assert len(reply["meta"]["pages"]) == 2
        assert "[[page]]" not in reply["text"]
        assert "First page explains the idea." in reply["meta"]["pages"][0]
        assert llm.options[0]["num_predict"] == 600
        deltas = [event for event in events if event["type"] == "assistant_delta"]
        assert {event["page"] for event in deltas} == {0, 1}
        await turn.close()

    asyncio.run(run())


def test_conversation_mode_has_one_page_and_no_override(tmp_path):
    async def run():
        turn, llm, conversation, events = make_turn(tmp_path, "silence")
        await turn.handle_text("Hello")
        await wait_idle(turn)
        reply = conversation.messages[1]
        assert reply["kind"] == "chat"
        assert "pages" not in reply.get("meta", {})
        assert "num_predict" not in llm.options[0]
        deltas = [event for event in events if event["type"] == "assistant_delta"]
        assert {event["page"] for event in deltas} == {0}
        await turn.close()

    asyncio.run(run())


class LongFakeLLM(FakeLLM):
    async def chat_stream(self, messages, *, cancel=None, options=None):
        self.calls += 1
        self.options.append(dict(options or {}))
        text = (
            "The first idea is simple and calm. It explains what the topic is about. "
            "The second idea adds a little detail, so the picture becomes clearer. "
            "The third idea gives an example that is easy to remember. "
            "The fourth idea connects this to something the reader already knows. "
            "The fifth idea closes the thought and invites a question."
        )
        for index in range(0, len(text), 20):
            if cancel is not None and cancel.is_set():
                return
            yield text[index:index + 20]
            await asyncio.sleep(0)


class CapturingLLM(FakeLLM):
    def __init__(self):
        super().__init__()
        self.messages = []

    async def chat_stream(self, messages, *, cancel=None, options=None):
        self.calls += 1
        self.messages.append(messages)
        self.options.append(dict(options or {}))
        yield "[happy] Hi there."


def test_study_fallback_creates_pages_without_sentinel(tmp_path):
    async def run():
        turn, llm, conversation, events = make_turn(
            tmp_path,
            "silence",
            llm=LongFakeLLM(),
            settings_patch={"experience": {"mode": "study", "study_page_chars": 220}},
        )
        await turn.handle_text("Explain the topic")
        await wait_idle(turn)
        reply = conversation.messages[1]
        assert reply["kind"] == "study"
        assert reply["meta"]["page_count"] > 1
        assert len(reply["meta"]["pages"]) == reply["meta"]["page_count"]
        assert all(len(page) <= 240 for page in reply["meta"]["pages"][:-1])
        # A fallback page break must not become a paragraph break in history.
        assert "\n\n" not in reply["text"]
        await turn.close()

    asyncio.run(run())


def test_poke_in_study_mode_keeps_short_prompt(tmp_path):
    async def run():
        llm = CapturingLLM()
        turn, _, conversation, _ = make_turn(
            tmp_path,
            "silence",
            llm=llm,
            settings_patch={"experience": {"mode": "study"}},
        )
        await turn.poke()
        await wait_idle(turn)
        system = llm.messages[0][0]["content"]
        assert "[[page]]" not in system
        assert "Keep replies short" in system
        assert conversation.messages[-1]["kind"] == "poke"
        await turn.close()

    asyncio.run(run())


class ActionFakeLLM(FakeLLM):
    async def chat_stream(self, messages, *, cancel=None, options=None):
        self.calls += 1
        self.options.append(dict(options or {}))
        for chunk in [
            "[happy] I saved that. ",
            "[[note: Always answer in English.]]",
            " [[word: ephemeral | lasting a short time | The glow faded. | en]]",
        ]:
            if cancel is not None and cancel.is_set():
                return
            yield chunk
            await asyncio.sleep(0)


def test_study_command_parser_extracts_and_hides_actions():
    parser = StudyCommandParser()
    text, commands = parser.feed("Hello [[note: remember this")
    assert text == "Hello "
    assert commands == []
    text2, commands2 = parser.feed("]] world [[word: word | meaning]]")
    assert text2 == " world "
    assert commands2 == [
        ("note", "remember this"),
        ("word", "word | meaning"),
    ]
    tail, tail_commands = parser.flush()
    assert tail == ""
    assert tail_commands == []


def test_study_command_parser_drops_partial_action():
    parser = StudyCommandParser()
    text, commands = parser.feed("Hello [[note: unfinished")
    assert text == "Hello "
    assert commands == []
    tail, tail_commands = parser.flush()
    assert tail == ""
    assert tail_commands == []


def test_companion_can_add_notes_and_words_when_enabled(tmp_path):
    async def run():
        study = StudyStore(tmp_path / "study.json")
        turn, llm, conversation, events = make_turn(
            tmp_path,
            "silence",
            llm=ActionFakeLLM(),
            settings_patch={"experience": {"mode": "study", "agent_write": True}},
            study=study,
        )
        await turn.handle_text("Please remember this and save that word")
        await wait_idle(turn)
        reply = conversation.messages[1]
        assert "[[note:" not in reply["text"]
        assert "[[word:" not in reply["text"]
        assert "I saved that." in reply["text"]
        assert [note["text"] for note in study.notes] == ["Always answer in English."]
        assert study.vocabulary[0]["term"] == "ephemeral"
        assert study.vocabulary[0]["source"] == "companion"
        assert any(event["type"] == "study_changed" for event in events)
        await turn.close()

    asyncio.run(run())


def test_companion_actions_are_ignored_when_disabled(tmp_path):
    async def run():
        study = StudyStore(tmp_path / "study.json")
        turn, llm, conversation, events = make_turn(
            tmp_path,
            "silence",
            llm=ActionFakeLLM(),
            settings_patch={"experience": {"mode": "study", "agent_write": False}},
            study=study,
        )
        await turn.handle_text("Please remember this")
        await wait_idle(turn)
        reply = conversation.messages[1]
        assert "[[note:" not in reply["text"]
        assert "[[word:" not in reply["text"]
        assert study.notes == []
        assert study.vocabulary == []
        await turn.close()

    asyncio.run(run())


def test_shared_notes_are_only_read_when_permitted(tmp_path):
    async def run():
        study = StudyStore(tmp_path / "study.json")
        study.add_note({"text": "Always answer in English.", "share": True})
        llm = CapturingLLM()
        turn, _, _, _ = make_turn(
            tmp_path,
            "silence",
            llm=llm,
            settings_patch={"experience": {"mode": "study", "agent_read_notes": False}},
            study=study,
        )
        await turn.handle_text("Hello")
        await wait_idle(turn)
        assert "Always answer in English." not in llm.messages[0][0]["content"]
        await turn.close()

        llm2 = CapturingLLM()
        turn2, _, _, _ = make_turn(
            tmp_path / "second",
            "silence",
            llm=llm2,
            settings_patch={"experience": {"mode": "study", "agent_read_notes": True}},
            study=study,
        )
        await turn2.handle_text("Hello")
        await wait_idle(turn2)
        assert "Always answer in English." in llm2.messages[0][0]["content"]
        await turn2.close()

    asyncio.run(run())
