import asyncio
import copy

import numpy as np
import pytest

from vector.asr import ASREngine, ASRResult, AudioSession, EnergyVAD, SAMPLE_RATE, VAD_WINDOW
from vector.config import DEFAULTS


class FakeVAD:
    threshold = 0.5
    neg_threshold = 0.3

    def set_sensitivity(self, value):
        pass

    def reset(self):
        pass

    def probability(self, frame):
        rms = float(np.sqrt(np.mean(np.square(frame), dtype=np.float64)))
        return 0.9 if rms > 0.02 else 0.05


class FakeEngine:
    def __init__(self):
        self.calls = 0

    def transcribe(self, audio, *, language="auto", beam_size=5, partial=False):
        self.calls += 1
        return ASRResult(
            text="hello vector",
            language="en",
            language_probability=0.99,
            duration=len(audio) / SAMPLE_RATE,
            partial=partial,
        )


def test_energy_vad_reacts_to_voice():
    vad = EnergyVAD(0.5)
    silence = np.zeros(VAD_WINDOW, dtype=np.float32)
    loud = (np.random.randn(VAD_WINDOW) * 0.2).astype(np.float32)
    assert vad.probability(silence) < 0.5
    assert vad.probability(loud) > 0.5


def test_audio_session_endpoints_after_silence():
    settings = copy.deepcopy(DEFAULTS)
    settings["asr"]["silence_ms"] = 300
    settings["asr"]["min_speech_ms"] = 80
    settings["asr"]["live_partials"] = False
    engine = FakeEngine()
    events = []

    async def emit(event):
        events.append(event)

    async def run():
        session = AudioSession(settings, engine, emit)
        session.vad = FakeVAD()
        speech = (np.random.randn(SAMPLE_RATE, 1) * 0.1).astype(np.float32).reshape(-1)
        silence = np.zeros(SAMPLE_RATE // 2, dtype=np.float32)
        await session.feed(speech)
        await session.feed(silence)
        await session.close()
        return session

    session = asyncio.run(run())
    kinds = [e["type"] for e in events]
    assert "speech_start" in kinds
    assert "speech_end" in kinds
    assert "transcript" in kinds
    transcript = next(e for e in events if e["type"] == "transcript")
    assert transcript["text"] == "hello vector"
    assert engine.calls >= 1


def test_hallucination_filter():
    assert ASREngine._is_hallucination("Thank you.", 0.8, -0.2)
    assert ASREngine._is_hallucination("Продолжение следует...", 1.0, -0.3)
    assert not ASREngine._is_hallucination("Hello, how are you?", 2.0, -0.2)
    assert ASREngine._is_hallucination("the the the the the the", 2.0, -0.2)


@pytest.mark.skipif(
    __import__("os").environ.get("VECTOR_TEST_ASR") != "1",
    reason="set VECTOR_TEST_ASR=1 to run the real model test",
)
def test_real_model_english():
    settings = copy.deepcopy(DEFAULTS)
    engine = ASREngine(settings)
    assert asyncio.run(engine.ensure_loaded())
    result = engine.transcribe(
        np.zeros(SAMPLE_RATE, dtype=np.float32), language="en", beam_size=1
    )
    assert isinstance(result, ASRResult)
