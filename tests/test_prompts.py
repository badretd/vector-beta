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


def test_builtin_pack_prompts():
    settings = copy.deepcopy(DEFAULTS)
    settings["character"]["pack"] = "moss"
    assert "MOSS" in build_system_prompt(settings)
    settings["character"]["pack"] = "lumen"
    assert "Lumen" in build_system_prompt(settings)


def test_custom_pack_prompt_is_used_as_base():
    settings = copy.deepcopy(DEFAULTS)
    settings["character"]["pack"] = "custom"
    settings["character"]["custom"] = {
        "name": "Orbit",
        "prompt": "You are Orbit, a quiet librarian of small facts.",
        "skin": "lumen16",
        "palette": "mono",
    }
    prompt = build_system_prompt(settings)
    assert "quiet librarian" in prompt
    assert "Your name is Orbit" not in prompt
    assert "EMOTION TAGS" in prompt


def test_pack_name_changes_when_persona_name_overrides():
    settings = copy.deepcopy(DEFAULTS)
    settings["character"]["pack"] = "lumen"
    settings["persona"]["name"] = "Nova"
    prompt = build_system_prompt(settings)
    assert "Lumen" in prompt
    assert "Your name is Nova" in prompt


def test_proactive_instruction():
    text = proactive_instruction(copy.deepcopy(DEFAULTS), 120)
    assert "quiet" in text
    assert "one" in text.lower()
