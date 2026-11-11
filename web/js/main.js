/* Vector 2 — app shell, state machine, socket, and shortcuts. */

import { i18n } from "./i18n.js";
import { sound } from "./sound.js";
import { AudioEngine } from "./audio.js";
import { Character, EMOTIONS } from "./character.js";
import { SettingsUI } from "./settings.js";
import { DebugUI } from "./debug.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

const EMOTION_META = Object.entries(EMOTIONS).map(([id, meta]) => ({ id, ...meta }));

const dom = {
  app: $("app"),
  stage: $("stage"),
  micBtn: $("mic-btn"),
  langBtn: $("lang-btn"),
  studyBtn: $("study-btn"),
  studyMenu: $("study-menu"),
  historyBtn: $("history-btn"),
  settingsBtn: $("settings-btn"),
  notesLayer: $("notes-layer"),
  character: $("character"),
  characterWrap: $("character-wrap"),
  statusLine: $("status-line"),
  dock: $("dock"),
  hint: $("hint"),
  textStack: $("text-stack"),
  reply: $("reply"),
  replyText: $("reply-text"),
  replyFoot: $("reply-foot"),
  replyPrev: $("reply-prev"),
  replyNext: $("reply-next"),
  replyPage: $("reply-page"),
  replyDots: $("reply-dots"),
  replyNew: $("reply-new"),
  replyCopy: $("reply-copy"),
  replyCopyAll: $("reply-copy-all"),
  input: $("input"),
  mode: $("mode"),
  pending: $("pending"),
  sendHint: $("send-hint"),
  backdrop: $("backdrop"),
  settingsDrawer: $("settings-drawer"),
  historyDrawer: $("history-drawer"),
  historyList: $("history-list"),
  historyEmpty: $("history-empty"),
  historyClose: $("history-close"),
  historyClear: $("history-clear"),
  historyExport: $("history-export"),
  vocabDrawer: $("vocab-drawer"),
  vocabClose: $("vocab-close"),
  vocabForm: $("vocab-form"),
  vocabTerm: $("vocab-term"),
  vocabLanguage: $("vocab-language"),
  vocabMeaning: $("vocab-meaning"),
  vocabExample: $("vocab-example"),
  vocabSave: $("vocab-save"),
  vocabCancel: $("vocab-cancel"),
  vocabSearch: $("vocab-search"),
  vocabCount: $("vocab-count"),
  vocabList: $("vocab-list"),
  vocabEmpty: $("vocab-empty"),
  vocabExportJson: $("vocab-export-json"),
  vocabExportCsv: $("vocab-export-csv"),
  onboarding: $("onboarding"),
  onboardPanel: $("onboard-panel"),
  onboardStepCount: $("onboard-step-count"),
  onboardLang: $("onboard-lang"),
  onboardPacks: $("onboard-packs"),
  onboardCustom: $("onboard-custom"),
  onboardCustomName: $("onboard-custom-name"),
  onboardCustomSkin: $("onboard-custom-skin"),
  onboardCustomPrompt: $("onboard-custom-prompt"),
  onboardTheme: $("onboard-theme"),
  onboardExperience: $("onboard-experience"),
  onboardStudyWarning: $("onboard-study-warning"),
  onboardChecks: $("onboard-checks"),
  onboardRetry: $("onboard-retry"),
  onboardDemo: $("onboard-demo"),
  onboardNext: $("onboard-next"),
  onboardBack: $("onboard-back"),
  onboardStart: $("onboard-start"),
  onboardSkip: $("onboard-skip"),
  toasts: $("toasts"),
};

const app = {
  settings: null,
  defaults: null,
  health: {},
  asr: {},
  characters: { packs: [], skins: [], custom: {} },
  emotions: EMOTION_META,
  server: {},
  version: "",
  history: { messages: [], facts: [], user_name: "" },
  study: { notes: [], vocabulary: [] },
  vocabEditing: null,
  vocabFilter: "",
  vocabSource: "",
  lastSelection: "",
  _studyVisible: false,
  _noteEditing: false,
  _noteDragging: false,
  status: "idle",
  micActive: false,
  generating: false,
  replyId: null,
  replyText: "",
  replyPages: [""],
  replyPage: 0,
  replySeenPage: 0,
  replyNewPage: false,
  replyKind: "chat",
  replyDirty: false,
  pending: "",
  mode: "silence",
  connected: false,
  reconnecting: false,
  lastTranscript: "",
  lastPartial: "",
  currentEmotion: "neutral",
  emotionTimeline: [],
  mood: null,
  character: null,
  audio: null,
  settingsUI: null,
  debugUI: null,
  _firstHintShown: false,
  _localeInitialised: false,
};

let socket = null;
let reconnectTimer = 0;
let reconnectDelay = 1000;
let historyOpen = false;
let vocabOpen = false;
let studyMenuOpen = false;
const noteSaveTimers = new Map();
let noteResizeTimer = 0;
let replyMeasure = null;
let replyRepaginateTimer = 0;
let idleTimer = 0;
let hintTimer = 0;
let replyRaf = 0;
let autoGrowRaf = 0;
let pendingPatch = {};
let patchTimer = 0;
let hasConnected = false;

// --------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------

function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function formatTime(ts) {
  if (!ts) return "";
  const date = new Date(ts > 1e12 ? ts : ts * 1000);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function emotionColor(id) {
  const meta = (app.emotions || []).find((item) => item.id === id) || EMOTIONS[id];
  return meta?.color || "#7dffc4";
}

function companionName() {
  const pack = packById(app.settings?.character?.pack || "vector");
  return app.settings?.persona?.name || pack?.name || "Vector";
}

function isStudyMode() {
  return (app.settings?.experience?.mode || "conversation") === "study";
}

function noteFontStack(name) {
  if (name === "serif") return 'Georgia, "Times New Roman", serif';
  if (name === "mono") {
    return 'ui-monospace, "SFMono-Regular", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace';
  }
  return 'Arial, "Helvetica Neue", system-ui, -apple-system, sans-serif';
}

function applyNoteStyle(experience = {}) {
  const root = document.documentElement;
  root.style.setProperty("--note-font", noteFontStack(experience.notes_font));
  root.style.setProperty(
    "--note-font-size",
    `${Number(experience.notes_font_size) || 15}px`,
  );
  root.style.setProperty("--note-ink", experience.notes_ink || "#2b2118");
}

function updateStudyUI() {
  const study = isStudyMode();
  const wasStudy = app._studyVisible;
  app._studyVisible = study;
  if (dom.notesLayer) dom.notesLayer.hidden = !study;
  if (!study) {
    closeStudyMenu();
    if (vocabOpen) closeVocabulary();
  } else if (!wasStudy) {
    renderNotes();
    renderVocabulary();
  }
}

function setGlow(id) {
  if (!dom.characterWrap) return;
  dom.characterWrap.style.setProperty("--face-glow", emotionColor(id));
}

function toast(text, kind = "") {
  if (!text) return;
  const node = document.createElement("div");
  node.className = "toast" + (kind ? ` ${kind}` : "");
  node.textContent = text;
  dom.toasts.appendChild(node);
  while (dom.toasts.children.length > 3) dom.toasts.firstChild.remove();
  setTimeout(() => node.remove(), 3800);
}

function scheduleIdle() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!app.settingsUI?.isOpen() && !historyOpen && !vocabOpen && !studyMenuOpen
      && !app.debugUI?.isOpen() && dom.onboarding.hidden) {
      document.body.classList.add("idle");
    }
  }, 3200);
}

function showHint(text, { danger = false, timeout = 0 } = {}) {
  clearTimeout(hintTimer);
  dom.hint.textContent = text || "";
  dom.hint.classList.toggle("show", Boolean(text));
  dom.hint.classList.toggle("danger", Boolean(danger));
  if (text && timeout) {
    hintTimer = setTimeout(() => {
      dom.hint.classList.remove("show");
      dom.hint.classList.remove("danger");
    }, timeout);
  }
}

function hideHint() {
  clearTimeout(hintTimer);
  dom.hint.classList.remove("show", "danger");
  dom.hint.textContent = "";
}

function autoGrow() {
  cancelAnimationFrame(autoGrowRaf);
  autoGrowRaf = requestAnimationFrame(() => {
    dom.input.style.height = "auto";
    const max = window.innerHeight * 0.34;
    dom.input.style.height = `${Math.min(dom.input.scrollHeight, max)}px`;
  });
}

function showBackdrop() {
  dom.backdrop.hidden = false;
  requestAnimationFrame(() => dom.backdrop.classList.add("open"));
}

function hideBackdrop() {
  if (app.settingsUI?.isOpen() || historyOpen || vocabOpen) return;
  dom.backdrop.classList.remove("open");
  setTimeout(() => {
    if (!app.settingsUI?.isOpen() && !historyOpen && !vocabOpen) dom.backdrop.hidden = true;
  }, 280);
}

// --------------------------------------------------------------------------
// Settings application
// --------------------------------------------------------------------------

function applySettings(settings, options = {}) {
  if (!settings || !settings.app) return;
  app.settings = settings;
  const root = document.documentElement;
  root.dataset.theme = settings.app.theme || "ink";
  document.body.dataset.experience = settings.experience?.mode || "conversation";
  applyNoteStyle(settings.experience || {});
  updateStudyUI();
  root.style.setProperty("--ui-scale", String(settings.app.ui_scale ?? 1));
  root.style.setProperty("--face-scale", String(settings.face.scale ?? 1));

  const reduced = Boolean(
    settings.app.reduced_motion ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  document.body.classList.toggle("reduced-motion", reduced);

  if (app.character) {
    const skin = settings.face?.skin
      || (settings.face?.style === "pixel" ? "lumen16" : "vector12");
    app.character.setSkin(skin);
    app.character.setSeparation(settings.face?.separation || "inset");
    app.character.setPalette(settings.face.palette_name, settings.face.palette || {});
    app.character.setOptions({
      eyeTracking: Boolean(settings.face.eye_tracking),
      blink: Boolean(settings.face.blink),
      breathing: Boolean(settings.face.breathing),
      particles: Boolean(settings.face.particles),
      glow: Boolean(settings.face.glow),
      antenna: Boolean(settings.face.antenna),
      reducedMotion: reduced,
    });
    dom.characterWrap.classList.toggle("glow", Boolean(settings.face.glow));
    app.character.setMood({
      affection: settings.engagement?.affection ?? 50,
      curiosity: settings.engagement?.curiosity ?? 70,
      energy: settings.engagement?.energy ?? 75,
    });
  }

  sound.setEnabled(Boolean(settings.app.sound));
  app.mode = settings.input?.mode || "silence";
  updateMode();

  if (dom.input) dom.input.placeholder = i18n.t("stage.placeholder", { name: companionName() });
  updateMicButton();
  setGlow(app.currentEmotion);
  if (!dom.reply.hidden) scheduleReplyRepaginate();

  if (settings.app.language && settings.app.language !== i18n.locale) {
    localStorage.setItem("vector.locale", settings.app.language);
    i18n.setLocale(settings.app.language).catch(() => {});
  }

  if (!options.silent && app.settingsUI?.isOpen()) {
    app.settingsUI.saved();
  }

  if (!app._firstHintShown && settings.app.first_run_hint && !localStorage.getItem("vector.seenHint")) {
    app._firstHintShown = true;
    localStorage.setItem("vector.seenHint", "1");
    setTimeout(() => showHint(i18n.t("stage.firstHint"), { timeout: 7000 }), 900);
    patchSettings({ app: { first_run_hint: false } });
  }
}

function patchSettings(patch) {
  if (!app.settings) return;
  deepMerge(app.settings, patch);
  applySettings(app.settings, { silent: true });
  deepMerge(pendingPatch, patch);
  clearTimeout(patchTimer);
  patchTimer = setTimeout(flushPatch, 220);
}

async function flushPatch() {
  clearTimeout(patchTimer);
  patchTimer = 0;
  const patch = pendingPatch;
  pendingPatch = {};
  if (!Object.keys(patch).length) return;
  try {
    const res = await fetch("api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error("settings failed");
    const settings = await res.json();
    applySettings(settings);
    app.settingsUI?.saved();
  } catch (error) {
    console.error("settings patch failed", error);
    toast(i18n.t("toast.error"), "error");
  }
}

async function reloadSettings() {
  try {
    const [settingsRes, historyRes, studyRes] = await Promise.all([
      fetch("api/settings", { cache: "no-store" }),
      fetch("api/history", { cache: "no-store" }),
      fetch("api/study", { cache: "no-store" }),
    ]);
    if (settingsRes.ok) applySettings(await settingsRes.json());
    if (historyRes.ok) {
      app.history = await historyRes.json();
      renderHistory();
    }
    if (studyRes.ok) setStudy(await studyRes.json());
    app.settingsUI?.render();
  } catch (error) {
    toast(i18n.t("toast.error"), "error");
  }
}

// --------------------------------------------------------------------------
// Mic
// --------------------------------------------------------------------------

function updateMicButton() {
  if (!dom.micBtn) return;
  const active = Boolean(app.micActive);
  dom.micBtn.dataset.active = String(active);
  dom.micBtn.setAttribute("aria-pressed", String(active));
  dom.micBtn.title = i18n.t(active ? "mic.on" : "mic.off");
}

function setMicActive(active, { remote = false } = {}) {
  app.micActive = Boolean(active);
  updateMicButton();
  if (app.micActive && app.status === "idle" && !app.generating) {
    setStatus("listening");
  } else if (!app.micActive && app.status === "listening" && !app.generating) {
    setStatus("idle");
  }
  if (!remote && !app.micActive) {
    hideHint();
  }
}

async function toggleMic() {
  if (!app.audio) return;
  if (app.audio.active) {
    app.audio.stop();
    app.send({ type: "audio_end" });
    setMicActive(false);
    sound.play("micOff");
    return;
  }
  const ok = await app.audio.start();
  if (!ok) return;
  app.send({ type: "audio_start" });
  setMicActive(true);
  sound.play("micOn");
  scheduleIdle();
}

function handleMicError(error) {
  const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
  toast(i18n.t(denied ? "toast.micDenied" : "toast.micUnavailable"), "error");
  sound.play("error");
  setMicActive(false);
}

async function setMicDevice(deviceId) {
  localStorage.setItem("vector.micDevice", deviceId || "");
  app.audio.deviceId = deviceId || null;
  if (app.audio.active) {
    await app.audio.stop(true);
    const ok = await app.audio.start();
    if (ok) {
      app.send({ type: "audio_start" });
      setMicActive(true);
    } else {
      setMicActive(false);
    }
  }
}

// --------------------------------------------------------------------------
// Text / reply
// --------------------------------------------------------------------------

function resetReplyPages() {
  app.replyPages = [""];
  app.replyPage = 0;
  app.replySeenPage = 0;
  app.replyNewPage = false;
  app.replyKind = "chat";
  app.replyText = "";
}

function setInputText(text) {
  hideReply();
  dom.input.value = text || "";
  autoGrow();
  if (!app.userEditing) dom.input.scrollTop = dom.input.scrollHeight;
}

function showReply(kind = "chat") {
  resetReplyPages();
  app.replyKind = kind || "chat";
  dom.input.hidden = true;
  dom.reply.hidden = false;
  dom.replyText.textContent = "";
  dom.reply.classList.add("streaming");
  dom.replyText.scrollTop = 0;
  renderReplyPager();
}

function hideReply() {
  dom.reply.hidden = true;
  dom.replyText.textContent = "";
  dom.reply.classList.remove("streaming");
  dom.replyFoot.hidden = true;
  dom.input.hidden = false;
  resetReplyPages();
  autoGrow();
}

function lastReplyPage() {
  return Math.max(0, app.replyPages.length - 1);
}

function setReplyPage(index, { resetScroll = true } = {}) {
  const next = clamp(Number(index) || 0, 0, lastReplyPage());
  if (next === app.replyPage && !resetScroll) return;
  app.replyPage = next;
  if (next > app.replySeenPage) app.replySeenPage = next;
  app.replyNewPage = lastReplyPage() > app.replySeenPage;
  app.replyDirty = true;
  renderReplyNow({ resetScroll });
}

function jumpToNewReplyPage() {
  setReplyPage(lastReplyPage());
}

function renderReplyPager() {
  const count = Math.max(1, app.replyPages.length);
  dom.replyFoot.hidden = count <= 1;
  if (count <= 1) return;
  dom.replyPage.textContent = `${app.replyPage + 1} / ${count}`;
  dom.replyPrev.disabled = app.replyPage <= 0;
  dom.replyNext.disabled = app.replyPage >= count - 1;
  dom.replyNew.hidden = !app.replyNewPage;
  dom.replyDots.textContent = "";
  for (let index = 0; index < count; index += 1) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "reply-dot" + (index === app.replyPage ? " active" : "");
    dot.title = `${index + 1} / ${count}`;
    dot.addEventListener("click", (event) => {
      event.stopPropagation();
      setReplyPage(index);
    });
    dom.replyDots.appendChild(dot);
  }
}

function renderReplyNow({ resetScroll = false } = {}) {
  cancelAnimationFrame(replyRaf);
  replyRaf = 0;
  if (dom.reply.hidden) return;
  const stick = dom.replyText.scrollHeight - dom.replyText.scrollTop - dom.replyText.clientHeight < 48;
  dom.replyText.textContent = app.replyPages[app.replyPage] || "";
  renderReplyPager();
  if (resetScroll) dom.replyText.scrollTop = 0;
  else if (stick) dom.replyText.scrollTop = dom.replyText.scrollHeight;
}

function scheduleReply() {
  if (replyRaf) return;
  replyRaf = requestAnimationFrame(() => {
    replyRaf = 0;
    if (!app.replyDirty) return;
    app.replyDirty = false;
    renderReplyNow();
  });
}

function appendReplyDelta(page, text) {
  const index = Number.isInteger(page) && page >= 0 ? page : 0;
  while (app.replyPages.length <= index) app.replyPages.push("");
  app.replyPages[index] = (app.replyPages[index] || "") + (text || "");
  app.replyText = app.replyPages.join("\n\n").trim();
  if (index > app.replySeenPage) app.replyNewPage = true;
  if (index === app.replyPage) {
    app.replyDirty = true;
    scheduleReply();
  } else {
    renderReplyPager();
  }
}

function setReplyPages(pages, fallbackText = "", kind = "chat") {
  const list = Array.isArray(pages) && pages.length
    ? pages.map((page) => String(page || ""))
    : [String(fallbackText || "")];
  app.replyPages = list;
  app.replyKind = kind || app.replyKind;
  app.replyPage = clamp(app.replyPage, 0, list.length - 1);
  app.replySeenPage = Math.min(app.replySeenPage, list.length - 1);
  app.replyNewPage = list.length - 1 > app.replySeenPage;
  app.replyText = String(fallbackText || "").trim() || list.join("\n\n").trim();
  app.replyDirty = true;
  renderReplyNow();
}

async function copyReply(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(i18n.t("reply.copied"), "good");
  } catch (error) {
    toast(i18n.t("toast.error"), "error");
  }
}

function replyMeasureNode() {
  if (!replyMeasure) {
    replyMeasure = document.createElement("div");
    replyMeasure.className = "reply-text reply-measure";
    dom.reply.appendChild(replyMeasure);
  }
  return replyMeasure;
}

function replyPageMaxHeight() {
  const maxHeight = parseFloat(getComputedStyle(dom.replyText).maxHeight);
  if (Number.isFinite(maxHeight) && maxHeight > 0) return Math.max(80, maxHeight - 2);
  return Math.max(80, dom.replyText.clientHeight);
}

function measureReplyHeight(text, width) {
  const measure = replyMeasureNode();
  measure.style.width = `${width}px`;
  measure.textContent = text;
  return measure.scrollHeight;
}

function replyAtoms(text) {
  const atoms = [];
  const paragraphs = String(text || "").split(/\n{2,}/);
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return;
    const sentences = trimmed.match(/[^.!?…]+[.!?…]+(?:["')\]]*)|[^.!?…]+$/g) || [trimmed];
    sentences.forEach((sentence, sentenceIndex) => {
      const value = sentence.trim();
      if (!value) return;
      atoms.push({
        text: value,
        sep: sentenceIndex === 0 && paragraphIndex > 0 ? "\n\n" : " ",
      });
    });
  });
  return atoms;
}

function paginateReplyText(text) {
  const source = String(text || "");
  if (!source || !dom.replyText || dom.reply.hidden) return [source];
  const maxHeight = replyPageMaxHeight();
  const width = Math.max(80, dom.replyText.clientWidth - 4);
  if (!width) return [source];
  const atoms = replyAtoms(source);
  if (!atoms.length) return [source];

  const fits = (candidate) => measureReplyHeight(candidate, width) <= maxHeight;
  const pages = [];
  let current = "";
  const push = () => {
    if (current.trim()) pages.push(current.trim());
    current = "";
  };

  for (const atom of atoms) {
    const candidate = current ? `${current}${atom.sep}${atom.text}` : atom.text;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) push();
    if (fits(atom.text)) {
      current = atom.text;
      continue;
    }
    // A single sentence is taller than the block: fall back to words.
    const words = atom.text.split(/\s+/);
    let part = "";
    for (const word of words) {
      const next = part ? `${part} ${word}` : word;
      if (!part || fits(next)) part = next;
      else {
        pages.push(part);
        part = word;
      }
    }
    current = part;
  }
  push();
  return pages.length ? pages : [source];
}

function repaginateVisibleReply() {
  if (dom.reply.hidden || app.generating || app.replyKind !== "study") return;
  const source = app.replyText || app.replyPages.join("\n\n");
  if (!source.trim()) return;
  const pages = paginateReplyText(source);
  if (
    pages.length === app.replyPages.length
    && pages.every((page, index) => page === app.replyPages[index])
  ) {
    return;
  }
  setReplyPages(pages, source, "study");
}

function scheduleReplyRepaginate() {
  clearTimeout(replyRepaginateTimer);
  replyRepaginateTimer = setTimeout(repaginateVisibleReply, 160);
}

function submit() {
  if (app.generating) return;
  const text = dom.input.value.trim();
  if (text) {
    if (!app.send({ type: "text", text })) {
      toast(i18n.t("toast.disconnected"), "error");
      return;
    }
    dom.input.value = "";
    app.userEditing = false;
    autoGrow();
    hideHint();
    sound.play("send");
    setStatus("thinking");
    return;
  }
  if (app.pending || app.micActive) {
    if (!app.send({ type: "submit" })) {
      toast(i18n.t("toast.disconnected"), "error");
      return;
    }
    hideHint();
    sound.play("send");
    setStatus("thinking");
  } else {
    dom.input.focus();
  }
}

function onReplyClick(event) {
  if (event.target.closest?.(".reply-foot")) return;
  event.stopPropagation();
  if (app.generating) {
    app.send({ type: "cancel" });
    app.generating = false;
    app.replyId = null;
    app.replyText = "";
    hideReply();
    document.body.classList.remove("generating");
    app.character?.setSpeaking(false);
    app.character?.setState("idle");
    setStatus(app.micActive ? "listening" : "idle");
    return;
  }
  hideReply();
  setStatus(app.micActive ? "listening" : "idle");
  dom.input.focus();
}

// --------------------------------------------------------------------------
// Status / mode / hints
// --------------------------------------------------------------------------

function setStatus(status, detail = "") {
  const mapped = status === "generating" ? "thinking" : status;
  app.status = mapped;
  if (dom.statusLine) {
    dom.statusLine.textContent = i18n.t(`status.${mapped}`);
    dom.statusLine.className = `status-line ${mapped}`;
  }
  if (dom.characterWrap) dom.characterWrap.dataset.state = mapped;
  document.body.dataset.state = mapped;
  if (app.character) {
    if (mapped === "error") {
      app.character.setEmotion("glitch", 1, 1400, "local");
      app.character.setState("idle");
    } else {
      app.character.setState(mapped);
    }
  }
  document.body.classList.toggle("generating", Boolean(app.generating));
  if (detail) app.lastDetail = detail;
}

function updateMode() {
  if (!dom.mode) return;
  for (const button of dom.mode.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.mode === app.mode);
  }
  if (dom.sendHint) dom.sendHint.textContent = i18n.t(`mode.${app.mode}Hint`);
}

function updatePending() {
  if (!dom.pending) return;
  dom.pending.hidden = !app.pending;
  dom.pending.textContent = app.pending ? i18n.t("status.holding") : "";
}

function addEmotionTimeline(emotion, source) {
  app.emotionTimeline.push({ emotion, source, ts: Date.now() / 1000 });
  if (app.emotionTimeline.length > 200) app.emotionTimeline = app.emotionTimeline.slice(-150);
  if (app.debugUI?.isOpen() && app.debugUI.tab === "emotions") app.debugUI.render();
}

function handleError(message, scope = "") {
  const text = message || i18n.t("toast.error");
  toast(text, "error");
  showHint(text, { danger: true, timeout: 7000 });
  sound.play("error");
  app.generating = false;
  document.body.classList.remove("generating");
  dom.reply.classList.remove("streaming");
  if (!app.replyText) hideReply();
  if (scope === "llm") {
    setStatus("error");
    setTimeout(() => {
      if (!app.generating) setStatus(app.micActive ? "listening" : "idle");
    }, 2600);
  }
}

// --------------------------------------------------------------------------
// History
// --------------------------------------------------------------------------

function addHistory(message) {
  if (!message || !message.id) return;
  if (app.history.messages.some((item) => item.id === message.id)) return;
  app.history.messages.push(message);
  if (app.history.messages.length > 1000) app.history.messages = app.history.messages.slice(-1000);
  if (historyOpen) renderHistory();
}

function renderHistory() {
  if (!dom.historyList) return;
  const messages = app.history?.messages || [];
  dom.historyList.textContent = "";
  dom.historyEmpty.hidden = messages.length > 0;
  for (const message of messages.slice(-400)) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${message.role === "user" ? "user" : "assistant"}`;

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const who = document.createElement("span");
    who.textContent = i18n.t(message.role === "user" ? "history.you" : "history.vector", {
      name: companionName(),
    });
    const when = document.createElement("span");
    when.textContent = formatTime(message.ts);
    meta.append(who, when);
    if (message.kind === "study") {
      const chip = document.createElement("span");
      chip.className = "kind-chip";
      chip.textContent = i18n.t("history.study");
      meta.appendChild(chip);
    }

    const body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = message.text || "";

    wrap.append(meta, body);

    const emotions = (message.emotions || []).slice(0, 3);
    if (emotions.length) {
      const chips = document.createElement("div");
      chips.className = "msg-emotions";
      for (const emotion of emotions) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "emotion-chip";
        chip.textContent = i18n.t(`emotion.${emotion}`);
        chip.addEventListener("click", (event) => {
          event.stopPropagation();
          app.character?.setEmotion(emotion, 1, 4200, "debug");
          addEmotionTimeline(emotion, "debug");
        });
        chips.appendChild(chip);
      }
      wrap.appendChild(chips);
    }
    dom.historyList.appendChild(wrap);
  }
  dom.historyList.scrollTop = dom.historyList.scrollHeight;
}

function openHistory() {
  if (app.settingsUI?.isOpen()) app.settingsUI.close();
  if (vocabOpen) closeVocabulary();
  closeStudyMenu();
  renderHistory();
  historyOpen = true;
  dom.historyDrawer.hidden = false;
  showBackdrop();
  requestAnimationFrame(() => dom.historyDrawer.classList.add("open"));
}

function closeHistory() {
  historyOpen = false;
  dom.historyDrawer.classList.remove("open");
  hideBackdrop();
  setTimeout(() => {
    if (!historyOpen) dom.historyDrawer.hidden = true;
  }, 320);
}

async function clearHistory() {
  if (!window.confirm(i18n.t("history.clearConfirm"))) return;
  try {
    const res = await fetch("api/history", { method: "DELETE" });
    if (!res.ok) throw new Error("clear failed");
    app.history.messages = [];
    renderHistory();
    toast(i18n.t("toast.historyCleared"), "good");
  } catch (error) {
    toast(i18n.t("toast.error"), "error");
  }
}

// --------------------------------------------------------------------------
// Study data: notes and vocabulary
// --------------------------------------------------------------------------

const NOTE_COLORS = ["amber", "mint", "rose", "paper"];

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json();
}

function setStudy(study) {
  app.study = {
    notes: Array.isArray(study?.notes) ? study.notes : [],
    vocabulary: Array.isArray(study?.vocabulary) ? study.vocabulary : [],
  };
  if (!app._noteEditing && !app._noteDragging) renderNotes();
  renderVocabulary();
}

function selectedStudyText() {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed) return "";
  const anchor = selection.anchorNode;
  if (!anchor) return "";
  const insideReply = dom.reply.contains(anchor);
  const insideNotes = dom.notesLayer?.contains(anchor);
  if (!insideReply && !insideNotes) return "";
  return selection.toString().replace(/\s+/g, " ").trim().slice(0, 80);
}

function noteGeometry(note) {
  const rect = dom.notesLayer?.getBoundingClientRect();
  const width = rect ? rect.width : 0;
  const height = rect ? rect.height : 0;
  const available = Math.max(120, width - 16);
  const noteWidth = clamp(Number(note.width) || 220, 120, Math.min(480, available));
  const maxLeft = Math.max(8, width - noteWidth - 8);
  const left = clamp(((Number(note.x) || 0) / 100) * width, 8, maxLeft);
  const maxTop = Math.max(56, height - 150);
  const top = clamp(((Number(note.y) || 0) / 100) * height, 56, maxTop);
  return { width: noteWidth, left, top };
}

function growNoteBody(body) {
  body.style.height = "auto";
  body.style.height = `${Math.min(body.scrollHeight, 240)}px`;
}

function iconNode(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.appendChild(use);
  return svg;
}

function clearNoteTimer(noteId) {
  const pending = noteSaveTimers.get(noteId);
  if (pending?.timer) clearTimeout(pending.timer);
  noteSaveTimers.delete(noteId);
}

async function saveNoteNow(note, patch) {
  const pending = noteSaveTimers.get(note.id);
  let payload = patch;
  if (pending) {
    clearTimeout(pending.timer);
    noteSaveTimers.delete(note.id);
    payload = { ...pending.patch, ...patch };
  }
  Object.assign(note, payload);
  try {
    const saved = await apiJson(`api/notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    Object.assign(note, saved);
  } catch (error) {
    toast(i18n.t("toast.error"), "error");
  }
}

function queueNotePatch(note, patch) {
  Object.assign(note, patch);
  const pending = noteSaveTimers.get(note.id) || { timer: 0, patch: {} };
  if (pending.timer) clearTimeout(pending.timer);
  pending.patch = { ...pending.patch, ...patch };
  pending.timer = setTimeout(async () => {
    noteSaveTimers.delete(note.id);
    try {
      const saved = await apiJson(`api/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify(pending.patch),
      });
      Object.assign(note, saved);
    } catch (error) {
      toast(i18n.t("toast.error"), "error");
    }
  }, 350);
  noteSaveTimers.set(note.id, pending);
}

function bindNoteDrag(note, element, handle) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    const layerRect = dom.notesLayer.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const offsetX = event.clientX - box.left;
    const offsetY = event.clientY - box.top;
    app._noteDragging = true;
    element.classList.add("dragging");
    handle.setPointerCapture?.(event.pointerId);

    const onMove = (moveEvent) => {
      const left = clamp(
        moveEvent.clientX - layerRect.left - offsetX,
        8,
        Math.max(8, layerRect.width - box.width - 8),
      );
      const top = clamp(
        moveEvent.clientY - layerRect.top - offsetY,
        56,
        Math.max(56, layerRect.height - 120),
      );
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    };

    const finish = async () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      element.classList.remove("dragging");
      app._noteDragging = false;
      const left = parseFloat(element.style.left) || 0;
      const top = parseFloat(element.style.top) || 0;
      const x = layerRect.width ? clamp((left / layerRect.width) * 100, 0, 100) : note.x;
      const y = layerRect.height ? clamp((top / layerRect.height) * 100, 0, 100) : note.y;
      await saveNoteNow(note, { x, y });
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
}

function buildNoteElement(note) {
  const element = document.createElement("article");
  element.className = `note ${note.color || "amber"}`;
  element.dataset.noteId = note.id;
  const geometry = noteGeometry(note);
  element.style.width = `${geometry.width}px`;
  element.style.left = `${geometry.left}px`;
  element.style.top = `${geometry.top}px`;

  const head = document.createElement("div");
  head.className = "note-head";
  const grip = document.createElement("span");
  grip.className = "note-grip";
  grip.title = i18n.t("notes.drag");

  const share = document.createElement("button");
  share.type = "button";
  share.className = "note-btn" + (note.share ? " active" : "");
  share.title = i18n.t(note.share ? "notes.sharedOn" : "notes.sharedOff");
  share.setAttribute("aria-pressed", String(Boolean(note.share)));
  share.appendChild(iconNode("i-check"));
  share.addEventListener("click", async (event) => {
    event.stopPropagation();
    note.share = !note.share;
    share.classList.toggle("active", note.share);
    share.title = i18n.t(note.share ? "notes.sharedOn" : "notes.sharedOff");
    share.setAttribute("aria-pressed", String(note.share));
    await saveNoteNow(note, { share: note.share });
  });

  const color = document.createElement("button");
  color.type = "button";
  color.className = "note-btn note-color";
  color.title = i18n.t("notes.color");
  const colorDot = document.createElement("span");
  color.appendChild(colorDot);
  color.addEventListener("click", async (event) => {
    event.stopPropagation();
    const index = NOTE_COLORS.indexOf(note.color);
    const next = NOTE_COLORS[(index + 1) % NOTE_COLORS.length];
    note.color = next;
    element.className = `note ${next}`;
    await saveNoteNow(note, { color: next });
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "note-btn";
  remove.title = i18n.t("notes.delete");
  remove.appendChild(iconNode("i-trash"));
  remove.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!window.confirm(i18n.t("notes.deleteConfirm"))) return;
    clearNoteTimer(note.id);
    try {
      await apiJson(`api/notes/${note.id}`, { method: "DELETE" });
      app.study.notes = app.study.notes.filter((item) => item.id !== note.id);
      renderNotes();
    } catch (error) {
      toast(i18n.t("toast.error"), "error");
    }
  });

  head.append(grip, share, color, remove);

  const body = document.createElement("textarea");
  body.className = "note-body";
  body.value = note.text || "";
  body.placeholder = i18n.t("notes.placeholder");
  body.spellcheck = true;
  body.addEventListener("focus", () => {
    app._noteEditing = true;
  });
  body.addEventListener("blur", () => {
    app._noteEditing = false;
    if (noteSaveTimers.has(note.id)) saveNoteNow(note, { text: body.value });
  });
  body.addEventListener("input", () => {
    note.text = body.value;
    growNoteBody(body);
    queueNotePatch(note, { text: body.value });
  });
  body.addEventListener("keydown", (event) => {
    if (event.key === "Escape") body.blur();
  });

  element.append(head, body);
  bindNoteDrag(note, element, head);
  requestAnimationFrame(() => growNoteBody(body));
  return element;
}

function renderNotes() {
  if (!dom.notesLayer) return;
  dom.notesLayer.textContent = "";
  if (!isStudyMode()) return;
  for (const note of app.study.notes) {
    dom.notesLayer.appendChild(buildNoteElement(note));
  }
}

async function addNote({ text = "", share = false } = {}) {
  if (!isStudyMode() || !dom.notesLayer) return;
  const rect = dom.notesLayer.getBoundingClientRect();
  const count = app.study.notes.length;
  const width = clamp(220, 160, Math.min(480, Math.max(160, rect.width - 16)));
  const x = count % 2 === 0 ? 6 : 62;
  const y = 16 + (count % 4) * 10;
  try {
    const note = await apiJson("api/notes", {
      method: "POST",
      body: JSON.stringify({
        text,
        x,
        y,
        width,
        color: app.settings?.experience?.notes_color || "amber",
        share,
      }),
    });
    const index = app.study.notes.findIndex((item) => item.id === note.id);
    if (index >= 0) app.study.notes[index] = note;
    else app.study.notes.push(note);
    renderNotes();
    const body = dom.notesLayer.querySelector(`[data-note-id="${note.id}"] .note-body`);
    body?.focus();
    body?.scrollIntoView({ block: "nearest" });
  } catch (error) {
    toast(i18n.t("toast.error"), "error");
  }
}

function upsertWord(word) {
  const index = app.study.vocabulary.findIndex((item) => item.id === word.id);
  if (index >= 0) app.study.vocabulary[index] = word;
  else app.study.vocabulary.push(word);
}

function resetVocabForm() {
  app.vocabEditing = null;
  app.vocabSource = "";
  dom.vocabTerm.value = "";
  dom.vocabLanguage.value = "";
  dom.vocabMeaning.value = "";
  dom.vocabExample.value = "";
  dom.vocabSave.textContent = i18n.t("vocab.add");
  dom.vocabCancel.hidden = true;
}

function buildVocabItem(word) {
  const item = document.createElement("article");
  item.className = "vocab-item";
  const head = document.createElement("div");
  head.className = "vocab-item-head";
  const term = document.createElement("span");
  term.className = "vocab-term";
  term.textContent = word.term;
  head.appendChild(term);
  if (word.language) {
    const lang = document.createElement("span");
    lang.className = "vocab-lang";
    lang.textContent = word.language;
    head.appendChild(lang);
  }
  if (word.created_at) {
    const when = document.createElement("span");
    when.className = "vocab-date";
    when.textContent = new Date(word.created_at * 1000).toLocaleDateString();
    head.appendChild(when);
  }
  const actions = document.createElement("span");
  actions.className = "vocab-item-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = i18n.t("vocab.edit");
  edit.addEventListener("click", () => {
    app.vocabEditing = word.id;
    app.vocabSource = word.source || "";
    dom.vocabTerm.value = word.term || "";
    dom.vocabLanguage.value = word.language || "";
    dom.vocabMeaning.value = word.meaning || "";
    dom.vocabExample.value = word.example || "";
    dom.vocabSave.textContent = i18n.t("vocab.save");
    dom.vocabCancel.hidden = false;
    dom.vocabTerm.focus();
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "×";
  remove.title = i18n.t("vocab.delete");
  remove.addEventListener("click", async () => {
    if (!window.confirm(i18n.t("vocab.deleteConfirm"))) return;
    try {
      await apiJson(`api/vocabulary/${word.id}`, { method: "DELETE" });
      app.study.vocabulary = app.study.vocabulary.filter((entry) => entry.id !== word.id);
      if (app.vocabEditing === word.id) resetVocabForm();
      renderVocabulary();
    } catch (error) {
      toast(i18n.t("toast.error"), "error");
    }
  });
  actions.append(edit, remove);
  head.appendChild(actions);
  item.appendChild(head);

  if (word.meaning) {
    const meaning = document.createElement("div");
    meaning.className = "vocab-meaning";
    meaning.textContent = word.meaning;
    item.appendChild(meaning);
  }
  if (word.example) {
    const example = document.createElement("div");
    example.className = "vocab-example";
    example.textContent = word.example;
    item.appendChild(example);
  }
  return item;
}

function renderVocabulary() {
  if (!dom.vocabList) return;
  const filter = (app.vocabFilter || "").trim().toLowerCase();
  const words = [...(app.study.vocabulary || [])].sort((a, b) => (
    String(a.term).localeCompare(String(b.term))
  ));
  const filtered = filter
    ? words.filter((word) => `${word.term} ${word.language} ${word.meaning} ${word.example}`.toLowerCase().includes(filter))
    : words;
  dom.vocabList.textContent = "";
  dom.vocabCount.textContent = i18n.t("vocab.count", { count: filtered.length });
  dom.vocabEmpty.textContent = filter ? i18n.t("vocab.noMatches") : i18n.t("vocab.empty");
  dom.vocabEmpty.classList.toggle("show", filtered.length === 0);
  for (const word of filtered) dom.vocabList.appendChild(buildVocabItem(word));
}

function openVocabulary({ term = "", source = "" } = {}) {
  if (app.settingsUI?.isOpen()) app.settingsUI.close();
  if (historyOpen) closeHistory();
  closeStudyMenu();
  vocabOpen = true;
  dom.vocabDrawer.hidden = false;
  showBackdrop();
  requestAnimationFrame(() => dom.vocabDrawer.classList.add("open"));
  dom.vocabSearch.value = app.vocabFilter || "";
  resetVocabForm();
  app.vocabSource = source;
  if (term) dom.vocabTerm.value = term;
  renderVocabulary();
  setTimeout(() => {
    (term ? dom.vocabTerm : dom.vocabSearch).focus();
  }, 180);
}

function closeVocabulary() {
  if (!vocabOpen) return;
  vocabOpen = false;
  dom.vocabDrawer.classList.remove("open");
  hideBackdrop();
  resetVocabForm();
  setTimeout(() => {
    if (!vocabOpen) dom.vocabDrawer.hidden = true;
  }, 320);
}

async function saveVocabulary() {
  const term = dom.vocabTerm.value.trim();
  if (!term) {
    toast(i18n.t("vocab.termRequired"), "error");
    dom.vocabTerm.focus();
    return;
  }
  const payload = {
    term,
    meaning: dom.vocabMeaning.value.trim(),
    example: dom.vocabExample.value.trim(),
    language: dom.vocabLanguage.value.trim(),
    source: app.vocabSource,
  };
  try {
    const word = app.vocabEditing
      ? await apiJson(`api/vocabulary/${app.vocabEditing}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
      : await apiJson("api/vocabulary", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    upsertWord(word);
    resetVocabForm();
    renderVocabulary();
    toast(i18n.t("vocab.saved"), "good");
  } catch (error) {
    toast(i18n.t("toast.error"), "error");
  }
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportVocabularyJson() {
  downloadText(
    "vector-vocabulary.json",
    JSON.stringify(app.study.vocabulary || [], null, 2),
    "application/json",
  );
  toast(i18n.t("toast.exported"), "good");
}

function exportVocabularyCsv() {
  const rows = [["term", "meaning", "example", "language", "created_at"]];
  for (const word of app.study.vocabulary || []) {
    rows.push([word.term, word.meaning, word.example, word.language, word.created_at]);
  }
  const text = `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  downloadText("vector-vocabulary.csv", text, "text/csv");
  toast(i18n.t("toast.exported"), "good");
}

function toggleStudyMenu(force) {
  if (!isStudyMode()) return;
  const next = typeof force === "boolean" ? force : !studyMenuOpen;
  studyMenuOpen = next;
  if (dom.studyMenu) dom.studyMenu.hidden = !next;
}

function closeStudyMenu() {
  if (!studyMenuOpen) return;
  studyMenuOpen = false;
  if (dom.studyMenu) dom.studyMenu.hidden = true;
}

function handleStudyAction(action) {
  closeStudyMenu();
  if (action === "note") addNote();
  else if (action === "word") {
    const term = selectedStudyText() || app.lastSelection || "";
    app.lastSelection = "";
    openVocabulary({ term, source: term ? "selection" : "" });
  } else if (action === "vocabulary") openVocabulary();
  else if (action === "settings") openSettings("study");
}

// --------------------------------------------------------------------------
// Socket
// --------------------------------------------------------------------------

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function sendAudio(chunk) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(chunk.buffer);
}

function connect() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    const wasReconnecting = app.reconnecting;
    app.connected = true;
    app.reconnecting = false;
    reconnectDelay = 1000;
    document.body.classList.remove("reconnecting");
    if (wasReconnecting && hasConnected) toast(i18n.t("toast.connected"), "good");
    hasConnected = true;
  };

  socket.onclose = () => {
    app.connected = false;
    app.reconnecting = true;
    document.body.classList.add("reconnecting");
    setStatus("reconnecting");
    if (app.audio?.active) {
      app.audio.stop(true);
      setMicActive(false);
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(6000, reconnectDelay * 1.6);
  };

  socket.onerror = () => {};

  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    handleEvent(data);
  };
}

function applyHello(data) {
  app.settings = data.settings;
  app.health = data.health || {};
  app.asr = data.asr || app.health.asr || {};
  app.characters = data.characters || { packs: [], skins: [], custom: {} };
  app.server = data.server || {};
  app.version = data.version || "";
  app.history = data.history || { messages: [], facts: [], user_name: "" };
  app.study = data.study || { notes: [], vocabulary: [] };
  if (Array.isArray(data.emotions) && data.emotions.length) app.emotions = data.emotions;
  if (app.generating) {
    app.generating = false;
    app.replyId = null;
    app.replyText = "";
    hideReply();
  }
  applySettings(app.settings, { silent: true });
  app.debugUI?.setVersion(app.version);
  renderHistory();
  renderNotes();
  renderVocabulary();
  updateMode();
  setStatus("idle");
  const forceOnboarding = new URLSearchParams(location.search).has("onboarding");
  const needsPack = !app.settings.app.pack_chosen;
  if (forceOnboarding || !app.settings.app.onboarded) showOnboarding(1);
  else if (needsPack) showOnboarding(3);
  else hideOnboarding();
  if (!app.settings.app.onboarded || needsPack) refreshChecks();
}

function handleEvent(data) {
  app.debugUI?.addEvent(data);
  switch (data.type) {
    case "hello":
      applyHello(data);
      break;

    case "settings":
      applySettings(data.settings);
      break;

    case "state":
      setStatus(data.status || "idle", data.detail || "");
      break;

    case "asr_status":
      app.asr = data.status || {};
      if (!dom.onboarding.hidden) refreshChecks();
      break;

    case "mic":
      setMicActive(Boolean(data.active), { remote: true });
      break;

    case "speech_start":
      app.lastPartial = "";
      setStatus("listening");
      break;

    case "speech_end":
      if (!app.generating) setStatus("thinking");
      break;

    case "asr_partial":
      app.lastPartial = data.text || "";
      if (!app.userEditing && !app.generating && app.lastPartial) {
        setInputText(app.lastPartial);
        setStatus("listening");
      }
      break;

    case "transcript":
      app.lastTranscript = data.text || "";
      if (!app.userEditing && !app.generating && data.text) {
        setInputText(data.text);
        if (app.mode === "hotkey") {
          showHint(i18n.t("hint.hotkey", { key: app.settings?.input?.hotkey || "F2" }));
        } else if (app.mode === "auto") {
          showHint(i18n.t("hint.autoHold"));
        }
      }
      break;

    case "asr_empty":
      if (!app.generating) setStatus(app.micActive ? "listening" : "idle");
      break;

    case "user_message":
      if (data.message) {
        addHistory(data.message);
        setInputText(data.message.text || "");
      }
      app.userEditing = false;
      app.pending = "";
      updatePending();
      hideHint();
      sound.play("send");
      setStatus("thinking");
      break;

    case "assistant_start":
      app.generating = true;
      app.replyId = data.id || null;
      app.replyDirty = true;
      showReply(data.kind || "chat");
      setStatus("thinking");
      hideHint();
      document.body.classList.add("generating");
      break;

    case "assistant_delta":
      if (!app.generating) break;
      if (data.id && app.replyId && data.id !== app.replyId) {
        app.replyId = data.id;
        resetReplyPages();
      }
      appendReplyDelta(data.page, data.text || "");
      app.character?.setState("speaking");
      app.character?.setSpeaking(true);
      setStatus("speaking");
      break;

    case "emotion":
      app.currentEmotion = data.emotion || "neutral";
      app.character?.setEmotion(
        data.emotion,
        data.intensity || 0.9,
        data.duration || 4800,
        data.source || "llm",
      );
      setGlow(app.currentEmotion);
      addEmotionTimeline(app.currentEmotion, data.source || "llm");
      sound.play("emotion");
      break;

    case "assistant_end":
      app.generating = false;
      app.replyId = null;
      if (data.message) {
        const pages = data.message.meta?.pages;
        const kind = data.message.kind || app.replyKind;
        setReplyPages(pages, data.message.text || "", kind);
        if (kind === "study") repaginateVisibleReply();
        addHistory(data.message);
      }
      app.replyDirty = true;
      renderReplyNow();
      dom.reply.classList.remove("streaming");
      document.body.classList.remove("generating");
      app.character?.setSpeaking(false);
      app.character?.setState("idle");
      setStatus("idle");
      sound.play("receive");
      break;

    case "assistant_cancelled":
      app.generating = false;
      app.replyId = null;
      app.replyText = "";
      hideReply();
      document.body.classList.remove("generating");
      app.character?.setSpeaking(false);
      app.character?.setState("idle");
      setStatus(app.micActive ? "listening" : "idle");
      break;

    case "pending": {
      const previous = app.pending;
      app.pending = data.text || "";
      if (!app.userEditing && app.pending) setInputText(app.pending);
      updatePending();
      const mode = data.mode || app.mode;
      if (mode === "hotkey") {
        showHint(i18n.t("hint.hotkey", { key: app.settings?.input?.hotkey || "F2" }));
      } else if (mode === "auto") {
        showHint(i18n.t("hint.autoHold"));
      }
      setStatus("holding");
      if (previous && !app.pending) hideHint();
      break;
    }

    case "pending_clear": {
      const previous = app.pending;
      app.pending = "";
      updatePending();
      if (!app.userEditing && previous && dom.input.value === previous) setInputText("");
      hideHint();
      break;
    }

    case "auto_decision":
      if (!data.send && app.mode === "auto") showHint(i18n.t("hint.autoHold"));
      break;

    case "mood":
      app.mood = data;
      app.character?.setMood({
        affection: data.affection,
        curiosity: data.curiosity,
        energy: data.energy,
      });
      break;

    case "memory":
      app.history.facts = data.facts || [];
      app.history.user_name = data.user_name || "";
      app.settingsUI?.refreshFacts();
      break;

    case "study_changed":
      setStudy(data.study || { notes: [], vocabulary: [] });
      break;

    case "user_emotion":
      app.character?.setEmotion(data.emotion, data.intensity || 0.6, 900, "user");
      addEmotionTimeline(data.emotion, "user");
      break;

    case "history_cleared":
      app.history.messages = [];
      renderHistory();
      toast(i18n.t("toast.historyCleared"), "good");
      break;

    case "history_replaced":
      app.history = data.history || { messages: [], facts: [], user_name: "" };
      renderHistory();
      break;

    case "mode":
      app.mode = data.mode || "silence";
      updateMode();
      break;

    case "error":
      handleError(data.message, data.scope);
      break;

    case "log":
      app.debugUI?.addLog(data.entry);
      break;

    case "debug":
      if (app.debugUI) app.debugUI.snapshot = data.data;
      break;

    case "pong":
      break;

    default:
      break;
  }
}

// --------------------------------------------------------------------------
// Language / labels
// --------------------------------------------------------------------------

function refreshLabels() {
  i18n.apply(document);
  if (dom.langBtn) dom.langBtn.textContent = i18n.locale.toUpperCase();
  if (dom.input) dom.input.placeholder = i18n.t("stage.placeholder", { name: companionName() });
  updateMicButton();
  updateMode();
  updatePending();
  if (app.status) setStatus(app.status);
  if (app.settingsUI?.isOpen()) app.settingsUI.render();
  if (app.debugUI?.isOpen()) app.debugUI.render();
  renderNotes();
  renderVocabulary();
  if (!dom.onboarding.hidden) {
    updateOnboardSelections();
    refreshChecks();
  }
}

function setLanguage(code) {
  localStorage.setItem("vector.locale", code);
  patchSettings({ app: { language: code } });
}

// --------------------------------------------------------------------------
// Onboarding
// --------------------------------------------------------------------------

function setOnboardStep(step) {
  const safe = clamp(Number(step) || 1, 1, 4);
  dom.onboardPanel.dataset.step = String(safe);
  dom.onboardPanel.querySelectorAll(".onboard-step").forEach((section) => {
    section.hidden = Number(section.dataset.step) !== safe;
  });
  if (dom.onboardStepCount) {
    dom.onboardStepCount.textContent = `0${safe} / 04`;
  }
  dom.onboardBack.hidden = safe === 1;
  dom.onboardNext.hidden = safe === 4;
  dom.onboardStart.hidden = safe !== 4;
}

function packList() {
  return app.characters?.packs || [];
}

function packById(id) {
  return packList().find((pack) => pack.id === id) || null;
}

function skinList() {
  return app.characters?.skins || [];
}

function renderPackPreview(canvas, pack) {
  if (!canvas || !pack) return;
  canvas.style.pointerEvents = "none";
  const preview = new Character(canvas, {
    skin: pack.skin,
    paletteName: app.settings?.face?.palette_name || pack.palette || "mono",
    eyeTracking: false,
    blink: false,
    breathing: false,
    particles: false,
    glow: false,
    antenna: false,
    reducedMotion: true,
  });
  preview.setEmotion("happy", 1, 0, "local");
  preview.update(1, performance.now());
  preview.draw();
  preview.destroy();
}

function renderPackChoices() {
  if (!dom.onboardPacks) return;
  dom.onboardPacks.textContent = "";
  for (const pack of packList()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice pack-choice";
    button.dataset.pack = pack.id;
    const canvas = document.createElement("canvas");
    canvas.className = "pack-face";
    button.appendChild(canvas);
    const name = document.createElement("b");
    name.textContent = pack.name;
    const tagline = document.createElement("small");
    tagline.textContent = i18n.locale === "ru" ? pack.tagline_ru : pack.tagline_en;
    button.append(name, tagline);
    dom.onboardPacks.appendChild(button);
    renderPackPreview(canvas, pack);
  }

  const custom = document.createElement("button");
  custom.type = "button";
  custom.className = "choice pack-choice";
  custom.dataset.pack = "custom";
  const icon = document.createElement("span");
  icon.className = "pack-custom-icon";
  icon.textContent = "+";
  const name = document.createElement("b");
  name.textContent = i18n.t("onboarding.custom");
  const tagline = document.createElement("small");
  tagline.textContent = i18n.t("onboarding.customHint");
  custom.append(icon, name, tagline);
  dom.onboardPacks.appendChild(custom);
}

function showOnboarding(step = 1) {
  renderPackChoices();
  dom.onboarding.hidden = false;
  setOnboardStep(step);
  updateOnboardSelections();
  refreshChecks();
}

function hideOnboarding() {
  dom.onboarding.hidden = true;
}

function updateCustomPackFields() {
  const isCustom = (app.settings?.character?.pack || "vector") === "custom";
  dom.onboardCustom.hidden = !isCustom;
  if (!isCustom) return;
  const custom = app.settings?.character?.custom || {};
  dom.onboardCustomName.placeholder = app.characters?.custom?.default_name || "Custom";
  dom.onboardCustomPrompt.placeholder = app.characters?.custom?.default_prompt || "";
  if (document.activeElement !== dom.onboardCustomName) {
    dom.onboardCustomName.value = custom.name || "";
  }
  if (document.activeElement !== dom.onboardCustomPrompt) {
    dom.onboardCustomPrompt.value = custom.prompt || "";
  }
  dom.onboardCustomSkin.textContent = "";
  for (const skin of skinList()) {
    const option = document.createElement("option");
    option.value = skin.id;
    option.textContent = i18n.locale === "ru" ? skin.ru : skin.en;
    dom.onboardCustomSkin.appendChild(option);
  }
  dom.onboardCustomSkin.value = custom.skin || app.characters?.custom?.default_skin || "vector12";
}

function updateOnboardSelections() {
  const language = app.settings?.app?.language || "en";
  const pack = app.settings?.character?.pack || "vector";
  const theme = app.settings?.app?.theme || "mono";
  dom.onboardLang.querySelectorAll("[data-lang]").forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === language);
  });
  dom.onboardPacks?.querySelectorAll("[data-pack]").forEach((button) => {
    button.classList.toggle("active", button.dataset.pack === pack);
  });
  dom.onboardTheme.querySelectorAll("[data-theme]").forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === theme);
  });
  const experience = app.settings?.experience?.mode || "conversation";
  dom.onboardExperience?.querySelectorAll("[data-experience]").forEach((button) => {
    button.classList.toggle("active", button.dataset.experience === experience);
  });
  if (dom.onboardStudyWarning) dom.onboardStudyWarning.hidden = experience !== "study";
  updateCustomPackFields();
}

function applyPack(packId) {
  const currentName = app.settings?.persona?.name || "";
  const knownNames = new Set(["Vector", "MOSS", "Lumen", "Nib", "ZIP"]);
  const keepCustomName = currentName && !knownNames.has(currentName);
  if (packId === "custom") {
    const custom = app.settings?.character?.custom || {};
    const customName = custom.name
      || (keepCustomName ? currentName : app.characters?.custom?.default_name || "Custom");
    patchSettings({
      character: { pack: "custom", custom: { name: customName } },
      persona: { name: customName },
      face: {
        skin: custom.skin || app.characters?.custom?.default_skin || "vector12",
      },
    });
    return;
  }
  const pack = packById(packId);
  if (!pack) return;
  patchSettings({
    character: { pack: pack.id },
    persona: { name: keepCustomName ? currentName : pack.name },
    face: { skin: pack.skin },
  });
}

function setCheck(name, state) {
  const row = dom.onboardChecks.querySelector(`[data-check="${name}"]`);
  if (!row) return;
  const icon = row.querySelector(".check-icon");
  icon.classList.remove("ok", "bad", "loading");
  if (state === "ok") {
    icon.classList.add("ok");
    icon.textContent = "✓";
  } else if (state === "bad") {
    icon.classList.add("bad");
    icon.textContent = "!";
  } else {
    icon.classList.add("loading");
    icon.textContent = "…";
  }
}

async function refreshChecks(healthData = null) {
  let health = healthData || app.health;
  if (!health || !Object.keys(health).length) {
    try {
      const res = await fetch("api/health", { cache: "no-store" });
      if (res.ok) {
        health = await res.json();
        app.health = health;
        app.asr = health.asr || app.asr;
      }
    } catch (error) {
      /* keep the previous state */
    }
  }

  setCheck("llm", health?.ok ? "ok" : health?.error ? "bad" : "loading");

  const asr = health?.asr || app.asr || {};
  if (asr.ready) setCheck("asr", "ok");
  else if (asr.error) setCheck("asr", "bad");
  else setCheck("asr", "loading");

  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    const hasMic = Boolean(devices && devices.some((device) => device.kind === "audioinput"));
    setCheck("mic", hasMic ? "ok" : "bad");
  } catch (error) {
    setCheck("mic", "bad");
  }
}

function finishOnboarding(demo) {
  patchSettings({
    app: { onboarded: true, pack_chosen: true, first_run_hint: false },
    ...(demo ? { llm: { mock: true } } : {}),
  });
  hideOnboarding();
  if (demo) toast(i18n.t("toast.demo"), "good");
  setTimeout(() => dom.input.focus(), 250);
}

// --------------------------------------------------------------------------
// Debug / lab / drawers
// --------------------------------------------------------------------------

function openLab() {
  window.open("lab.html", "_blank", "width=1040,height=820");
}

function openSettings(tab) {
  if (historyOpen) closeHistory();
  if (vocabOpen) closeVocabulary();
  closeStudyMenu();
  app.settingsUI.open(tab);
}

function closeDrawers() {
  closeStudyMenu();
  if (app.settingsUI?.isOpen()) app.settingsUI.close();
  if (historyOpen) closeHistory();
  if (vocabOpen) closeVocabulary();
}

function onBackdropClick() {
  closeDrawers();
}

// --------------------------------------------------------------------------
// Keyboard / wheel / pointer
// --------------------------------------------------------------------------

function canPageReply() {
  if (dom.reply.hidden || app.replyPages.length <= 1) return false;
  if (app.settingsUI?.isOpen() || historyOpen || vocabOpen || app.debugUI?.isOpen() || !dom.onboarding.hidden) {
    return false;
  }
  const tag = document.activeElement?.tagName;
  return !["INPUT", "TEXTAREA", "SELECT"].includes(tag);
}

function onKeyDown(event) {
  const key = event.key;
  const mod = event.ctrlKey || event.metaKey;

  if ((key === "ArrowLeft" || key === "ArrowRight") && canPageReply()) {
    event.preventDefault();
    setReplyPage(app.replyPage + (key === "ArrowRight" ? 1 : -1));
    return;
  }

  if (key === "Escape") {
    if (studyMenuOpen) {
      closeStudyMenu();
      event.preventDefault();
      return;
    }
    if (app.debugUI?.isOpen()) {
      app.debugUI.close();
      event.preventDefault();
      return;
    }
    if (!dom.onboarding.hidden) {
      finishOnboarding(false);
      event.preventDefault();
      return;
    }
    if (app.settingsUI?.isOpen() || historyOpen || vocabOpen) {
      closeDrawers();
      event.preventDefault();
      return;
    }
    if (app.generating) {
      onReplyClick({ stopPropagation() {} });
      event.preventDefault();
      return;
    }
    if (!dom.reply.hidden) {
      hideReply();
      setStatus(app.micActive ? "listening" : "idle");
      event.preventDefault();
      return;
    }
  }

  if (key === "F9") {
    event.preventDefault();
    toggleMic();
    return;
  }

  if (mod && event.shiftKey && key.toLowerCase() === "d") {
    event.preventDefault();
    app.debugUI.toggle();
    return;
  }

  if (mod && !event.shiftKey && key.toLowerCase() === "h") {
    event.preventDefault();
    if (historyOpen) closeHistory();
    else openHistory();
    return;
  }

  const hotkey = app.settings?.input?.hotkey || "F2";
  if (key === hotkey) {
    event.preventDefault();
    submit();
  }
}

function onInputKeyDown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}

function onWheel(event) {
  if (event.target.closest?.(".drawer, .debug, .onboarding, .note, .study-menu")) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.05 : 1 / 1.05;
  if (event.ctrlKey || event.metaKey) {
    patchSettings({ app: { ui_scale: clamp((app.settings?.app?.ui_scale || 1) * factor, 0.75, 1.6) } });
  } else {
    patchSettings({ face: { scale: clamp((app.settings?.face?.scale || 1) * factor, 0.6, 1.8) } });
  }
}

function onStagePointerDown(event) {
  if (event.button !== 0) return;
  const target = event.target;
  if (studyMenuOpen && !target.closest?.("#study-menu, #study-btn")) {
    closeStudyMenu();
    return;
  }
  if (target.closest?.("button, input, textarea, a, .drawer, .debug, .onboarding, .backdrop, .toast, .center, .dock, canvas, .study-menu, .note")) {
    return;
  }
  toggleMic();
}

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------

function bindEvents() {
  dom.micBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMic();
  });
  dom.langBtn.addEventListener("click", () => {
    const next = i18n.locale === "ru" ? "en" : "ru";
    setLanguage(next);
  });
  dom.studyBtn?.addEventListener("pointerdown", () => {
    app.lastSelection = selectedStudyText() || app.lastSelection;
  });
  dom.studyBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!studyMenuOpen) app.lastSelection = selectedStudyText() || app.lastSelection;
    toggleStudyMenu();
  });
  dom.studyMenu?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-study-action]");
    if (!button) return;
    handleStudyAction(button.dataset.studyAction);
  });
  dom.historyBtn.addEventListener("click", () => {
    if (historyOpen) closeHistory();
    else openHistory();
  });
  dom.settingsBtn.addEventListener("click", () => openSettings());
  dom.vocabClose?.addEventListener("click", closeVocabulary);
  dom.vocabForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveVocabulary();
  });
  dom.vocabCancel?.addEventListener("click", resetVocabForm);
  dom.vocabSearch?.addEventListener("input", () => {
    app.vocabFilter = dom.vocabSearch.value;
    renderVocabulary();
  });
  dom.vocabExportJson?.addEventListener("click", exportVocabularyJson);
  dom.vocabExportCsv?.addEventListener("click", exportVocabularyCsv);
  dom.historyClose.addEventListener("click", closeHistory);
  dom.historyClear.addEventListener("click", clearHistory);
  dom.historyExport.addEventListener("click", () => app.settingsUI.exportData());
  dom.backdrop.addEventListener("click", onBackdropClick);

  dom.reply.addEventListener("click", onReplyClick);
  dom.replyPrev.addEventListener("click", (event) => {
    event.stopPropagation();
    setReplyPage(app.replyPage - 1);
  });
  dom.replyNext.addEventListener("click", (event) => {
    event.stopPropagation();
    setReplyPage(app.replyPage + 1);
  });
  dom.replyNew.addEventListener("click", (event) => {
    event.stopPropagation();
    jumpToNewReplyPage();
  });
  dom.replyCopy.addEventListener("click", (event) => {
    event.stopPropagation();
    copyReply(app.replyPages[app.replyPage] || "");
  });
  dom.replyCopyAll.addEventListener("click", (event) => {
    event.stopPropagation();
    copyReply(app.replyPages.join("\n\n").trim());
  });
  dom.input.addEventListener("keydown", onInputKeyDown);
  dom.input.addEventListener("input", () => {
    app.userEditing = dom.input.value.length > 0;
    autoGrow();
    hideHint();
  });
  dom.input.addEventListener("blur", () => {
    if (!dom.input.value.trim()) app.userEditing = false;
  });

  dom.mode.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    const mode = button.dataset.mode;
    app.mode = mode;
    updateMode();
    if (!app.send({ type: "set_mode", mode })) {
      patchSettings({ input: { mode } });
    }
  });

  dom.stage.addEventListener("pointerdown", onStagePointerDown);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keydown", scheduleIdle, { passive: true });
  document.addEventListener("pointermove", scheduleIdle, { passive: true });
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", autoGrow);
  window.addEventListener("resize", () => {
    clearTimeout(noteResizeTimer);
    noteResizeTimer = setTimeout(() => {
      if (!app._noteEditing && !app._noteDragging) renderNotes();
    }, 200);
    if (!dom.reply.hidden && app.replyKind === "study") scheduleReplyRepaginate();
  });
  window.addEventListener("resize", () => {
    if (!app._noteEditing && !app._noteDragging) renderNotes();
  });

  dom.onboardLang.addEventListener("click", (event) => {
    const button = event.target.closest("[data-lang]");
    if (!button) return;
    setLanguage(button.dataset.lang);
    updateOnboardSelections();
  });
  dom.onboardPacks.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pack]");
    if (!button) return;
    applyPack(button.dataset.pack);
    updateOnboardSelections();
    if (button.dataset.pack === "custom") {
      dom.onboardCustomName.focus();
      dom.onboardCustom.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
  dom.onboardCustomName.addEventListener("input", () => {
    const name = dom.onboardCustomName.value.trim();
    patchSettings({
      character: { custom: { name } },
      persona: { name: name || app.characters?.custom?.default_name || "Custom" },
    });
  });
  dom.onboardCustomSkin.addEventListener("change", () => {
    patchSettings({
      character: { custom: { skin: dom.onboardCustomSkin.value } },
      face: { skin: dom.onboardCustomSkin.value },
    });
  });
  dom.onboardCustomPrompt.addEventListener("input", () => {
    patchSettings({ character: { custom: { prompt: dom.onboardCustomPrompt.value } } });
  });
  dom.onboardTheme.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme]");
    if (!button) return;
    patchSettings({
      app: { theme: button.dataset.theme },
      face: { palette_name: button.dataset.theme, palette: null },
    });
    renderPackChoices();
    updateOnboardSelections();
  });
  dom.onboardExperience?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-experience]");
    if (!button) return;
    patchSettings({ experience: { mode: button.dataset.experience } });
    updateOnboardSelections();
  });
  dom.onboardNext.addEventListener("click", () => {
    const current = Number(dom.onboardPanel.dataset.step || 1);
    setOnboardStep(current + 1);
    if (current + 1 === 2) refreshChecks();
  });
  dom.onboardBack.addEventListener("click", () => {
    const current = Number(dom.onboardPanel.dataset.step || 1);
    setOnboardStep(current - 1);
  });
  dom.onboardSkip.addEventListener("click", () => finishOnboarding(false));
  dom.onboardStart.addEventListener("click", () => finishOnboarding(false));
  dom.onboardDemo.addEventListener("click", () => finishOnboarding(true));
  dom.onboardRetry.addEventListener("click", () => refreshChecks());

  document.addEventListener("locale-changed", () => {
    refreshLabels();
    app.settingsUI?.render();
  });

  window.addEventListener("beforeunload", () => {
    app.audio?.stop(true);
    socket?.close();
    app.character?.destroy();
  });
}

async function init() {
  const storedLocale = localStorage.getItem("vector.locale")
    || (navigator.language || "en").slice(0, 2);
  await i18n.init(storedLocale === "ru" ? "ru" : "en");

  app.character = new Character(dom.character, {
    skin: "vector12",
    paletteName: "mono",
    separation: "inset",
    eyeTracking: true,
    blink: true,
    breathing: true,
    particles: false,
    glow: false,
    antenna: false,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  });
  app.character.onPoke = () => {
    sound.play("poke");
    app.send({ type: "poke" });
    addEmotionTimeline("poke", "local");
  };
  app.character.onEmotion = (id) => setGlow(id);
  app.character.start();

  app.audio = new AudioEngine({
    onChunk: sendAudio,
    onLevel: (level) => {
      document.documentElement.style.setProperty("--level", level.toFixed(3));
      app.character?.setLevel(level);
    },
    onState: (active) => setMicActive(active),
    onError: handleMicError,
  });
  app.audio.deviceId = localStorage.getItem("vector.micDevice") || null;

  app.settingsUI = new SettingsUI(app);
  app.debugUI = new DebugUI(app);

  app.patchSettings = patchSettings;
  app.applySettings = applySettings;
  app.applyPack = applyPack;
  app.addNote = addNote;
  app.openVocabulary = openVocabulary;
  app.setStudy = setStudy;
  app.toast = toast;
  app.send = send;
  app.sendAudio = sendAudio;
  app.setLanguage = setLanguage;
  app.setMicDevice = setMicDevice;
  app.openLab = openLab;
  app.addEmotionTimeline = addEmotionTimeline;
  app.showBackdrop = showBackdrop;
  app.hideBackdrop = hideBackdrop;
  app.reloadSettings = reloadSettings;
  app.i18n = i18n;

  window.vectorApp = app;
  app.debugUI.setVersion("2.0.0");
  bindEvents();
  updateMicButton();
  updateMode();
  updatePending();
  setStatus("idle");
  autoGrow();
  connect();
  setInterval(() => {
    fetch("api/health", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        app.health = data;
        app.asr = data.asr || app.asr;
      })
      .catch(() => {});
  }, 15000);
  scheduleIdle();
}

init().catch((error) => {
  console.error(error);
  toast("Vector failed to start. Check the server log.", "error");
});
