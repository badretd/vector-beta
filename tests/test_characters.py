from vector.characters import (
    CHARACTER_PACKS,
    SKINS,
    character_payload,
    pack_for_legacy,
    resolve_character,
)


def test_builtin_packs_and_skins_are_present():
    assert list(CHARACTER_PACKS) == ["vector", "moss", "lumen"]
    assert CHARACTER_PACKS["vector"].skin == "vector12"
    assert CHARACTER_PACKS["moss"].skin == "moss14"
    assert CHARACTER_PACKS["lumen"].skin == "lumen16"
    assert set(SKINS) == {"vector12", "lumen16", "moss14"}


def test_character_payload_is_serialisable():
    payload = character_payload()
    assert [pack["id"] for pack in payload["packs"]] == ["vector", "moss", "lumen"]
    assert [skin["id"] for skin in payload["skins"]] == ["vector12", "lumen16", "moss14"]
    assert payload["custom"]["default_skin"] == "vector12"
    assert payload["custom"]["max_prompt"] > 0


def test_legacy_presets_map_to_packs():
    assert pack_for_legacy("terminal") == "moss"
    assert pack_for_legacy("oracle") == "lumen"
    assert pack_for_legacy("kitten") == "vector"
    assert pack_for_legacy("gremlin") == "vector"
    assert pack_for_legacy("vector", "pixel") == "vector"


def test_custom_pack_resolution_falls_back_safely():
    settings = {
        "character": {
            "pack": "custom",
            "custom": {"name": "", "prompt": "", "skin": "nonsense", "palette": "nonsense"},
        }
    }
    resolved = resolve_character(settings)
    assert resolved["id"] == "custom"
    assert resolved["name"] == "Custom"
    assert resolved["skin"] == "vector12"
    assert resolved["prompt"]
