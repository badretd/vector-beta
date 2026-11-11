import copy
import json

from vector.config import DEFAULTS, SettingsStore, sanitize, _deep_merge


def test_deep_merge_preserves_siblings():
    merged = _deep_merge(DEFAULTS, {"llm": {"temperature": 0.1}})
    assert merged["llm"]["temperature"] == 0.1
    assert merged["llm"]["model"] == DEFAULTS["llm"]["model"]
    assert merged["app"] == DEFAULTS["app"]


def test_none_removes_key():
    merged = _deep_merge({"a": {"b": 1, "c": 2}}, {"a": {"b": None}})
    assert "b" not in merged["a"]
    assert merged["a"]["c"] == 2


def test_sanitize_clamps_values():
    settings = copy.deepcopy(DEFAULTS)
    settings["llm"]["temperature"] = 99
    settings["asr"]["silence_ms"] = 1
    settings["input"]["mode"] = "nonsense"
    clean = sanitize(settings)
    assert clean["llm"]["temperature"] == 2.0
    assert clean["asr"]["silence_ms"] == 250
    assert clean["input"]["mode"] == "silence"


def test_default_appearance_is_mono_and_original_face():
    assert DEFAULTS["app"]["theme"] == "mono"
    assert DEFAULTS["app"]["pack_chosen"] is False
    assert DEFAULTS["character"]["pack"] == "vector"
    assert DEFAULTS["face"]["skin"] == "vector12"
    assert DEFAULTS["face"]["style"] == "original"
    assert DEFAULTS["face"]["palette_name"] == "mono"
    assert DEFAULTS["face"]["particles"] is False
    assert DEFAULTS["face"]["glow"] is False
    assert DEFAULTS["app"]["reduced_motion"] is False


def test_unknown_appearance_styles_fall_back():
    settings = copy.deepcopy(DEFAULTS)
    settings["app"]["theme"] = "nonsense"
    settings["character"]["pack"] = "nonsense"
    settings["face"]["skin"] = "nonsense"
    settings["face"]["style"] = "nonsense"
    settings["face"]["palette_name"] = "nonsense"
    clean = sanitize(settings)
    assert clean["app"]["theme"] == "mono"
    assert clean["character"]["pack"] == "vector"
    assert clean["face"]["skin"] == "vector12"
    assert clean["face"]["style"] == "original"
    assert clean["face"]["palette_name"] == "mono"


def test_face_separation_defaults_to_inset():
    assert DEFAULTS["face"]["separation"] == "inset"


def test_face_separation_is_sanitized():
    settings = copy.deepcopy(DEFAULTS)
    settings["face"]["separation"] = "nonsense"
    assert sanitize(settings)["face"]["separation"] == "inset"
    settings["face"]["separation"] = "auto"
    assert sanitize(settings)["face"]["separation"] == "inset"
    for mode in ("inset", "gap", "trim", "off"):
        settings["face"]["separation"] = mode
        assert sanitize(settings)["face"]["separation"] == mode


def test_experience_defaults():
    assert DEFAULTS["experience"] == {
        "mode": "conversation",
        "study_pages": 3,
        "study_max_tokens": 600,
        "study_page_chars": 380,
        "notes_font": "sans",
        "notes_font_size": 15,
        "notes_ink": "#2b2118",
        "notes_color": "amber",
    }


def test_experience_is_sanitized():
    settings = copy.deepcopy(DEFAULTS)
    settings["experience"] = {
        "mode": "nonsense",
        "study_pages": 99,
        "study_max_tokens": 9999,
        "study_page_chars": 1,
    }
    clean = sanitize(settings)["experience"]
    assert clean["mode"] == "conversation"
    assert clean["study_pages"] == 6
    assert clean["study_max_tokens"] == 1200
    assert clean["study_page_chars"] == 220

    settings["experience"] = {
        "mode": "study",
        "study_pages": 0,
        "study_max_tokens": 1,
        "study_page_chars": 9999,
    }
    clean = sanitize(settings)["experience"]
    assert clean["mode"] == "study"
    assert clean["study_pages"] == 2
    assert clean["study_max_tokens"] == 256
    assert clean["study_page_chars"] == 700


def test_note_appearance_is_sanitized():
    settings = copy.deepcopy(DEFAULTS)
    settings["experience"].update({
        "notes_font": "nonsense",
        "notes_font_size": 99,
        "notes_ink": "not-a-colour",
        "notes_color": "nonsense",
    })
    clean = sanitize(settings)["experience"]
    assert clean["notes_font"] == "sans"
    assert clean["notes_font_size"] == 22
    assert clean["notes_ink"] == "#2b2118"
    assert clean["notes_color"] == "amber"

    settings["experience"].update({
        "notes_font": "serif",
        "notes_font_size": 1,
        "notes_ink": "#112233",
        "notes_color": "rose",
    })
    clean = sanitize(settings)["experience"]
    assert clean["notes_font"] == "serif"
    assert clean["notes_font_size"] == 12
    assert clean["notes_ink"] == "#112233"
    assert clean["notes_color"] == "rose"


def test_old_minimal_face_style_migrates_to_original():
    settings = copy.deepcopy(DEFAULTS)
    settings["face"]["style"] = "minimal"
    clean = sanitize(settings)
    assert clean["face"]["style"] == "original"


def test_settings_store_roundtrip(tmp_path):
    path = tmp_path / "settings.json"
    store = SettingsStore(path)
    assert store.get("persona.name") == ""
    store.update({"persona": {"name": "Lumen"}, "custom_unknown": {"x": 1}})
    again = SettingsStore(path)
    assert again.get("persona.name") == "Lumen"
    assert again.get("custom_unknown.x") == 1
    assert json.loads(path.read_text())["persona"]["name"] == "Lumen"


def test_reset(tmp_path):
    store = SettingsStore(tmp_path / "settings.json")
    store.update({"persona": {"name": "MOSS"}})
    store.reset()
    assert store.get("persona.name") == ""


def test_legacy_ink_theme_migrates_to_mono():
    settings = copy.deepcopy(DEFAULTS)
    settings["app"]["theme"] = "ink"
    settings["face"]["palette_name"] = "ink"
    clean = sanitize(settings)
    assert clean["app"]["theme"] == "mono"
    assert clean["face"]["palette_name"] == "mono"


def test_effects_are_off_by_default():
    assert DEFAULTS["face"]["particles"] is False
    assert DEFAULTS["face"]["glow"] is False
    assert DEFAULTS["face"]["antenna"] is False


def test_legacy_character_packs_migrate(tmp_path):
    cases = {
        "oracle": ("lumen", "lumen16"),
        "terminal": ("moss", "moss14"),
        "kitten": ("vector", "vector12"),
        "gremlin": ("vector", "vector12"),
    }
    for preset, (pack, skin) in cases.items():
        path = tmp_path / f"{preset}.json"
        path.write_text(json.dumps({
            "persona": {"preset": preset, "name": "Nib"},
            "face": {"style": "pixel"},
            "app": {"onboarded": True},
        }))
        store = SettingsStore(path)
        assert store.get("character.pack") == pack
        assert store.get("face.skin") == skin
        assert store.get("app.pack_chosen") is False


def test_custom_pack_is_sanitized_and_resolved():
    settings = copy.deepcopy(DEFAULTS)
    settings["character"]["pack"] = "custom"
    settings["character"]["custom"] = {
        "name": "  My friend  ",
        "prompt": "Be gentle.",
        "skin": "moss14",
        "palette": "paper",
    }
    clean = sanitize(settings)
    assert clean["character"]["custom"]["name"] == "My friend"
    assert clean["character"]["custom"]["prompt"] == "Be gentle."
    assert clean["face"]["skin"] == "moss14"
    assert clean["face"]["style"] == "pixel"
    assert clean["persona"]["preset"] == "vector"


def test_custom_pack_limits_and_fallbacks():
    settings = copy.deepcopy(DEFAULTS)
    settings["character"]["pack"] = "custom"
    settings["character"]["custom"] = {
        "name": "x" * 100,
        "prompt": "y" * 5000,
        "skin": "nonsense",
        "palette": "nonsense",
    }
    clean = sanitize(settings)
    assert len(clean["character"]["custom"]["name"]) == 40
    assert len(clean["character"]["custom"]["prompt"]) == 2400
    assert clean["character"]["custom"]["skin"] == "vector12"
    assert clean["character"]["custom"]["palette"] == "mono"
