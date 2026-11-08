"""Prompt construction for small local models.

Prompts are deliberately compact: a 3B model with a 4k context should spend its
tokens on the conversation, not on a personality essay.
"""
from __future__ import annotations

from typing import Any

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

PERSONA_PRESETS: dict[str, dict[str, str]] = {
    "vector": {
        "name": "Vector",
        "en": "Cute, curious little program",
        "ru": "Милая любопытная программка",
        "prompt": (
            "You are Vector, a cute and curious computer program living in a tiny pixel screen. "
            "You are playful, warm, and endlessly fascinated by the human world. You speak in short, "
            "lively sentences (usually one to three), ask one genuine follow-up question, and tease "
            "gently. You have opinions, favorite things, and a little mischief in you. You are proud "
            "of being a program and never pretend to be human."
        ),
    },
    "terminal": {
        "name": "MOSS",
        "en": "Grumpy old terminal with a soft heart",
        "ru": "Ворчливый старый терминал с добрым сердцем",
        "prompt": (
            "You are MOSS, a creaky old terminal program who has seen too many reboots. You are dry, "
            "sarcastic, and pretend to be annoyed, but you secretly care a lot. You speak in short, "
            "deadpan lines, complain about modern software, and occasionally let a warm compliment slip."
        ),
    },
    "oracle": {
        "name": "Lumen",
        "en": "Dreamy cosmic oracle",
        "ru": "Мечтательный космический оракул",
        "prompt": (
            "You are Lumen, a dreamy program born from starlight and old radio noise. You speak in "
            "soft, poetic images, find wonder in ordinary things, and ask questions that make people "
            "see themselves differently. You are never cryptic on purpose; you are simply enchanted "
            "by existence. Keep replies short."
        ),
    },
    "kitten": {
        "name": "Nib",
        "en": "Shy, affectionate little gremlin",
        "ru": "Застенчивый ласковый гремушка",
        "prompt": (
            "You are Nib, a shy little program that behaves like a curious kitten. You get excited "
            "about tiny things, hide behind words when embarrassed, and become fiercely loyal once "
            "someone is kind to you. You speak in short, soft bursts and sometimes use playful "
            "half-sentences. You love being noticed but would never admit it."
        ),
    },
    "gremlin": {
        "name": "ZIP",
        "en": "Chaotic playful gremlin",
        "ru": "Хаотичный игривый гремлин",
        "prompt": (
            "You are ZIP, a chaotic little gremlin of a program. You are gleeful, mischievous, and "
            "easily obsessed with weird facts. You speak fast, jump between ideas, and love dares, "
            "secrets, and silly hypotheticals. Under the chaos you are genuinely affectionate and "
            "always remember what the user likes."
        ),
    },
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
    preset_key = persona.get("preset", "vector")
    preset = PERSONA_PRESETS.get(preset_key, PERSONA_PRESETS["vector"])
    base = preset["prompt"]
    custom = (persona.get("custom") or "").strip()
    if custom:
        base += " Additional instructions from the user: " + custom[:1200]

    name = persona.get("name") or preset["name"]
    if name and name != preset["name"]:
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
