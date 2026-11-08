# Vector 2

**Vector** is a local voice companion with a tiny animated pixel face. It listens through your microphone, transcribes speech locally with Whisper, streams replies from a local LLM through Ollama, and reacts with facial animations. It **never speaks aloud** — no text-to-speech, no audio replies. Vector types.

The interface is deliberately one screen: a centered face, one line of text at the bottom, and a few almost-invisible controls in the corners. The default character is the original **12×12 white-on-black sprite**, now alive with blinking, gaze, breathing, and mouth movement. A refined **16×16** variant is available in Settings.

![Vector](docs/screenshot.png)

<sub>The default stage: original 12×12 face, one line, no dashboard.</sub>

## Design rules

- **One stage, one face, one line.** No persistent chat panel, HUD, meters, status pills, or toolbars.
- **The character is the interface.** State is expressed by the face: listening, thinking, typing, sleeping, emoting.
- **Original sprite first.** The 12×12 face is the default and the visual identity. The 16×16 variant is optional, for people who want more detail.
- **Calm by default.** Flat black, white face, amber accent, thin borders. Particles, hearts, sparkles, and glow are off unless enabled.
- **Progressive disclosure.** Settings, history, and the debug console appear only when asked for.
- **Local and private.** Audio and text stay on this machine. Whisper, Silero VAD, and Ollama run locally. Only the one-time model download touches the network.
- **No TTS.** The only sounds are tiny optional synthesized UI blips (mic, send, receive, error) — never speech.

## Requirements

- **Python 3.11–3.13** (3.12 recommended; 3.14 may lack wheels for some ML packages).
- **Ollama** running locally — <https://ollama.com/download>.
- **A Chromium-based browser** (Chrome, Chromium, Brave, Edge) for the app-window mode. Firefox works in a normal tab.
- A microphone.
- About 1 GB of free disk space for the default Whisper model, plus your LLM.

You do **not** need PortAudio or any native audio library: the browser captures the microphone and sends 16 kHz PCM to the local server.

## Quick start

### 1. Pull a local model

Small multilingual models work best with a 4k context:

```bash
ollama pull qwen2.5:3b
# or: ollama pull llama3.2:3b
# or: ollama pull phi3:mini
```

The default model is `qwen2.5:3b`. You can change it in **Settings → Advanced**.

### 2. Start Vector

```bash
./run.sh
```

The script creates `.venv`, installs `requirements.txt` on first run, starts the local server, and opens a Chrome app window at `http://127.0.0.1:8765/`.

Manual alternative:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m vector
```

Useful flags:

```bash
python -m vector --no-browser          # print the URL only
python -m vector --tab                 # open a normal browser tab
python -m vector --port 9000
python -m vector --demo                # offline demo companion (no Ollama)
python -m vector --data-dir ./profile  # separate settings/history
```

### 3. First run

The onboarding overlay checks Ollama and the speech model, lets you choose English/Русский, and asks how Vector should look. The default is **Original 12×12** in the **Mono** room. You can also choose the offline demo.

Whisper downloads on first use into `data/models/whisper/`. The default is `small` (~466 MB). A progress/loading state is shown in the readiness checks and the debug console.

## Controls

| Action | Control |
| --- | --- |
| Start / stop microphone | `F9`, or click the background |
| Send typed text | `Enter` |
| New line | `Shift+Enter` |
| Submit buffered speech | `F2` (configurable) |
| Toggle conversation history | `Ctrl+H` |
| Toggle debug console | `Ctrl+Shift+D` |
| Close an overlay / cancel a reply | `Esc` |
| Dismiss a reply | Click the reply |
| Poke Vector | Click the face |
| Resize the character | Scroll |
| Resize the whole UI | `Ctrl+scroll` |

The mode selector disappears at rest. Hover the input area to see `silence · hotkey · auto`, or change it in **Settings → Companion**.

## Turn-taking modes

- **Silence** (default) — Silero VAD detects speech and end-of-speech. After `asr.silence_ms` of silence (default 900 ms), the utterance is transcribed and sent.
- **Hotkey** — speech is transcribed and buffered. Nothing is sent until you press `F2` (or Enter with an empty input).
- **Auto** — each utterance is scored by an explainable judge (questions, direct address, greetings, requests, a pending question from Vector, custom keywords). If the score reaches the threshold (default 3), the buffer is sent. Otherwise it is held, and a force-send timer eventually sends it.

Every score and reason is visible in the debug console.

## The emotion protocol

Vector's system prompt asks the model to begin sentences with one tag from:

`[neutral] [happy] [excited] [curious] [thinking] [sad] [surprised] [confused] [sleepy] [angry] [embarrassed] [love] [proud] [scared] [bored] [wink] [laugh] [glitch]`

Examples:

```text
[curious] What is rain made of? [happy] I want to taste it.
```

The parser accepts `[happy]`, `<happy>`, `*happy*`, `(happy)`, `[emotion: happy]`, and aliases such as `joy`, `laughs`, `shy`, `wow`, `error`. It is a streaming parser, so a tag split across two LLM chunks never leaks into the chat. If the model forgets tags, a small sentiment/lexicon fallback picks an emotion.

The face also has internal states (`listening`, `thinking`, `speaking`, `sleeping`) that are not requested from the model.

## Character

The default character is the original **12×12** pixel face: two eyes and a mouth, drawn from the same geometry as `examples/Happy.png` and friends. It supports:

- Random blinking, occasional double-blinks
- Pointer-following eyes and idle saccades
- Breathing and a very small bob
- Mouth movement while a reply streams
- Smile, frown, side-mouth, open-mouth and O-mouth expressions
- Sleeping (closed eyes, slower breathing)
- Smooth transitions between expressions

The **Refined 16×16** style adds brows, cheeks, an antenna, and optional sparkles/hearts/tears for people who want more expression. Both styles use nearest-neighbour pixel rendering and the same emotion state machine.

The **Face Lab** (`Settings → Character → Open face lab`, or `/lab.html`) shows every emotion, state, palette, size, and motion toggle. It is the fastest way to tune the character.

## Settings

Everything lives in `data/settings.json` and saves automatically.

- **Voice** — interface language, Whisper model, recognition language, microphone, silence before send, mic sensitivity, live partials.
- **Character** — original/refined style, room theme, face palette, size, pointer following, blink, breathing, particles, antenna, reduced motion, colors, face lab.
- **Companion** — name, persona preset, reply language, reply length, turn-taking mode, idle nudges, mood, memory facts.
- **Advanced** — Ollama URL and model, temperature, context, max tokens, ASR device/precision, log level, offline demo, import/export/reset.

Themes are **Mono** (default), **Mint**, and **Paper**. The face palette is independent, so you can put a white face in a mint room or a dark face in a paper room.

## Architecture

```
vector-beta/
├── vector/                 Python backend
│   ├── __main__.py         launcher, browser window, CLI flags
│   ├── server.py           FastAPI, WebSocket hub, REST API, logging
│   ├── config.py           defaults, validation, atomic settings store
│   ├── asr.py              faster-whisper, Silero VAD, endpointing, partials
│   ├── dialogue.py         turn manager, auto-send judge, memory, mood
│   ├── llm.py              async Ollama streaming client + offline demo
│   ├── emotions.py         emotion registry, streaming tag parser
│   ├── prompts.py          compact persona prompts
│   └── ...
├── web/                    no-build frontend
│   ├── index.html          one stage
│   ├── lab.html            face lab
│   ├── css/app.css         mono/mint/paper, drawers, debug
│   ├── js/main.js          state, socket, shortcuts, onboarding
│   ├── js/character.js     procedural pixel character + animation
│   ├── js/audio.js         mic capture + 16 kHz resampler
│   ├── js/pcm-worklet.js   AudioWorklet resampler
│   ├── js/settings.js      generated settings drawer
│   ├── js/debug.js         debug console
│   ├── js/i18n.js          EN/RU
│   └── locales/
├── examples/               original 12×12 reference sprites
├── tests/                  pytest suite
├── requirements.txt
├── run.sh
└── data/                   generated at runtime
```

Audio path: browser `getUserMedia` → AudioWorklet resamples to 16 kHz mono float32 → WebSocket binary → Silero VAD endpointing → faster-whisper → turn manager → Ollama NDJSON stream → emotion parser → WebSocket events → face + chat.

### Performance notes

- Per-client outgoing queues: one slow browser cannot stall the turn manager.
- Assistant deltas are coalesced (~40 ms / 56 chars) before broadcast.
- The frontend writes one text node on `requestAnimationFrame`; it never rebuilds message DOM per token.
- Audio resampling happens in an AudioWorklet, not on the main thread.
- The canvas pauses when the tab is hidden.
- Partials are throttled; the final transcript is the only one that drives the turn manager.
- The character uses a 12×12 or 16×16 logical grid, so drawing stays cheap.

## Debug console

Press `Ctrl+Shift+D` (or click the bug icon). Tabs:

- **logs** — live server logs.
- **chat** — full persisted history with roles, timestamps, emotion tags.
- **events** — raw WebSocket traffic.
- **state** — status, health, settings, server info.
- **asr** — model/device, last transcript, last partial, ASR config.
- **emotions** — emotion grid and reaction timeline.
- **prompt** — the exact system prompt currently sent to the model.

The console can copy the current tab and download a JSON debug snapshot. Logs also go to `data/logs/vector.log`.

## Privacy and no text-to-speech

- Microphone audio is sent only to the local server over `127.0.0.1`.
- Whisper, Silero VAD, and Ollama run locally.
- Settings, history, facts, and logs live in `data/`.
- The first model download contacts Hugging Face; after that, inference is offline.
- The server binds to `127.0.0.1` by default. Do not expose it to a network without adding authentication.
- There is no TTS code path. The only sounds are tiny optional synthesized UI blips.

## Tests

```bash
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q
```

The suite covers the streaming emotion parser, aliases, auto-send scoring in both languages, config merging/validation, memory extraction, prompt compactness, ASR endpointing with a fake engine, and dialogue modes. Set `VECTOR_TEST_ASR=1` to run the real Whisper load test.

## Troubleshooting

**“Ollama is not reachable”** — start Ollama (`ollama serve`), check `curl http://127.0.0.1:11434/api/tags`, and make sure the selected model is pulled. Or enable **Offline demo** in Advanced.

**“Speech model failed to load”** — check `data/logs/vector.log` and the debug ASR tab. Text input still works. Try `device: cpu`, `compute_type: int8`, or a smaller model. The first download needs network access.

**No microphone** — use `http://127.0.0.1` (secure context), allow microphone access in the browser, and check that another app is not holding the device. Chrome app-window mode works; Firefox should be used in a normal tab.

**GPU not used** — the ASR status shows `cpu`. CUDA libraries are missing or the probe failed; install `nvidia-cublas-cu12` / `nvidia-cudnn-cu12`. CPU `small` is still usable.

**Replies are too long/slow** — reduce **max reply tokens**, use `qwen2.5:3b`/`llama3.2:3b`, lower history turns, or increase timeout.

**Face looks frozen** — check **Reduced motion**, **Blinking**, and **Breathing** in Settings → Character. The face uses `requestAnimationFrame`; a background tab throttles animation.

**Face is too stark** — the default is the original 12×12 white sprite. Switch to **Refined 16×16** in Settings → Character for brows, cheeks, and more expression.

## License

MIT. See `LICENSE`.
