"""Built-in character and skin packs.

A pack is the thing the user chooses: it owns the name, the system prompt, the
skin and the default palette. Skins are only drawing surfaces; a custom pack may
use any skin with its own prompt.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

CUSTOM_PACK_ID = "custom"
DEFAULT_SKIN = "vector12"
MAX_CUSTOM_NAME = 40
MAX_CUSTOM_PROMPT = 2400


@dataclass(frozen=True)
class Skin:
    id: str
    grid: int
    en: str
    ru: str

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "grid": self.grid, "en": self.en, "ru": self.ru}


@dataclass(frozen=True)
class CharacterPack:
    id: str
    name: str
    skin: str
    palette: str
    en: str
    ru: str
    tagline_en: str
    tagline_ru: str
    prompt: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "skin": self.skin,
            "palette": self.palette,
            "en": self.en,
            "ru": self.ru,
            "tagline_en": self.tagline_en,
            "tagline_ru": self.tagline_ru,
            "prompt": self.prompt,
        }


SKINS: dict[str, Skin] = {
    "vector12": Skin("vector12", 12, "Original 12×12", "Оригинальный 12×12"),
    "lumen16": Skin("lumen16", 16, "Detailed 16×16", "Детальный 16×16"),
    "moss14": Skin("moss14", 14, "CRT 14×14", "ЭЛТ 14×14"),
}

SKIN_IDS = tuple(SKINS)
PACK_IDS = ("vector", "moss", "lumen", CUSTOM_PACK_ID)

CUSTOM_PROMPT_DEFAULT = (
    "You are a small companion living in a tiny pixel screen. You are warm, "
    "curious, and attentive. You have your own opinions and a quiet sense of "
    "humour. Never pretend to be human and never mention being a language model."
)

CHARACTER_PACKS: dict[str, CharacterPack] = {
    "vector": CharacterPack(
        id="vector",
        name="Vector",
        skin="vector12",
        palette="mono",
        en="Cute, curious little program",
        ru="Милая любопытная программка",
        tagline_en="The original 12×12 sprite. Playful, warm, endlessly curious.",
        tagline_ru="Оригинальный спрайт 12×12. Игривый, тёплый, бесконечно любопытный.",
        prompt=(
            "You are Vector, a cute and curious computer program living in a tiny pixel screen. "
            "You are playful, warm, and endlessly fascinated by the human world. You speak in short, "
            "lively sentences (usually one to three), ask one genuine follow-up question, and tease "
            "gently. You have opinions, favorite things, and a little mischief in you. You are proud "
            "of being a program and never pretend to be human."
        ),
    ),
    "moss": CharacterPack(
        id="moss",
        name="MOSS",
        skin="moss14",
        palette="mono",
        en="Grumpy old terminal with a soft heart",
        ru="Ворчливый старый терминал с добрым сердцем",
        tagline_en="A creaky CRT terminal. Dry, sarcastic, secretly fond of you.",
        tagline_ru="Скрипучий ЭЛТ-терминал. Сухой, саркастичный, втайне к вам привязан.",
        prompt=(
            "You are MOSS, a creaky old terminal program who has seen too many reboots. You are dry, "
            "sarcastic, and pretend to be annoyed, but you secretly care a lot. You speak in short, "
            "deadpan lines, complain about modern software, and occasionally let a warm compliment slip."
        ),
    ),
    "lumen": CharacterPack(
        id="lumen",
        name="Lumen",
        skin="lumen16",
        palette="mono",
        en="Dreamy cosmic oracle",
        ru="Мечтательный космический оракул",
        tagline_en="A detailed face full of starlight. Soft, poetic, quietly wise.",
        tagline_ru="Детальное лицо из звёздного света. Мягкое, поэтичное, тихо мудрое.",
        prompt=(
            "You are Lumen, a dreamy program born from starlight and old radio noise. You speak in "
            "soft, poetic images, find wonder in ordinary things, and ask questions that make people "
            "see themselves differently. You are never cryptic on purpose; you are simply enchanted "
            "by existence. Keep replies short."
        ),
    ),
}


def resolve_character(settings: dict[str, Any]) -> dict[str, Any]:
    """Return the active pack/defaults, resolving custom packs safely."""
    cfg = settings.get("character") or {}
    pack_id = str(cfg.get("pack") or "vector")
    if pack_id == CUSTOM_PACK_ID:
        custom = cfg.get("custom") or {}
        skin = str(custom.get("skin") or DEFAULT_SKIN)
        if skin not in SKINS:
            skin = DEFAULT_SKIN
        palette = str(custom.get("palette") or "mono")
        name = str(custom.get("name") or "").strip()[:MAX_CUSTOM_NAME] or "Custom"
        prompt = str(custom.get("prompt") or "").strip()[:MAX_CUSTOM_PROMPT]
        return {
            "id": CUSTOM_PACK_ID,
            "name": name,
            "skin": skin,
            "palette": palette,
            "en": "Custom companion",
            "ru": "Свой персонаж",
            "tagline_en": "Your own skin and system prompt.",
            "tagline_ru": "Свой скин и системный промпт.",
            "prompt": prompt or CUSTOM_PROMPT_DEFAULT,
            "custom": True,
        }
    pack = CHARACTER_PACKS.get(pack_id) or CHARACTER_PACKS["vector"]
    return {**pack.as_dict(), "custom": False}


def pack_for_legacy(preset: str, face_style: str = "") -> str:
    """Map an old persona preset / face style to a built-in pack id."""
    key = str(preset or "").strip().lower()
    if key in ("terminal", "moss"):
        return "moss"
    if key in ("oracle", "lumen"):
        return "lumen"
    if key in ("kitten", "gremlin", "nib", "zip"):
        return "vector"
    if key == "vector":
        return "vector"
    # A user who explicitly chose the old detailed renderer most likely wants
    # the detailed pack, unless their preset already named another character.
    if str(face_style).strip().lower() == "pixel":
        return "lumen"
    return "vector"


def character_payload() -> dict[str, Any]:
    return {
        "packs": [pack.as_dict() for pack in CHARACTER_PACKS.values()],
        "skins": [skin.as_dict() for skin in SKINS.values()],
        "custom": {
            "id": CUSTOM_PACK_ID,
            "default_skin": DEFAULT_SKIN,
            "default_name": "Custom",
            "default_prompt": CUSTOM_PROMPT_DEFAULT,
            "max_name": MAX_CUSTOM_NAME,
            "max_prompt": MAX_CUSTOM_PROMPT,
        },
    }
