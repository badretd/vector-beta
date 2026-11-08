import copy

from vector.config import DEFAULTS
from vector.dialogue import AutoSendJudge, detect_language


def judge(text, *, pending_question=False, **patch):
    settings = copy.deepcopy(DEFAULTS)
    for key, value in patch.items():
        settings["input"]["auto"][key] = value
    return AutoSendJudge().judge(text, settings=settings, pending_question=pending_question)


def test_question_is_sent():
    d = judge("What is the moon made of?")
    assert d.send
    assert d.score >= 3
    assert "question mark +3" in d.reasons


def test_name_is_sent():
    d = judge("Vector, are you there?")
    assert d.send
    assert any("name" in r for r in d.reasons)


def test_plain_statement_is_held():
    d = judge("I was walking to the store yesterday.")
    assert not d.send


def test_russian_question_is_sent():
    d = judge("Почему небо синее?")
    assert d.send
    assert d.language == "ru"


def test_russian_greeting_is_sent():
    d = judge("Привет, Вектор!")
    assert d.send


def test_backchannel_is_held():
    d = judge("да")
    assert not d.send
    assert any("backchannel" in r for r in d.reasons)


def test_backchannel_after_question_is_sent():
    d = judge("да", pending_question=True)
    assert d.send


def test_trailing_conjunction_is_held():
    d = judge("I wanted to ask you something because")
    assert not d.send
    assert any("trailing conjunction" in r for r in d.reasons)


def test_custom_keyword():
    d = judge("the weather is nice", keywords=["weather"])
    assert d.send
    assert any("custom keyword" in r for r in d.reasons)


def test_ignore_keyword():
    d = judge("Vector, ignore this?", ignore_keywords=["ignore"])
    assert not d.send
    assert d.score == -10


def test_question_boost_can_be_disabled():
    d = judge("What is the moon made of?", question_boost=False)
    assert not d.send


def test_language_detection():
    assert detect_language("Привет") == "ru"
    assert detect_language("Hello") == "en"
