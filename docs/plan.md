# Vector Development Plan

**Status:** Milestone 2 complete. Milestone 3 not started.
**Last updated:** 2026-11-10
**Purpose:** source of truth for the remaining phases, approved decisions, and handoff context between development sessions.

Read this document before starting a new phase. Update the status and “current state” section after each milestone.

---

## 1. How to use this document

- The golden rule: after every major milestone, stop, run the checks, and let the user review and commit before starting the next milestone.
- Keep changes consistent with the existing no-build frontend, Python/FastAPI backend, and the project’s design rules.
- Do not silently expand scope. Items marked “later” are not part of the current milestone.
- Avoid “AI slop”: prefer a small, coherent implementation over a large pile of settings and unused abstractions.
- When resuming, read this file first, then run the verification commands in section 11.

---

## 2. Locked product decisions

These were approved by the user and should not be re-litigated without a reason.

### Experience modes
- Two modes: **Conversation** and **Study**.
- Conversation mode preserves the current behaviour exactly.
- Study mode allows longer answers split across pages.
- The setting key is `experience.mode` (`conversation` | `study`).
- `input.mode` remains the turn-taking mode (`silence` | `hotkey` | `auto`). The UI label for turn-taking should be renamed from “Turn-taking” to “Listening” to avoid two different things called “mode”.

### Study replies
- Use **one paginated reply card**, not stacked cards or floating windows.
- Page controls: `‹ 1 / 3 ›` plus dots.
- New pages do not yank the reader away. A subtle “new page ready” indicator is enough.
- Keyboard Left/Right navigates pages while a reply is visible.
- The full answer is stored in history with a `study` tag.
- History is shared between modes but tagged; an optional mode filter is a later improvement.

### Character packs
- Built-in packs: **Vector**, **MOSS**, **Lumen**.
- Vector: original 12×12 skin.
- MOSS: new CRT skin, first pass already implemented at 14×14.
- Lumen: reuse the existing detailed 16×16 renderer, with refinements.
- Nib and ZIP are removed.
- Legacy migration: `terminal → MOSS`, `oracle → Lumen`, `kitten` / `gremlin → Vector`.
- Custom pack: choose any of the three skins, a name, a default palette, and a **base persona prompt**.
- The custom prompt is the persona base, not a total system-prompt replacement. Emotion-tag and mode/style rules remain appended so the face keeps working.
- Existing users see a one-time pack chooser. Custom names are preserved.

### Sticky notes
- Study-mode feature.
- Draggable notes layer with plain text.
- Font family (sans / serif / mono), size, ink colour, and note colour are configurable.
- System fonts only; no web fonts.
- Each note has a **“use as a rule”** toggle. Shared notes are injected into the study prompt with strict caps.
- Notes are hidden in Conversation mode but preserved.
- No rotation, confetti, or dashboard.

### Vocabulary
- Study-mode-only menu/drawer.
- Fields: term, meaning/translation, example, language, source, created time.
- Add form prefills from selected text in a study reply.
- Search, edit, delete, export JSON/CSV.
- Store in `data/study.json`.
- “Ask the companion for a definition” is a later opt-in, not part of the first cut.

### Smart pixel separation
- Collision-aware, not a blanket gap that changes every frame.
- Detect actual overlap or 8-neighbour touch between eye cells and mouth cells.
- Modes: `inset` (default), `gap`, `trim`, `off`. The old `auto` value migrates to `inset`.
- `inset`: shave a thin (about 1–3 screen pixel) band from the mouth edge or corner facing the eyes, so it never overlaps. The eyes keep their full pixels; if the mouth pixel truly overlaps an eye cell, the mouth yields that cell. No whole sprite cells are removed from the eyes.
- `gap`: clear a 1-cell halo around the eyes with `destination-out`, then redraw the eyes.
- `trim`: clear only the offending mouth cells, then redraw the eyes.
- `gap` and `trim` are explicit legacy/comparison modes; whole-cell clipping is off by default.
- Applies to Vector 12×12 and MOSS; Lumen can use the same switch but should rarely trigger.
- Remove any alpha-dimmed intersection pixel; the seam is a hard transparent gap.
- Face Lab gets a separation selector and a collision overlay.

### Study-mode model warning (user hardware constraint)
The user’s machine is **16 GB RAM, CPU-only, with a practical ceiling around 4B models**. The warning must be honest but not demand hardware they do not have.

Approved warning direction:

> Study mode uses longer, multi-page answers. A 3B–4B instruction-tuned model with at least 4k context is the practical minimum on a 16 GB CPU-only machine — for example `qwen2.5:3b`, `llama3.2:3b`, or a 4B model you already use. Larger models produce better structure, but are not required. On CPU, expect slower responses; keep pages at 2–3 and max tokens around 600. If the model forgets page breaks, the app splits paragraphs automatically.

Minimum metric to show in the UI/docs:
- **≥ 3B parameters**
- **≥ 4k context**
- **instruction-tuned**
- **4B recommended** for this machine
- **7B ideal but optional**

The default conversation model remains `qwen2.5:3b`; Study mode should default to **3 pages** and **~600 max tokens** on this machine, not 4–5 pages and 700+ tokens.

---

## 3. Milestones

| Milestone | Scope | Status |
| --- | --- | --- |
| **M0** | Refine ideas, get approval, write this plan | Done |
| **M1** | Character packs, skins, custom packs, onboarding/settings, migration | Done |
| **M2** | Smart pixel separation, MOSS polish, Face Lab controls | Done |
| **M3** | Study mode core: mode switch, paginated replies, prompt, warning | Not started |
| **M4** | Study utilities: sticky notes, vocabulary, menu, export, docs | Not started |

Each milestone ends with:
- `pytest -q`
- `node --check` for every `web/js/*.js`
- manual visual review in the Face Lab and main stage
- README / README.ru / i18n updates where relevant
- a stop for user review and commit

---

## 4. Current state after M2

### Implemented in M2
- `vector/config.py`, `tests/test_config.py`:
  - `face.separation` default `inset`, sanitised to `inset` / `gap` / `trim` / `off`; legacy `auto` migrates to `inset`.
  - Default and fallback tests.
- `web/js/character.js`:
  - Eye/mouth cell recording and a collision-aware `separate()` pass.
  - `inset`/`gap`/`trim`/`off`; `inset` shaves a thin band from the mouth edge or corner facing the eyes instead of deleting a whole cell.
  - The eyes keep their full pixels in `inset` mode.
  - `gap`/`trim` use hard `destination-out` clearing for comparison; `inset` leaves no dimmed intersection pixels.
  - Collision overlay data and `debugCollision` markers.
  - Draw order: eyes → mouth → other parts → separation → brows.
  - Original `laugh` frame is untouched.
  - MOSS polish: 3×2 phosphor eye sockets with one pupil, caret happy eyes, flatter neutral mouth, shallow smile/frown, smaller blush, quieter scanline (skipped under reduced motion).
- `web/js/main.js`:
  - `applySettings` passes the separation mode to the character.
  - Onboarding pack previews now follow the selected room/palette, and re-render on theme changes.
- `web/js/settings.js`:
  - Character tab has a “Smart separation” selector with Inset edges / Background gap / Trim pixels / Off.
- `web/js/lab.js`, `web/lab.html`, `web/css/lab.css`:
  - Separation selector, collision overlay checkbox, `?separation=` and `?reduced=` URL support.
  - Status line includes the separation mode.
  - Neutral emotion is now actually shown (the old guard left the preview on Happy).
  - Lab canvas scales and centres correctly at desktop and 480 px widths.
- `web/css/app.css`:
  - Shared canvas sizing for `#character` and `#lab-character`.
- Docs and i18n:
  - README / README.ru updated.
  - EN/RU strings for the separation controls.

### Carried over from M1
- `vector/characters.py`: packs, skins, custom-pack resolution, legacy mapping, API payload.
- `vector/config.py`: settings version 3, `character.pack`, `character.custom`, `app.pack_chosen`, `face.skin`, legacy migration.
- `vector/prompts.py`: resolved pack prompts; Nib/ZIP removed.
- `vector/server.py`: `/api/characters` and `characters` in `hello`.
- Frontend: onboarding pack chooser, custom pack fields, one-time pack chooser, settings selectors.
- `tests/test_characters.py`, config and prompt tests.

### Verification at M2
- `pytest -q` → 60 passed, 1 skipped.
- `node --check` passes for all frontend modules.
- `git diff --check` clean.
- Headless Chrome review: all MOSS emotions, Vector collisions in `proud` / `wink` / `happy`, Lumen `surprised`, collision overlay, settings selector, onboarding previews in Mono/Mint/Paper, Face Lab at 900 px and 480 px.
- Verified `inset` is pixel-identical to `off` when no collision exists (except intentionally random glitch particles).
- `PATCH /api/settings` persists valid separation modes and sanitises invalid values to `inset`.

### Known limitations
- MOSS eyes and mouth are far apart by design, so separation rarely triggers there even though the engine supports it.
- `gap` and `trim` can look identical when no other feature sits inside the eye halo; they are kept for comparison, while `inset` is the default.
- The inset seam is a few backing pixels; its on-screen thickness scales slightly with the face size because it stays on the sprite grid.
- No Study mode, notes, or vocabulary yet.

---

## 5. M2 — Smart separation + MOSS/Face Lab polish

### Goal
Make the 12×12 face and MOSS look clean when eyes and mouth come close, and give the Face Lab enough controls to prove it across every emotion, gaze direction, scale, and reduced-motion state.

### 5.1 Settings
Add to `DEFAULTS["face"]`:
```json
"separation": "inset"
```
Allowed values: `inset`, `gap`, `trim`, `off`; legacy `auto` migrates to `inset`.

Sanitise in `vector/config.py`:
```python
if s["face"].get("separation") == "auto":
    s["face"]["separation"] = "inset"
if s["face"].get("separation") not in ("inset", "gap", "trim", "off"):
    s["face"]["separation"] = "inset"
```

Frontend:
- `applySettings` passes `separation` to the character.
- Settings → Character gets a “Smart separation” select:
  - Inset edges (default)
  - Background gap
  - Trim pixels
  - Off
- Add i18n keys in EN/RU.

### 5.2 Character engine
In `web/js/character.js`:

1. Add `this.separation = normalizeSeparation(options.separation)` and `setSeparation(mode)`.
2. Add cell recording:
   - `this._eyeCells = []`
   - `this._mouthCells = []`
   - `this._record = null`
   - `px()` records each rounded cell into `_record` when set.
3. Wrap eye and mouth draw methods so they record and always reset `_record`:
   - `drawEyes` → `_drawEyesBody`
   - `drawMossEyes` → `_drawMossEyesBody`
   - `drawOriginalMouth` → `_drawOriginalMouthBody`
   - `drawMouth` → `_drawMouthBody`
   - `drawMossMouth` → `_drawMossMouthBody`
4. Add a post-draw `separate()` pass:
   - Compute collision if any mouth cell is within Chebyshev distance 1 of an eye cell.
   - `off`: draw as before.
   - `inset`: for each offending cell pair, shave a thin backing-pixel band or corner from the mouth edge facing the eye with `destination-out`. The eyes keep their full pixels; if a mouth pixel truly overlaps an eye cell, the mouth yields that cell. No whole cell is removed from the eyes. Behavior is identical to `off` when there is no collision.
   - `gap`: clear a 3×3 destination-out rect around every eye cell, then redraw eyes.
   - `trim`: clear only offending mouth cells, then redraw eyes.
   - Store `this._collisionCells` for the debug overlay even when separation is off.
5. Draw order:
   - Draw eyes and mouth normally.
   - Draw other face parts.
   - Run `separate()`.
   - Draw brows after separation so a seam cannot clip them.
6. `drawVector12` special case:
   - Keep the exact `laugh` frame; separation is not needed there.
   - Otherwise eyes → mouth → `separate()`.
7. MOSS and Lumen:
   - Eyes → mouth → other parts → `separate()` → brows.
8. Collision overlay:
   - Option `debugCollision`.
   - Draw a faint marker on eye cells and a bright marker on offending mouth cells.
   - Only used by the Face Lab.

### 5.3 MOSS polish
Evaluate and tune visually in the Face Lab:
- Eyes: consider a 3×2 or 3×3 socket instead of 2×2 so the pupil has room to sit centrally. Choose whichever reads as a terminal, not a blob.
- Mouth: reduce the happy V-curve; keep neutral flat and sad/angry as a frown.
- Blush: make it smaller and dimmer, or remove it for neutral/happy if it reads like a moustache.
- Scanline: keep it subtle; avoid a bright moving bar that looks like a unibrow.
- Bezel and LED: keep the current identity.
- Verify every emotion and state, especially `happy`, `laugh`, `surprised`, `angry`, `sleepy`, `glitch`.

### 5.4 Face Lab
Add:
- `separation` select: inset / gap / trim / off.
- `show collisions` checkbox.
- Keep the existing skin selector.
- Update the status line to include the separation mode.
- Ensure `?skin=` and `?style=` links still work.

### 5.5 Acceptance criteria
- Vector 12×12 is visually unchanged when no collision exists.
- A clean seam appears when eyes and mouth actually touch, including diagonal gaze positions, without deleting a whole cell.
- `inset`, `gap`, `trim`, and `off` visibly differ in the lab.
- MOSS supports the same separation and looks intentional.
- No alpha-dimmed intersection pixel remains.
- Reduced-motion mode still works.
- All emotions, states, palettes, and scales are checked.
- `pytest -q` and `node --check` pass.

### 5.6 Files likely touched
- `vector/config.py`
- `tests/test_config.py`
- `web/js/character.js`
- `web/js/main.js`
- `web/js/settings.js`
- `web/js/lab.js`
- `web/lab.html`
- `web/css/app.css` (only if lab controls need layout)
- `web/locales/en.json`, `web/locales/ru.json`
- `README.md`, `README.ru.md`

### 5.7 Stop
Pause for user review and commit before M3.

---

## 6. M3 — Study mode core

### Goal
Add the Conversation/Study switch, longer paginated study answers, and the CPU-aware model warning. No notes or vocabulary yet.

### 6.1 Settings
Add:
```json
"experience": {
  "mode": "conversation",
  "study_pages": 3,
  "study_max_tokens": 600,
  "study_page_chars": 380
}
```
Sanitise:
- `mode` in `("conversation", "study")`
- `study_pages` 2–6
- `study_max_tokens` 256–1200
- `study_page_chars` 220–700

`input.mode` stays untouched.

### 6.2 Prompt
In `vector/prompts.py`, add a study branch:
- Base persona remains.
- Study rules:
  - “You may answer in depth.”
  - “Use 2–3 short pages by default.”
  - “Separate pages with a line containing exactly `[[page]]`.”
  - “Each page: 2–5 sentences, plain text, no markdown headings.”
  - “Start pages with an emotion tag where natural.”
  - “End with one short check-for-understanding question.”
- Conversation mode keeps the current short style.
- Poke/proactive/wake lines stay short even in Study mode.

### 6.3 Page protocol
- Add a streaming page splitter in `vector/dialogue.py`:
  - Detect `[[page]]` across chunk boundaries.
  - Do not leak partial sentinels.
  - Emit `assistant_delta` with a `page` index.
  - Store `message.meta.pages` and `page_count`.
  - If the model forgets the sentinel and the answer is long, fall back to sentence-aware splitting at `study_page_chars`.
  - Cap pages at `study_pages`; merge overflow into the last page.
- `LLMRouter` gets a per-request `num_predict` override from `experience.study_max_tokens`.
- History kind becomes `study` for study answers.

### 6.4 UI
- One reply card with page controls and dots.
- New page indicator when content arrives beyond the visible page.
- Keyboard Left/Right navigation.
- Copy page / copy full answer.
- History chip “study”.
- No auto-advance while the user is reading.

### 6.5 Mode selection
- Onboarding gets a mode step: Conversation vs Study.
- Settings → Companion gets the mode switch.
- A Study settings section/tab appears for study-specific options.
- The model warning appears when Study is selected, with the CPU-aware copy from section 2.
- The warning must not block the user; it is informational.

### 6.6 Acceptance criteria
- Conversation mode behaves exactly as before.
- Study mode produces 2–3 pages on a 3B/4B CPU model in normal use.
- If the model forgets `[[page]]`, the fallback still creates pages.
- Page controls, keyboard navigation, history, and cancellation work.
- The warning is visible and matches the user’s hardware reality.
- Tests cover the splitter, prompt, config, and mode switching.
- `pytest -q` and `node --check` pass.

### 6.7 Files likely touched
- `vector/config.py`
- `vector/prompts.py`
- `vector/dialogue.py`
- `vector/llm.py`
- `vector/server.py`
- `web/js/main.js`
- `web/js/settings.js`
- `web/index.html`
- `web/css/app.css`
- `web/locales/en.json`, `web/locales/ru.json`
- `README.md`, `README.ru.md`
- `tests/test_config.py`, `tests/test_prompts.py`, `tests/test_dialogue.py`

### 6.8 Stop
Pause for user review and commit before M4.

---

## 7. M4 — Study utilities

### Goal
Add sticky notes, vocabulary, the Study-only menu, and the remaining polish.

### 7.1 StudyStore
New `vector/study.py` backed by `data/study.json`:
```json
{
  "version": 1,
  "notes": [],
  "vocabulary": []
}
```
Notes:
```json
{
  "id": "abc123",
  "text": "Always answer in English.",
  "x": 12.5,
  "y": 18.0,
  "width": 220,
  "color": "amber",
  "share": true,
  "created_at": 0,
  "updated_at": 0
}
```
Vocabulary:
```json
{
  "id": "def456",
  "term": "ephemeral",
  "meaning": "lasting for a very short time",
  "example": "The ephemeral glow faded.",
  "language": "en",
  "source": "message-id",
  "created_at": 0
}
```
Limits:
- Max 100 notes, 1000 words.
- Note text ≤ 2000 chars.
- Shared notes cap in the prompt: 8 notes × 300 chars.
- Term ≤ 80, meaning/example ≤ 500.

API:
- `GET /api/study`
- `POST /api/notes`, `PATCH /api/notes/{id}`, `DELETE /api/notes/{id}`
- `POST /api/vocabulary`, `PATCH /api/vocabulary/{id}`, `DELETE /api/vocabulary/{id}`
- Broadcast `study_changed` after mutations.
- Include study data in export/import.

### 7.2 Sticky notes
- Notes layer over the stage, hidden in Conversation mode.
- Drag by header; clamp to viewport.
- Plain-text textarea; auto-height.
- Pin/delete/share controls.
- Global font settings: sans / serif / mono, size, ink colour, note colour.
- One-click rule templates: “Answer in English”, “Use examples”, “Keep it short”.
- Per-note “use as rule” toggle, default visual-only or clearly indicated. Approved decision: per-note toggle.
- Shared notes are injected into the study prompt as “notes on screen”, capped and clearly framed.

### 7.3 Vocabulary
- Study-only drawer/menu.
- Add word form prefilled from selected text.
- List with search, edit, delete.
- Export JSON/CSV.
- No automatic LLM definitions in the first cut.

### 7.4 Study menu
Book icon in the top-right, visible only in Study mode:
- Add note
- Add word
- Vocabulary
- Study settings

No persistent dashboard.

### 7.5 i18n/docs/export
- EN/RU strings for all new UI.
- README/README.ru sections for Study mode, notes, vocabulary, and the model warning.
- Export/import includes study data and custom pack.
- Debug panel shows resolved pack, skin, mode, and page-splitter decisions.

### 7.6 Acceptance criteria
- Notes and vocabulary persist across restarts.
- Notes are hidden in Conversation mode and restored in Study mode.
- Shared notes influence the study prompt; visual notes do not.
- Vocabulary add/edit/delete/search/export works.
- The Study menu is absent in Conversation mode.
- All tests and manual checks pass.

### 7.7 Stop
Pause for final review and commit.

---

## 8. Data model and API summary

### Settings additions
M2:
```json
"face": { "separation": "inset" }
```
M3:
```json
"experience": {
  "mode": "conversation",
  "study_pages": 3,
  "study_max_tokens": 600,
  "study_page_chars": 380
}
```
M4 notes font:
```json
"experience": {
  "notes_font": "sans",
  "notes_font_size": 15,
  "notes_ink": "#...",
  "notes_color": "amber"
}
```

### WebSocket events
- `assistant_delta` gains `page`.
- `assistant_end.message.meta.pages` and `page_count`.
- `study_changed` after notes/vocabulary mutations.
- Existing events remain unchanged.

### REST
- `GET /api/characters` (done)
- `GET /api/study`
- Notes and vocabulary CRUD as above.
- `/api/export` and `/api/import` include study data.

---

## 9. Testing strategy

### Automated
- `pytest -q`
- `node --check web/js/*.js`
- `git diff --check`

Add tests for:
- `face.separation` default and sanitisation.
- Study config defaults and clamps.
- Page splitter: sentinel across chunks, missing sentinel fallback, page cap.
- Study prompt contains study rules and warning text where relevant.
- StudyStore CRUD, limits, and atomic persistence.
- Custom pack prompt and pack migration (already covered in M1).

### Manual
- Face Lab matrix: every skin × every emotion × a few states × gaze directions × separation modes × reduced motion.
- Onboarding: fresh install, existing-user pack chooser, custom pack, mode selection.
- Main stage: pack switching, name override, placeholder, history labels.
- Study: short and long answers, model that ignores sentinel, pagination, keyboard, cancel, history.
- Notes: drag, edit, share, font changes, mode switch.
- Vocabulary: add from selection, edit, search, export.
- 480 px wide layout.

---

## 10. Risks and guardrails

- **Small models forget structure.** The fallback page splitter is mandatory, not optional. Keep Study defaults at 3 pages / 600 tokens for CPU-only 3B–4B models.
- **Custom prompts can break the face.** Required emotion/style rules stay appended. Show the resolved prompt in debug.
- **Notes can bloat context.** Hard caps and a per-note toggle.
- **Separation can change the original sprite.** The default `inset` mode must do nothing when there is no collision. Keep `off` for comparison.
- **Migration can surprise existing users.** One-time pack chooser; preserve custom names, history, language, and theme.
- **Scope creep.** No TTS, cloud sync, web fonts, image uploads, flashcards, or a persistent study dashboard in these milestones.
- **No new build step.** Keep the frontend dependency-free and no-build.

---

## 11. Resume checklist

1. Read this file.
2. Check the working tree:
   ```bash
   git status --short
   git log --oneline -5
   ```
3. Run the current checks:
   ```bash
   .venv/bin/python -m pytest -q
   for f in web/js/*.js; do node --check "$f" || exit 1; done
   ```
4. Confirm the current milestone from section 3.
5. Start at the first unchecked item in that milestone.
6. After the milestone:
   - run the full checks
   - update this document’s status and current-state section
   - stop for user review and commit.

### Exact next action for M3
Start with section 6.1:
- add the `experience` block to defaults and sanitisation
- add config tests
- then add the study prompt branch and the page splitter in `vector/dialogue.py`

---

## 12. Open assumptions

- History stays shared across modes with a `mode` tag; separate threads are not planned.
- The custom prompt is a base persona, not a full system-prompt override.
- Sticky notes are a Study-mode feature and hidden in Conversation mode.
- Study mode defaults to 3 pages on the user’s CPU-only machine.
- The model warning is informational, not a hard block.
- The Face Lab is the primary visual verification tool; no separate screenshot-test infrastructure is planned.
