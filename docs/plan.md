# Vector Development Plan

**Status:** Milestone 4 complete. Ready for final review and commit.
**Last updated:** 2026-11-11
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
| **M3** | Study mode core: mode switch, paginated replies, prompt, warning | Done |
| **M4** | Study utilities: sticky notes, vocabulary, menu, export, docs | Done |

Each milestone ends with:
- `pytest -q`
- `node --check` for every `web/js/*.js`
- manual visual review in the Face Lab and main stage
- README / README.ru / i18n updates where relevant
- a stop for user review and commit

---

## 4. Current state after M4

### Implemented in M4
- `vector/study.py`, `tests/test_study.py`:
  - `StudyStore` backed by `data/study.json` with atomic writes.
  - Notes: id, text, x/y, width, colour, per-note share toggle, created/updated timestamps.
  - Vocabulary: id, term, meaning, example, language, source, created/updated timestamps.
  - Limits: 100 notes, 1000 words, note text 2000 chars, shared notes 8 × 300 chars, term 80, meaning/example 500.
  - CRUD, replace/import, clear vocabulary, bounded shared notes.
- `vector/config.py`, `tests/test_config.py`:
  - `STUDY_PATH`, note colour constants, `experience.notes_font` / `notes_font_size` / `notes_ink` / `notes_color`.
  - Sanitisation and defaults.
- `vector/prompts.py`, `vector/dialogue.py`, `tests/test_prompts.py`:
  - Shared notes are injected into the study prompt as “Notes on the user's screen”, capped and clearly framed.
  - Notes are not injected in Conversation mode or in poke/proactive/wake prompts.
- `vector/server.py`:
  - `StudyStore` in `AppState`, `study` in `hello` and debug snapshots.
  - `GET /api/study`, notes CRUD, vocabulary CRUD, `study_changed` broadcasts.
  - Export/import include study data.
  - Debug snapshot includes the resolved character and page-splitter settings.
- Frontend:
  - Study menu with a book icon: Add note, Add word, Vocabulary, Study settings.
  - Draggable sticky notes with plain-text editing, colour cycling, per-note rule toggle, delete, and viewport clamping.
  - Quick rule templates (“Answer in English”, “Use examples”, “Keep it short”) create shared notes in one click.
  - Notes hidden in Conversation mode and restored in Study mode.
  - Vocabulary drawer with add/edit/delete/search and JSON/CSV export; selection in a study reply prefills the term and source.
  - Settings → Study gains note font, size, ink colour, and default note colour controls.
  - 480 px layout and reduced-motion behaviour preserved.
- Docs and i18n:
  - README / README.ru sections for notes, vocabulary, the Study menu, and export.
  - EN/RU strings for all new UI.

### Implemented in M3
- `vector/config.py`, `tests/test_config.py`:
  - `experience.mode` (`conversation` / `study`), `study_pages` (2–6), `study_max_tokens` (256–1200), `study_page_chars` (220–700).
  - Defaults are 3 pages, 600 tokens, and 380 characters for the fallback splitter.
  - Sanitisation and default tests.
- `vector/prompts.py`, `tests/test_prompts.py`:
  - Study prompt branch with the `[[page]]` protocol, 2–3 pages, 2–5 sentences per page, emotion tags, and a final check-for-understanding question.
  - Conversation prompt is unchanged and does not mention pages.
  - Poke/proactive/wake prompts stay short even in Study mode.
- `vector/dialogue.py`, `tests/test_dialogue.py`:
  - Streaming `PageSplitter` with sentinel detection across chunk boundaries, partial-sentinel suppression, sentence-aware fallback at `study_page_chars`, and page-cap overflow merged into the last page.
  - `assistant_delta` carries a `page` index.
  - Study replies are stored with `kind: "study"` and `meta.pages` / `meta.page_count`.
  - `LLMRouter` receives a per-request `num_predict` override from `experience.study_max_tokens`.
- Frontend:
  - One paginated reply card with `‹ 1 / 3 ›`, dots, a “new page” indicator, `Left`/`Right` navigation, copy page, and copy all.
  - New pages never auto-advance while the user is reading.
  - History shows a `study` chip.
  - Onboarding has a fourth step for Conversation vs Study.
  - Settings → Companion has the experience switch; Settings → Study appears only in Study mode with page/token/fallback controls and the CPU-aware warning.
  - The listening-mode label is now “Listening” / “Слушание”.
- Docs and i18n:
  - README / README.ru sections for Conversation/Study modes and the model warning.
  - EN/RU strings for the new controls and warning.

### Carried over from M1–M2
- Character packs, skins, custom packs, legacy migration, onboarding pack chooser.
- Smart pixel separation (`inset` / `gap` / `trim` / `off`), collision overlay, MOSS polish, Face Lab controls.
- Settings version 3, history, memory facts, and all existing conversation behaviour.

### Verification at M4
- `pytest -q` → 82 passed, 1 skipped.
- `node --check` passes for all frontend modules.
- `git diff --check` clean.
- Headless Chrome review:
  - Study menu opens with all four actions.
  - Note creation, text editing, colour cycling, rule toggle, drag, and persistence through the API.
  - Notes hide in Conversation mode and reappear with text intact in Study mode.
  - Vocabulary add, search, edit, and selected-text prefill.
  - Note font/size/ink changes apply immediately.
  - 480 px notes and vocabulary layouts.
- Shared notes appear in `/api/prompt` only in Study mode.
- `GET /api/study` and the notes/vocabulary CRUD endpoints persist to `data/study.json`.
- Export/import include study data.
- M3 checks still pass: paginated replies, keyboard navigation, mode switching, and conversation-mode behaviour.

### Known limitations
- The fallback page splitter is heuristic; it prefers sentence boundaries but may hard-cut at the page size when a model writes one very long sentence.
- Page text is stored without the sentinel; history shows the full answer joined with blank lines.
- Copy controls appear only when a reply has more than one page.
- Vocabulary language/source are stored but the source is shown only in the API, not as a visible label.
- Notes use percentage positions; they are re-clamped on render and resize but may shift slightly after a large viewport change.

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

### Exact next action after M4
All planned milestones are complete. Run the full checks one last time, review the working tree, and commit. Future work should start from a new plan section rather than extending M4 silently.

---

## 12. Open assumptions

- History stays shared across modes with a `mode` tag; separate threads are not planned.
- The custom prompt is a base persona, not a full system-prompt override.
- Sticky notes are a Study-mode feature and hidden in Conversation mode.
- Study mode defaults to 3 pages on the user’s CPU-only machine.
- The model warning is informational, not a hard block.
- The Face Lab is the primary visual verification tool; no separate screenshot-test infrastructure is planned.
