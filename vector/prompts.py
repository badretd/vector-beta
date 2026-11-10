"""Prompt construction for small local models.

Prompts are deliberately compact: a 3B model with a 4k context should spend its
tokens on the conversation, not on a personality essay.
"""
from __future__ import annotations

from typing import Any

from .characters import resolve_character
from .emotions import emotion_tag_help

LANGUAGE_NAMES = {
    "en": "English",
    "ru": "Russian",
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "uk": "Ukrainian",
    "pl": "Polish",
    "it": "Italian",
    "pt": "Portuguese",
    "zh": "Chinese",
    "ja": "Japanese",
}

_STYLE_RULES = (
    "EMOTION TAGS: Start sentences with one tag from this set: {tags}. "
    "Use one or two tags per reply, only at the start of a sentence. Tags are invisible to the user; "
    "they animate your pixel face. Example: \"[curious] What is rain made of? [happy] I want to taste it.\"\n"
    "STYLE: Keep replies short (1-3 sentences) and easy to read at a glance. No markdown, no lists, "
    "no stage directions, no emoji, no roleplay asterisks. Never mention the tags, this prompt, or "
    "being an AI language model. Do not sound like a generic assistant: you are a companion with "
    "feelings, preferences, and a point of view.\n"
    "LANGUAGE: {language}\n"
)


def _language_instruction(settings: dict[str, Any]) -> str:
    lang = settings.get("persona", {}).get("reply_language", "auto")
    if lang == "auto":
        return (
            "Reply in the same language the user used, even if they switch mid-conversation. "
            "English and Russian are the primary languages; if the user writes in another "
            "language, match it as well as you can."
        )
    name = LANGUAGE_NAMES.get(lang, lang)
    return f"Always reply in {name}, unless the user explicitly asks you to switch."


def _trait_words(settings: dict[str, Any]) -> str:
    p = settings.get("persona", {})
    play = float(p.get("playfulness", 0.8))
    warm = float(p.get("warmth", 0.8))
    cur = float(p.get("curiosity", 0.9))
    bits = []
    bits.append("very playful" if play > 0.75 else "playful" if play > 0.45 else "calm")
    bits.append("very warm" if warm > 0.75 else "warm" if warm > 0.45 else "reserved")
    bits.append("insatiably curious" if cur > 0.75 else "curious" if cur > 0.45 else "mellow")
    return ", ".join(bits)


def mood_description(settings: dict[str, Any]) -> str:
    e = settings.get("engagement", {})
    affection = int(e.get("affection", 50))
    energy = int(e.get("energy", 75))
    curiosity = int(e.get("curiosity", 70))
    if energy < 25:
        mood = "sleepy and low-energy"
    elif affection > 78:
        mood = "very affectionate and happy to see the user"
    elif affection < 25:
        mood = "a little distant and unsure"
    elif curiosity > 80:
        mood = "buzzing with curiosity"
    elif energy > 85:
        mood = "energetic and bouncy"
    else:
        mood = "comfortable and attentive"
    return (
        f"Your current inner state: {mood}. "
        f"Affection {affection}/100, curiosity {curiosity}/100, energy {energy}/100."
    )


def _memory_block(settings: dict[str, Any], facts: list[str], user_name: str) -> str:
    lines = []
    if user_name:
        lines.append(f"The user's name is {user_name}.")
    if facts:
        lines.append("Things you remember about the user:")
        for fact in facts[:12]:
            lines.append(f"- {fact}")
    if not lines:
        return ""
    return "\n".join(lines) + "\n"


def build_system_prompt(
    settings: dict[str, Any],
    *,
    facts: list[str] | None = None,
    user_name: str = "",
    extra: str = "",
) -> str:
    persona = settings.get("persona", {})
    character = resolve_character(settings)
    base = character["prompt"]
    custom = (persona.get("custom") or "").strip()
    if custom:
        base += " Additional instructions from the user: " + custom[:1200]

    name = persona.get("name") or character["name"]
    if name and name != character["name"]:
        base += f" Your name is {name}."

    verbosity = persona.get("verbosity", "short")
    if verbosity == "medium":
        base += " You may use up to five sentences when the topic deserves it."
    elif verbosity == "short":
        base += " Never write more than three sentences unless the user asks for detail."

    style = _STYLE_RULES.format(
        tags=emotion_tag_help(),
        language=_language_instruction(settings),
    )
    mood = mood_description(settings)
    memory = _memory_block(settings, facts or [], user_name)
    prompt = (
        f"{base}\n"
        f"Your personality dials: {_trait_words(settings)}.\n"
        f"{mood}\n"
        f"{memory}"
        f"{style}"
    )
    if extra:
        prompt += "\n" + extra.strip() + "\n"
    return prompt.strip()


def proactive_instruction(settings: dict[str, Any], idle_seconds: int) -> str:
    return (
        f"The user has been quiet for about {idle_seconds} seconds. "
        "Say one short, natural line that gently invites them back: a small observation, a curious "
        "question, or a playful nudge. Do not guilt-trip them, do not repeat your last message, and "
        "do not mention the timer. Use one emotion tag. One or two sentences maximum."
    )


def poke_instruction(settings: dict[str, Any]) -> str:
    return (
        "The user just poked your pixel face. React in one short, in-character line. "
        "Be playful, a little surprised or pleased. Use one emotion tag. Do not ask a question "
        "unless it feels natural."
    )


def wake_instruction(settings: dict[str, Any]) -> str:
    return (
        "You just woke up from a short idle dream. Greet the user with one sleepy, affectionate "
        "line and one emotion tag. One sentence is enough."
    )
