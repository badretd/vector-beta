from vector.emotions import (
    EmotionStreamParser,
    canonical_emotion,
    emotion_payload,
    emotion_tag_help,
    infer_emotion,
    parse_emotions,
    user_sentiment,
)


def test_parse_simple_tags():
    result = parse_emotions("[curious] Hello there. [happy] I am glad!")
    assert result.text == " Hello there.  I am glad!"
    assert result.emotions == ["curious", "happy"]


def test_streaming_parser_never_leaks_partial_tag():
    parser = EmotionStreamParser()
    out = []
    for chunk in ["[cur", "ious] Hi", " there [hap", "py]!"]:
        out.extend(parser.feed(chunk))
    out.extend(parser.flush())
    text = "".join(v for k, v in out if k == "text")
    emotions = [v for k, v in out if k == "emotion"]
    assert text == " Hi there !"
    assert emotions == ["curious", "happy"]


def test_aliases_and_variants():
    assert canonical_emotion("joy") == "happy"
    assert canonical_emotion("laughs") == "laugh"
    assert canonical_emotion("emotion: excited") == "excited"
    result = parse_emotions("<laughs> [emotion: excited] *wink* (shy)")
    assert result.emotions == ["laugh", "excited", "wink", "embarrassed"]


def test_unknown_tags_are_text():
    result = parse_emotions("[sing] la la [1]")
    assert "[sing]" in result.text
    assert "[1]" in result.text
    assert result.emotions == []


def test_parentheses_only_exact_emotion():
    assert parse_emotions("(happy)").emotions == ["happy"]
    assert parse_emotions("(this is fine)").emotions == []
    assert "(this is fine)" in parse_emotions("(this is fine)").text


def test_infer_emotion():
    assert infer_emotion("What is that?") == "curious"
    assert infer_emotion("haha that is great") == "laugh"
    assert infer_emotion("I am so sad today") == "sad"
    assert infer_emotion("Почему небо синее?") == "curious"


def test_sentiment():
    assert user_sentiment("I love this, thank you!") > 0
    assert user_sentiment("I hate this, it is awful") < 0
    assert user_sentiment("The table is made of wood") == 0


def test_payload_and_help():
    payload = emotion_payload()
    ids = {item["id"] for item in payload}
    assert {"happy", "curious", "love", "glitch"} <= ids
    help_text = emotion_tag_help()
    assert "[happy]" in help_text
    assert "[processing]" not in help_text
    assert "[listening]" not in help_text
