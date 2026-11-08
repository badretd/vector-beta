from vector.dialogue import extract_memories


def test_extract_name_and_like():
    facts, name = extract_memories("Hi! My name is Alex and I love old synthesizers.", [])
    assert name == "Alex"
    assert any("Alex" in f for f in facts)
    assert any("synthesizers" in f for f in facts)


def test_extract_russian():
    facts, name = extract_memories("Меня зовут Саша. Я обожаю звёзды.", [])
    assert name == "Саша"
    assert any("звёзды" in f for f in facts)


def test_remember_command():
    facts, _ = extract_memories("Remember that I have a cat named Pixel.", [])
    assert any("cat named Pixel" in f for f in facts)


def test_no_false_name_from_i_am():
    facts, name = extract_memories("I am tired today.", [])
    assert name == ""
    assert facts == []


def test_duplicates_are_not_added():
    existing = ["User likes: tea"]
    facts, _ = extract_memories("I like tea.", existing)
    assert facts == []
