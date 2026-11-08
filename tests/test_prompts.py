import copy

from vector.config import DEFAULTS
from vector.prompts import build_system_prompt, proactive_instruction


def test_prompt_contains_persona_and_rules():
    prompt = build_system_prompt(copy.deepcopy(DEFAULTS), facts=["User likes tea"], user_name="Alex")
    assert "cute and curious computer program" in prompt
    assert "Alex" in prompt
    assert "User likes tea" in prompt
    assert "[curious]" in prompt
    assert "[processing]" not in prompt
    assert "EMOTION TAGS" in prompt
    assert "LANGUAGE" in prompt


def test_prompt_is_compact():
    prompt = build_system_prompt(copy.deepcopy(DEFAULTS), facts=[f"fact {i}" for i in range(12)], user_name="Alex")
    assert len(prompt) < 6000


def test_russian_reply_language():
    settings = copy.deepcopy(DEFAULTS)
    settings["persona"]["reply_language"] = "ru"
    prompt = build_system_prompt(settings)
    assert "Russian" in prompt


def test_custom_persona():
    settings = copy.deepcopy(DEFAULTS)
    settings["persona"]["custom"] = "You are afraid of butterflies."
    prompt = build_system_prompt(settings)
    assert "butterflies" in prompt


def test_proactive_instruction():
    text = proactive_instruction(copy.deepcopy(DEFAULTS), 120)
    assert "quiet" in text
    assert "one" in text.lower()
