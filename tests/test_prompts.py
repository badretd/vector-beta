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


def test_study_prompt_adds_page_protocol():
    settings = copy.deepcopy(DEFAULTS)
    settings["experience"]["mode"] = "study"
    prompt = build_system_prompt(settings)
    assert "[[page]]" in prompt
    assert "2-3 short pages" in prompt
    assert "check-for-understanding" in prompt
    assert "study mode" in prompt.lower()
    assert "EMOTION TAGS" in prompt
    # The short-reply verbosity instruction must not fight the page rules.
    assert "Never write more than three sentences" not in prompt


def test_conversation_prompt_has_no_page_protocol():
    prompt = build_system_prompt(copy.deepcopy(DEFAULTS))
    assert "[[page]]" not in prompt
    assert "Never write more than three sentences" in prompt


def test_non_chat_study_prompt_stays_short():
    settings = copy.deepcopy(DEFAULTS)
    settings["experience"]["mode"] = "study"
    prompt = build_system_prompt(settings, study=False)
    assert "[[page]]" not in prompt
    assert "Never write more than three sentences" in prompt


def test_study_notes_are_injected_only_in_study_mode():
    settings = copy.deepcopy(DEFAULTS)
    settings["experience"]["mode"] = "study"
    prompt = build_system_prompt(
        settings,
        study_notes=["Always answer in English.", "Use examples."],
    )
    assert "Notes on the user's screen" in prompt
    assert "Always answer in English." in prompt
    assert "Use examples." in prompt

    conversation = build_system_prompt(
        copy.deepcopy(DEFAULTS),
        study_notes=["Always answer in English."],
    )
    assert "Notes on the user's screen" not in conversation

    short = build_system_prompt(
        settings,
        study=False,
        study_notes=["Always answer in English."],
    )
    assert "Notes on the user's screen" not in short


def test_study_notes_are_bounded():
    settings = copy.deepcopy(DEFAULTS)
    settings["experience"]["mode"] = "study"
    notes = [f"rule {index} " + ("x" * 400) for index in range(12)]
    prompt = build_system_prompt(settings, study_notes=notes)
    assert "rule 0" in prompt
    assert "rule 7" in prompt
    assert "rule 8" not in prompt
    assert len(prompt) < 7000


def test_study_actions_only_when_enabled():
    settings = copy.deepcopy(DEFAULTS)
    settings["experience"]["mode"] = "study"
    disabled = build_system_prompt(settings)
    assert "[[note:" not in disabled
    assert "[[word:" not in disabled

    settings["experience"]["agent_write"] = True
    enabled = build_system_prompt(settings)
    assert "[[note: short text]]" in enabled
    assert "[[word: term | meaning | example | language]]" in enabled
    assert "never mention them" in enabled
