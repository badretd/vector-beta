"""Speech recognition: Silero VAD + faster-whisper, with graceful fallbacks.

Audio arrives as 16 kHz mono float32 chunks from the browser.  A streaming
Silero VAD (the ONNX model bundled with faster-whisper) finds utterances; the
whisper model then transcribes them.  Partial hypotheses are produced while the
user is still speaking, which makes the interface feel alive.
"""
from __future__ import annotations

import asyncio
import collections
import math
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import numpy as np

# The Xet download path can stall on some Hugging Face mirrors. The plain HTTP
# path is reliable and just as fast for these one-time model downloads.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

from .config import DATA_DIR

SAMPLE_RATE = 16000
VAD_WINDOW = 512  # Silero v6 expects 512 samples at 16 kHz (32 ms)

# Whisper often hallucinates these on silence / short clips.
_HALLUCINATIONS = {
    "thank you.",
    "thanks for watching.",
    "thank you for watching.",
    "subtitles by the amara.org community",
    "продолжение следует...",
    "субтитры сделал dimatorzok",
    "субтитры создавал dimatorzok",
    "спасибо за просмотр!",
    "спасибо за внимание.",
    "редактор субтитров а.синецкая",
    "корректор а.егорова",
}
_HALLUCINATION_RE = re.compile(
    r"^(продолжение следует|субтитры|спасибо за просмотр|thank you for watching|"
    r"thanks for watching|subscribe|подпишись)",
    re.IGNORECASE,
)


@dataclass
class ASRResult:
    text: str = ""
    language: str = ""
    language_probability: float = 0.0
    duration: float = 0.0
    avg_logprob: float = 0.0
    no_speech_prob: float = 0.0
    partial: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "language": self.language,
            "language_probability": round(self.language_probability, 3),
            "duration": round(self.duration, 2),
            "avg_logprob": round(self.avg_logprob, 3),
            "no_speech_prob": round(self.no_speech_prob, 3),
            "partial": self.partial,
        }


class SileroVAD:
    """Streaming wrapper around the bundled Silero v6 ONNX model."""

    def __init__(self, sensitivity: float = 0.55) -> None:
        import onnxruntime as ort
        from faster_whisper.utils import get_assets_path

        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        opts.log_severity_level = 4
        self.session = ort.InferenceSession(
            os.path.join(get_assets_path(), "silero_vad_v6.onnx"),
            providers=["CPUExecutionProvider"],
            sess_options=opts,
        )
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, 64), dtype=np.float32)
        self.set_sensitivity(sensitivity)

    def set_sensitivity(self, value: float) -> None:
        value = max(0.0, min(1.0, float(value)))
        # 0 = only loud clear speech, 1 = very sensitive.
        self.threshold = 0.72 - 0.42 * value
        self.neg_threshold = max(0.08, self.threshold - 0.20)

    def reset(self) -> None:
        self._h[:] = 0
        self._c[:] = 0
        self._context[:] = 0

    def probability(self, chunk: np.ndarray) -> float:
        if chunk.shape[0] != VAD_WINDOW:
            raise ValueError(f"Silero VAD needs {VAD_WINDOW} samples")
        x = np.concatenate([self._context, chunk.reshape(1, -1)], axis=1).astype(np.float32)
        out, self._h, self._c = self.session.run(
            None, {"input": x, "h": self._h, "c": self._c}
        )
        self._context = chunk[-64:].reshape(1, -1).copy()
        return float(out.reshape(-1)[0])


class EnergyVAD:
    """Fallback VAD for machines without onnxruntime."""

    def __init__(self, sensitivity: float = 0.55) -> None:
        self.set_sensitivity(sensitivity)
        self._noise = 0.004

    def set_sensitivity(self, value: float) -> None:
        self.sensitivity = max(0.0, min(1.0, float(value)))

    def reset(self) -> None:
        self._noise = 0.004

    def probability(self, chunk: np.ndarray) -> float:
        rms = float(np.sqrt(np.mean(np.square(chunk), dtype=np.float64)) + 1e-9)
        threshold = max(0.0045, self._noise * (3.2 - 1.4 * self.sensitivity))
        prob = min(1.0, rms / max(threshold, 1e-6) * 0.55)
        if prob < 0.45:
            self._noise = 0.97 * self._noise + 0.03 * rms
        return prob


class ASREngine:
    """Lazy faster-whisper model holder with automatic CPU fallback."""

    def __init__(self, settings: dict[str, Any], status_cb: Callable[[dict], None] | None = None) -> None:
        self.settings = settings
        self.status_cb = status_cb
        self._model = None
        self._lock = threading.RLock()
        self._load_lock = asyncio.Lock()
        self._loaded_key: tuple | None = None
        self._load_failed = False
        self._last_error = ""
        self.device = "cpu"
        self.compute_type = "int8"
        self.model_name = "small"
        self.loading = False
        self.ready = False
        self._language_warned = False

    # -- status ---------------------------------------------------------
    def _status(self, **extra: Any) -> dict[str, Any]:
        data = {
            "ready": self.ready,
            "loading": self.loading,
            "model": self.model_name,
            "device": self.device,
            "compute_type": self.compute_type,
            "error": self._last_error,
        }
        data.update(extra)
        if self.status_cb:
            try:
                self.status_cb(data)
            except Exception:  # noqa: BLE001 - status must never break audio
                pass
        return data

    def status(self) -> dict[str, Any]:
        return self._status()

    def configure(self, settings: dict[str, Any]) -> None:
        self.settings = settings
        cfg = settings.get("asr", {})
        self.model_name = str(cfg.get("model", "small"))

    def _key(self) -> tuple:
        cfg = self.settings.get("asr", {})
        return (
            str(cfg.get("model", "small")),
            str(cfg.get("device", "auto")),
            str(cfg.get("compute_type", "auto")),
        )

    async def ensure_loaded(self) -> bool:
        async with self._load_lock:
            key = self._key()
            if self._model is not None and self._loaded_key == key:
                return True
            if self.loading:
                return self._model is not None
            self.loading = True
            self.ready = False
            self._last_error = ""
            self._status(message="loading")
            try:
                await asyncio.to_thread(self._load_sync)
                self.ready = True
                self._load_failed = False
                self._status(message="ready")
                return True
            except Exception as exc:  # noqa: BLE001
                self._last_error = f"{type(exc).__name__}: {exc}"
                self.ready = False
                self._load_failed = True
                self._status(message="error", error=self._last_error)
                return False
            finally:
                self.loading = False

    def _load_sync(self) -> None:
        from faster_whisper import WhisperModel

        cfg = self.settings.get("asr", {})
        model_name = str(cfg.get("model", "small"))
        requested = str(cfg.get("device", "auto"))
        compute = str(cfg.get("compute_type", "auto"))
        download_root = str(DATA_DIR / "models" / "whisper")
        os.makedirs(download_root, exist_ok=True)

        candidates: list[tuple[str, str]] = []
        if requested in ("auto", "cuda"):
            cuda_compute = compute
            if compute == "auto":
                try:
                    import ctranslate2

                    supported = ctranslate2.get_supported_compute_types("cuda")
                    cuda_compute = "int8_float16" if "int8_float16" in supported else "int8" if "int8" in supported else "float16"
                except Exception:  # noqa: BLE001
                    cuda_compute = "int8"
            candidates.append(("cuda", cuda_compute))
        if requested in ("auto", "cpu", "cuda"):
            cpu_compute = compute if compute not in ("auto", "int8_float16") else "int8"
            if requested != "cuda":
                candidates.append(("cpu", cpu_compute))
            else:
                # Even an explicit CUDA request should degrade gracefully.
                candidates.append(("cpu", cpu_compute))

        errors = []
        for device, ctype in candidates:
            try:
                model = WhisperModel(
                    model_name,
                    device=device,
                    compute_type=ctype,
                    download_root=download_root,
                    cpu_threads=max(1, min(8, (os.cpu_count() or 4) - 1)),
                    num_workers=1,
                )
                if device == "cuda":
                    # A CUDA device can be visible while the runtime libraries
                    # (libcublas/libcudnn) are missing. Probe with one second of
                    # silence so the first real utterance does not fail.
                    try:
                        list(model.transcribe(
                            np.zeros(SAMPLE_RATE, dtype=np.float32),
                            language="en",
                            beam_size=1,
                            vad_filter=False,
                        )[0])
                    except Exception as exc:  # noqa: BLE001
                        errors.append(f"cuda probe: {type(exc).__name__}: {exc}")
                        continue
                with self._lock:
                    self._model = model
                    self._loaded_key = self._key()
                    self.device = device
                    self.compute_type = ctype
                    self.model_name = model_name
                return
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{device}/{ctype}: {type(exc).__name__}: {exc}")
        raise RuntimeError("; ".join(errors) or "no usable device")

    def _fallback_cpu(self) -> None:
        """Called if CUDA is present but its runtime libraries are missing."""
        from faster_whisper import WhisperModel

        cfg = self.settings.get("asr", {})
        model_name = str(cfg.get("model", "small"))
        with self._lock:
            self._model = WhisperModel(
                model_name,
                device="cpu",
                compute_type="int8",
                download_root=str(DATA_DIR / "models" / "whisper"),
                cpu_threads=max(1, min(8, (os.cpu_count() or 4) - 1)),
                num_workers=1,
            )
            self.device = "cpu"
            self.compute_type = "int8"
            self._loaded_key = self._key()
            self._last_error = "CUDA runtime unavailable; using CPU"
        self._status(message="cpu-fallback")

    def transcribe(
        self,
        audio: np.ndarray,
        *,
        language: str = "auto",
        beam_size: int = 5,
        partial: bool = False,
    ) -> ASRResult:
        if audio is None or audio.size < SAMPLE_RATE * 0.25:
            return ASRResult(partial=partial)
        audio = np.ascontiguousarray(audio, dtype=np.float32)
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 1.0:
            audio = audio / peak
        if peak < 1e-5:
            return ASRResult(partial=partial)

        model = self._model
        if model is None:
            return ASRResult(partial=partial)

        lang = None if language in ("auto", "", None) else language
        kwargs: dict[str, Any] = {
            "language": lang,
            "beam_size": max(1, int(beam_size if not partial else 1)),
            "best_of": 1 if partial else max(1, int(beam_size)),
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "without_timestamps": True,
            "word_timestamps": False,
            "vad_filter": not partial,
            "vad_parameters": {
                "min_silence_duration_ms": 350,
                "speech_pad_ms": 200,
            } if not partial else None,
            "no_speech_threshold": 0.55 if not partial else 0.7,
            "log_prob_threshold": -1.2 if not partial else -2.0,
            "compression_ratio_threshold": 2.6,
        }
        try:
            with self._lock:
                segments, info = model.transcribe(audio, **kwargs)
                texts: list[str] = []
                logprobs: list[float] = []
                no_speech: list[float] = []
                for seg in segments:
                    t = (seg.text or "").strip()
                    if t:
                        texts.append(t)
                    if getattr(seg, "avg_logprob", None) is not None:
                        logprobs.append(float(seg.avg_logprob))
                    if getattr(seg, "no_speech_prob", None) is not None:
                        no_speech.append(float(seg.no_speech_prob))
        except RuntimeError as exc:
            # Typical CUDA failure: missing libcublas. Recover once on CPU.
            if "cublas" in str(exc).lower() or "cudnn" in str(exc).lower():
                try:
                    self._fallback_cpu()
                    return self.transcribe(
                        audio, language=language, beam_size=beam_size, partial=partial
                    )
                except Exception:  # noqa: BLE001
                    pass
            raise

        text = " ".join(texts).strip()
        text = re.sub(r"\s+", " ", text)
        duration = float(audio.size) / SAMPLE_RATE
        avg_logprob = float(sum(logprobs) / len(logprobs)) if logprobs else -1.0
        no_speech_prob = float(max(no_speech)) if no_speech else 0.0
        if self._is_hallucination(text, duration, avg_logprob):
            text = ""
        return ASRResult(
            text=text,
            language=getattr(info, "language", "") or (lang or ""),
            language_probability=float(getattr(info, "language_probability", 0.0) or 0.0),
            duration=duration,
            avg_logprob=avg_logprob,
            no_speech_prob=no_speech_prob,
            partial=partial,
        )

    @staticmethod
    def _is_hallucination(text: str, duration: float, avg_logprob: float) -> bool:
        if not text:
            return False
        low = text.lower().strip(" .!?…")
        if low in {h.strip(" .!?…") for h in _HALLUCINATIONS}:
            return True
        if duration < 1.6 and _HALLUCINATION_RE.match(text):
            return True
        if avg_logprob < -1.6 and len(text) > 80:
            return True
        # A single repeated token/phrase on a short clip is usually a whisper loop.
        words = re.findall(r"\w+", low)
        if len(words) >= 6 and len(set(words)) <= 2:
            return True
        return False

    async def close(self) -> None:
        with self._lock:
            self._model = None
            self._loaded_key = None
            self.ready = False


# --------------------------------------------------------------------------
# Streaming session
# --------------------------------------------------------------------------

@dataclass
class AudioStats:
    chunks: int = 0
    frames: int = 0
    speech_frames: int = 0
    utterances: int = 0
    last_prob: float = 0.0
    last_rms: float = 0.0


class AudioSession:
    """Per-connection endpointing + transcription state machine."""

    def __init__(
        self,
        settings: dict[str, Any],
        engine: ASREngine,
        emit: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        self.settings = settings
        self.engine = engine
        self.emit = emit
        self.vad: SileroVAD | EnergyVAD
        self._make_vad()
        self._pending = np.zeros(0, dtype=np.float32)
        self._pre_roll: collections.deque[np.ndarray] = collections.deque(maxlen=24)
        self._utterance: list[np.ndarray] = []
        self._speaking = False
        self._speech_run = 0
        self._silence_run = 0
        self._speech_samples = 0
        self._last_partial_at = 0.0
        self._partial_task: asyncio.Task | None = None
        self._final_lock = asyncio.Lock()
        self._closed = False
        self._last_language = ""
        self.stats = AudioStats()

    def _make_vad(self) -> None:
        cfg = self.settings.get("asr", {})
        sensitivity = float(cfg.get("vad_sensitivity", 0.55))
        if cfg.get("vad", "silero") == "silero":
            try:
                self.vad = SileroVAD(sensitivity)
                return
            except Exception:  # noqa: BLE001
                pass
        self.vad = EnergyVAD(sensitivity)

    def configure(self, settings: dict[str, Any]) -> None:
        self.settings = settings
        cfg = settings.get("asr", {})
        want = cfg.get("vad", "silero")
        if want == "energy" and not isinstance(self.vad, EnergyVAD):
            self.vad = EnergyVAD(float(cfg.get("vad_sensitivity", 0.55)))
        elif want == "silero" and not isinstance(self.vad, SileroVAD):
            try:
                self.vad = SileroVAD(float(cfg.get("vad_sensitivity", 0.55)))
            except Exception:  # noqa: BLE001
                self.vad = EnergyVAD(float(cfg.get("vad_sensitivity", 0.55)))
        self.vad.set_sensitivity(float(cfg.get("vad_sensitivity", 0.55)))

    def _silence_ms(self) -> int:
        return int(self.settings.get("asr", {}).get("silence_ms", 900))

    def _max_samples(self) -> int:
        return int(self.settings.get("asr", {}).get("max_utterance_s", 30) * SAMPLE_RATE)

    def _min_speech_samples(self) -> int:
        return int(self.settings.get("asr", {}).get("min_speech_ms", 260) * SAMPLE_RATE / 1000)

    async def feed(self, samples: np.ndarray) -> None:
        if self._closed or not self.settings.get("asr", {}).get("enabled", True):
            return
        samples = np.asarray(samples, dtype=np.float32).reshape(-1)
        if samples.size == 0:
            return
        self.stats.chunks += 1
        self._pending = np.concatenate([self._pending, samples]) if self._pending.size else samples.copy()
        while self._pending.size >= VAD_WINDOW:
            frame = self._pending[:VAD_WINDOW]
            self._pending = self._pending[VAD_WINDOW:]
            await self._process_frame(frame)

    async def _process_frame(self, frame: np.ndarray) -> None:
        self.stats.frames += 1
        try:
            prob = self.vad.probability(frame)
        except Exception:  # noqa: BLE001
            prob = 0.0
        rms = float(np.sqrt(np.mean(np.square(frame), dtype=np.float64)) + 1e-9)
        self.stats.last_prob = prob
        self.stats.last_rms = rms
        threshold = getattr(self.vad, "threshold", 0.5)
        neg = getattr(self.vad, "neg_threshold", threshold - 0.2)
        speech = prob >= (neg if self._speaking else threshold)

        if not self._speaking:
            self._pre_roll.append(frame.copy())
            if speech:
                self._speech_run += 1
                if self._speech_run >= 2:
                    self._speaking = True
                    self._silence_run = 0
                    self._speech_samples = 0
                    self._utterance = list(self._pre_roll)
                    self._pre_roll.clear()
                    self._speech_samples = sum(a.size for a in self._utterance)
                    self.stats.speech_frames += self._speech_run
                    self._last_partial_at = time.monotonic()
                    await self.emit({"type": "speech_start"})
            else:
                self._speech_run = 0
            return

        self._utterance.append(frame.copy())
        self._speech_samples += frame.size
        self.stats.speech_frames += 1
        if speech:
            self._silence_run = 0
        else:
            self._silence_run += 1

        silence_samples = self._silence_run * VAD_WINDOW
        if silence_samples >= int(self._silence_ms() * SAMPLE_RATE / 1000):
            await self._finalize()
            return
        if self._speech_samples >= self._max_samples():
            await self._finalize()
            return

        now = time.monotonic()
        interval = float(self.settings.get("asr", {}).get("partial_interval_ms", 1000)) / 1000
        if (
            self.settings.get("asr", {}).get("live_partials", True)
            and now - self._last_partial_at >= interval
            and self._speech_samples >= SAMPLE_RATE * 0.7
            and (self._partial_task is None or self._partial_task.done())
        ):
            self._last_partial_at = now
            audio = np.concatenate(self._utterance)
            self._partial_task = asyncio.create_task(self._partial(audio))

    async def _partial(self, audio: np.ndarray) -> None:
        try:
            cfg = self.settings.get("asr", {})
            result = await asyncio.to_thread(
                self.engine.transcribe,
                audio,
                language=str(cfg.get("language", "auto")),
                beam_size=1,
                partial=True,
            )
            if result.text:
                await self.emit(
                    {
                        "type": "asr_partial",
                        "text": result.text,
                        "language": result.language or self._last_language,
                        "duration": round(result.duration, 2),
                    }
                )
        except Exception:  # noqa: BLE001 - partials are best-effort
            return

    async def _finalize(self) -> None:
        if not self._speaking:
            return
        audio = np.concatenate(self._utterance) if self._utterance else np.zeros(0, dtype=np.float32)
        self._speaking = False
        self._utterance = []
        self._speech_run = 0
        self._silence_run = 0
        self._speech_samples = 0
        self._pre_roll.clear()
        await self.emit({"type": "speech_end"})
        if audio.size < self._min_speech_samples():
            return
        async with self._final_lock:
            try:
                cfg = self.settings.get("asr", {})
                result = await asyncio.to_thread(
                    self.engine.transcribe,
                    audio,
                    language=str(cfg.get("language", "auto")),
                    beam_size=int(cfg.get("beam_size", 5)),
                    partial=False,
                )
                if result.language:
                    self._last_language = result.language
                if result.text:
                    self.stats.utterances += 1
                    await self.emit(
                        {
                            "type": "transcript",
                            "text": result.text,
                            "final": True,
                            **result.as_dict(),
                        }
                    )
                else:
                    await self.emit({"type": "asr_empty", "duration": round(result.duration, 2)})
            except Exception as exc:  # noqa: BLE001
                await self.emit({"type": "error", "scope": "asr", "message": str(exc)})

    async def flush(self, emit_transcript: bool = True) -> str:
        """Force endpointing, used by the submit hotkey and mic stop."""
        if not self._speaking:
            return ""
        audio = np.concatenate(self._utterance) if self._utterance else np.zeros(0, dtype=np.float32)
        self._speaking = False
        self._utterance = []
        self._speech_run = 0
        self._silence_run = 0
        self._speech_samples = 0
        self._pre_roll.clear()
        await self.emit({"type": "speech_end"})
        if audio.size < self._min_speech_samples():
            return ""
        async with self._final_lock:
            cfg = self.settings.get("asr", {})
            result = await asyncio.to_thread(
                self.engine.transcribe,
                audio,
                language=str(cfg.get("language", "auto")),
                beam_size=int(cfg.get("beam_size", 5)),
                partial=False,
            )
            if result.language:
                self._last_language = result.language
            if result.text:
                self.stats.utterances += 1
                if emit_transcript:
                    await self.emit(
                        {
                            "type": "transcript",
                            "text": result.text,
                            "final": True,
                            **result.as_dict(),
                        }
                    )
                return result.text
        return ""

    def reset(self) -> None:
        self._pending = np.zeros(0, dtype=np.float32)
        self._pre_roll.clear()
        self._utterance = []
        self._speaking = False
        self._speech_run = 0
        self._silence_run = 0
        self._speech_samples = 0
        self.vad.reset()

    async def close(self) -> None:
        self._closed = True
        if self._partial_task and not self._partial_task.done():
            self._partial_task.cancel()
        self.reset()
