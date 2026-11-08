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
  historyBtn: $("history-btn"),
  settingsBtn: $("settings-btn"),
  character: $("character"),
  characterWrap: $("character-wrap"),
  statusLine: $("status-line"),
  dock: $("dock"),
  hint: $("hint"),
  textStack: $("text-stack"),
  reply: $("reply"),
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
  onboarding: $("onboarding"),
  onboardPanel: $("onboard-panel"),
  onboardStepCount: $("onboard-step-count"),
  onboardLang: $("onboard-lang"),
  onboardStyle: $("onboard-style"),
  onboardTheme: $("onboard-theme"),
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
  presets: [],
  emotions: EMOTION_META,
  server: {},
  version: "",
  history: { messages: [], facts: [], user_name: "" },
  status: "idle",
  micActive: false,
  generating: false,
  replyId: null,
  replyText: "",
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
    if (!app.settingsUI?.isOpen() && !historyOpen && !app.debugUI?.isOpen() && dom.onboarding.hidden) {
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
  if (app.settingsUI?.isOpen() || historyOpen) return;
  dom.backdrop.classList.remove("open");
  setTimeout(() => {
    if (!app.settingsUI?.isOpen() && !historyOpen) dom.backdrop.hidden = true;
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
  root.style.setProperty("--ui-scale", String(settings.app.ui_scale ?? 1));
  root.style.setProperty("--face-scale", String(settings.face.scale ?? 1));

  const reduced = Boolean(
    settings.app.reduced_motion ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  document.body.classList.toggle("reduced-motion", reduced);

  if (app.character) {
    app.character.setStyle(settings.face.style);
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

  if (dom.input) dom.input.placeholder = i18n.t("stage.placeholder");
  updateMicButton();
  setGlow(app.currentEmotion);

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
    const [settingsRes, historyRes] = await Promise.all([
      fetch("api/settings", { cache: "no-store" }),
      fetch("api/history", { cache: "no-store" }),
    ]);
    if (settingsRes.ok) applySettings(await settingsRes.json());
    if (historyRes.ok) {
      app.history = await historyRes.json();
      renderHistory();
    }
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

function setInputText(text) {
  dom.reply.hidden = true;
  dom.reply.textContent = "";
  dom.input.hidden = false;
  dom.input.value = text || "";
  autoGrow();
  if (!app.userEditing) dom.input.scrollTop = dom.input.scrollHeight;
}

function showReply() {
  dom.input.hidden = true;
  dom.reply.hidden = false;
  dom.reply.textContent = "";
  dom.reply.classList.add("streaming");
  dom.reply.scrollTop = 0;
}

function hideReply() {
  dom.reply.hidden = true;
  dom.reply.textContent = "";
  dom.reply.classList.remove("streaming");
  dom.input.hidden = false;
  autoGrow();
}

function renderReplyNow() {
  cancelAnimationFrame(replyRaf);
  replyRaf = 0;
  if (dom.reply.hidden) return;
  dom.reply.textContent = app.replyText;
  dom.reply.scrollTop = dom.reply.scrollHeight;
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
    who.textContent = i18n.t(message.role === "user" ? "history.you" : "history.vector");
    const when = document.createElement("span");
    when.textContent = formatTime(message.ts);
    meta.append(who, when);

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
  app.presets = data.presets || [];
  app.server = data.server || {};
  app.version = data.version || "";
  app.history = data.history || { messages: [], facts: [], user_name: "" };
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
  updateMode();
  setStatus("idle");
  const forceOnboarding = new URLSearchParams(location.search).has("onboarding");
  if (forceOnboarding || !app.settings.app.onboarded) showOnboarding();
  else hideOnboarding();
  if (!app.settings.app.onboarded) refreshChecks();
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
      app.replyText = "";
      app.replyDirty = true;
      showReply();
      setStatus("thinking");
      hideHint();
      document.body.classList.add("generating");
      break;

    case "assistant_delta":
      if (!app.generating) break;
      if (data.id && app.replyId && data.id !== app.replyId) {
        app.replyId = data.id;
        app.replyText = "";
      }
      app.replyText += data.text || "";
      app.replyDirty = true;
      scheduleReply();
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
        app.replyText = data.message.text || app.replyText;
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
  if (dom.input) dom.input.placeholder = i18n.t("stage.placeholder");
  updateMicButton();
  updateMode();
  updatePending();
  if (app.status) setStatus(app.status);
  if (app.settingsUI?.isOpen()) app.settingsUI.render();
  if (app.debugUI?.isOpen()) app.debugUI.render();
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
  const safe = clamp(Number(step) || 1, 1, 3);
  dom.onboardPanel.dataset.step = String(safe);
  dom.onboardPanel.querySelectorAll(".onboard-step").forEach((section) => {
    section.hidden = Number(section.dataset.step) !== safe;
  });
  if (dom.onboardStepCount) {
    dom.onboardStepCount.textContent = `0${safe} / 03`;
  }
  dom.onboardBack.hidden = safe === 1;
  dom.onboardNext.hidden = safe === 3;
  dom.onboardStart.hidden = safe !== 3;
}

function showOnboarding() {
  dom.onboarding.hidden = false;
  setOnboardStep(1);
  updateOnboardSelections();
  refreshChecks();
}

function hideOnboarding() {
  dom.onboarding.hidden = true;
}

function updateOnboardSelections() {
  const language = app.settings?.app?.language || "en";
  const style = app.settings?.face?.style || "pixel";
  const theme = app.settings?.app?.theme || "ink";
  dom.onboardLang.querySelectorAll("[data-lang]").forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === language);
  });
  dom.onboardStyle.querySelectorAll("[data-face-style]").forEach((button) => {
    button.classList.toggle("active", button.dataset.faceStyle === style);
  });
  dom.onboardTheme.querySelectorAll("[data-theme]").forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === theme);
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
    app: { onboarded: true, first_run_hint: false },
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
  app.settingsUI.open(tab);
}

function closeDrawers() {
  if (app.settingsUI?.isOpen()) app.settingsUI.close();
  if (historyOpen) closeHistory();
}

function onBackdropClick() {
  closeDrawers();
}

// --------------------------------------------------------------------------
// Keyboard / wheel / pointer
// --------------------------------------------------------------------------

function onKeyDown(event) {
  const key = event.key;
  const mod = event.ctrlKey || event.metaKey;

  if (key === "Escape") {
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
    if (app.settingsUI?.isOpen() || historyOpen) {
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
  if (event.target.closest?.(".drawer, .debug, .onboarding")) return;
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
  if (target.closest?.("button, input, textarea, a, .drawer, .debug, .onboarding, .backdrop, .toast, .center, .dock, canvas")) {
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
  dom.historyBtn.addEventListener("click", () => {
    if (historyOpen) closeHistory();
    else openHistory();
  });
  dom.settingsBtn.addEventListener("click", () => openSettings());
  dom.historyClose.addEventListener("click", closeHistory);
  dom.historyClear.addEventListener("click", clearHistory);
  dom.historyExport.addEventListener("click", () => app.settingsUI.exportData());
  dom.backdrop.addEventListener("click", onBackdropClick);

  dom.reply.addEventListener("click", onReplyClick);
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

  dom.onboardLang.addEventListener("click", (event) => {
    const button = event.target.closest("[data-lang]");
    if (!button) return;
    setLanguage(button.dataset.lang);
    updateOnboardSelections();
  });
  dom.onboardStyle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-face-style]");
    if (!button) return;
    patchSettings({ face: { style: button.dataset.faceStyle } });
    updateOnboardSelections();
  });
  dom.onboardTheme.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme]");
    if (!button) return;
    patchSettings({
      app: { theme: button.dataset.theme },
      face: { palette_name: button.dataset.theme, palette: null },
    });
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
    style: "original",
    paletteName: "mono",
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
