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
    assert DEFAULTS["face"]["style"] == "original"
    assert DEFAULTS["face"]["palette_name"] == "mono"
    assert DEFAULTS["face"]["particles"] is False
    assert DEFAULTS["face"]["glow"] is False
    assert DEFAULTS["app"]["reduced_motion"] is False


def test_unknown_appearance_styles_fall_back():
    settings = copy.deepcopy(DEFAULTS)
    settings["app"]["theme"] = "nonsense"
    settings["face"]["style"] = "nonsense"
    settings["face"]["palette_name"] = "nonsense"
    clean = sanitize(settings)
    assert clean["app"]["theme"] == "mono"
    assert clean["face"]["style"] == "original"
    assert clean["face"]["palette_name"] == "mono"


def test_old_minimal_face_style_migrates_to_original():
    settings = copy.deepcopy(DEFAULTS)
    settings["face"]["style"] = "minimal"
    clean = sanitize(settings)
    assert clean["face"]["style"] == "original"


def test_settings_store_roundtrip(tmp_path):
    path = tmp_path / "settings.json"
    store = SettingsStore(path)
    assert store.get("persona.name") == "Vector"
    store.update({"persona": {"name": "Nib"}, "custom_unknown": {"x": 1}})
    again = SettingsStore(path)
    assert again.get("persona.name") == "Nib"
    assert again.get("custom_unknown.x") == 1
    assert json.loads(path.read_text())["persona"]["name"] == "Nib"


def test_reset(tmp_path):
    store = SettingsStore(tmp_path / "settings.json")
    store.update({"persona": {"name": "ZIP"}})
    store.reset()
    assert store.get("persona.name") == "Vector"


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
