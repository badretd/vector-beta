from vector.study import (
    NOTE_LIMIT,
    SHARED_NOTE_CHARS,
    SHARED_NOTE_LIMIT,
    StudyStore,
)


def test_note_crud_and_clamping(tmp_path):
    store = StudyStore(tmp_path / "study.json")
    note = store.add_note({
        "text": "Answer in English.",
        "x": -20,
        "y": 120,
        "width": 9999,
        "color": "nonsense",
        "share": True,
    })
    assert note["text"] == "Answer in English."
    assert note["x"] == 0
    assert note["y"] == 100
    assert note["width"] == 480
    assert note["color"] == "amber"
    assert note["share"] is True

    updated = store.update_note(note["id"], {"text": "Use examples.", "share": False})
    assert updated is not None
    assert updated["text"] == "Use examples."
    assert updated["share"] is False
    assert store.delete_note(note["id"]) is True
    assert store.delete_note(note["id"]) is False


def test_notes_persist_and_are_capped(tmp_path):
    path = tmp_path / "study.json"
    store = StudyStore(path)
    for index in range(NOTE_LIMIT + 5):
        store.add_note({"text": f"note {index}"})
    assert len(store.notes) == NOTE_LIMIT
    again = StudyStore(path)
    assert len(again.notes) == NOTE_LIMIT
    assert again.notes[-1]["text"] == f"note {NOTE_LIMIT + 4}"


def test_shared_notes_are_safe_and_bounded(tmp_path):
    store = StudyStore(tmp_path / "study.json")
    for index in range(SHARED_NOTE_LIMIT + 3):
        store.add_note({"text": ("x" * 400) + str(index), "share": True})
    store.add_note({"text": "private", "share": False})
    shared = store.shared_notes()
    assert len(shared) == SHARED_NOTE_LIMIT
    assert all(len(note) <= SHARED_NOTE_CHARS for note in shared)
    assert "private" not in shared


def test_vocabulary_crud_and_validation(tmp_path):
    store = StudyStore(tmp_path / "study.json")
    assert store.add_word({"term": "   "}) is None
    word = store.add_word({
        "term": "ephemeral",
        "meaning": "lasting a very short time",
        "example": "The ephemeral glow faded.",
        "language": "en",
    })
    assert word is not None
    assert word["term"] == "ephemeral"
    assert word["meaning"].startswith("lasting")

    updated = store.update_word(word["id"], {"meaning": "short-lived"})
    assert updated is not None
    assert updated["meaning"] == "short-lived"

    try:
        store.update_word(word["id"], {"term": ""})
    except ValueError:
        pass
    else:  # pragma: no cover - the store must reject empty terms
        raise AssertionError("empty term should be rejected")

    assert store.delete_word(word["id"]) is True
    assert store.delete_word(word["id"]) is False


def test_replace_and_clear(tmp_path):
    store = StudyStore(tmp_path / "study.json")
    store.replace({
        "notes": [{"text": "one"}, {"text": ""}, "nonsense"],
        "vocabulary": [
            {"term": "one", "meaning": "1"},
            {"term": "", "meaning": "ignored"},
        ],
    })
    assert len(store.notes) == 2
    assert len(store.vocabulary) == 1
    store.clear_vocabulary()
    assert store.vocabulary == []
    assert store.snapshot()["notes"][0]["text"] == "one"
