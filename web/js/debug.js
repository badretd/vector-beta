/* Debug console: logs, chat, events, state, ASR, emotions, prompt. */

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function time(ts) {
  const date = new Date((ts || Date.now() / 1000) * 1000);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export class DebugUI {
  constructor(app) {
    this.app = app;
    this.tab = "logs";
    this.logs = [];
    this.events = [];
    this.snapshot = null;
    this.el = {
      overlay: $("debug-overlay"),
      close: $("debug-close"),
      refresh: $("debug-refresh"),
      copy: $("debug-copy"),
      download: $("debug-download"),
      tabs: $("debug-tabs"),
      content: $("debug-content"),
      version: $("debug-version"),
      foot: $("debug-foot"),
    };
    this._bind();
  }

  _bind() {
    this.el.close.addEventListener("click", () => this.close());
    this.el.refresh.addEventListener("click", () => this.refresh());
    this.el.copy.addEventListener("click", () => this.copy());
    this.el.download.addEventListener("click", () => this.download());
  }

  isOpen() {
    return !this.el.overlay.hidden;
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open() {
    this.el.overlay.hidden = false;
    this.render();
    this.refresh();
  }

  close() {
    this.el.overlay.hidden = true;
  }

  setVersion(version) {
    this.el.version.textContent = version ? `v${version}` : "";
  }

  addLog(entry) {
    if (!entry) return;
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs = this.logs.slice(-400);
    if (this.isOpen() && this.tab === "logs") this.render();
  }

  addEvent(event) {
    this.events.push(event);
    if (this.events.length > 200) this.events = this.events.slice(-150);
    if (this.isOpen() && this.tab === "events") this.render();
  }

  setTab(tab) {
    this.tab = tab;
    this.render();
  }

  renderTabs() {
    const tabs = ["logs", "chat", "events", "state", "asr", "emotions", "prompt"];
    this.el.tabs.textContent = "";
    for (const tab of tabs) {
      const button = el("button", "debug-tab", this.app.i18n.t(`debug.${tab}`));
      button.type = "button";
      button.classList.toggle("active", tab === this.tab);
      button.addEventListener("click", () => this.setTab(tab));
      this.el.tabs.appendChild(button);
    }
  }

  render() {
    if (!this.isOpen()) return;
    this.renderTabs();
    this.el.content.textContent = "";
    const tab = this.tab;
    if (tab === "logs") this.renderLogs();
    else if (tab === "chat") this.renderChat();
    else if (tab === "events") this.renderEvents();
    else if (tab === "state") this.renderState();
    else if (tab === "asr") this.renderAsr();
    else if (tab === "emotions") this.renderEmotions();
    else if (tab === "prompt") this.renderPrompt();
    this.el.foot.textContent = this.app.i18n.t("debug.autoScroll") + " · Ctrl+Shift+D";
  }

  summary(text) {
    this.el.content.appendChild(el("div", "summary", text));
  }

  renderLogs() {
    this.summary(`${this.logs.length} / 500`);
    if (!this.logs.length) {
      this.el.content.appendChild(el("div", "", this.app.i18n.t("debug.empty")));
      return;
    }
    for (const entry of this.logs.slice(-400)) {
      const row = el("div", "row");
      row.appendChild(el("span", "time", time(entry.ts)));
      row.appendChild(el("span", `level ${entry.level || "INFO"}`, entry.level || "INFO"));
      row.appendChild(el("span", "msg-line", entry.message || ""));
      this.el.content.appendChild(row);
    }
    this.el.content.scrollTop = this.el.content.scrollHeight;
  }

  renderChat() {
    const messages = this.app.history?.messages || [];
    this.summary(`${messages.length} messages`);
    if (!messages.length) {
      this.el.content.appendChild(el("div", "", this.app.i18n.t("debug.empty")));
      return;
    }
    for (const message of messages.slice(-200)) {
      const row = el("div", "row");
      row.appendChild(el("span", "time", time(message.ts)));
      row.appendChild(el("span", "level INFO", String(message.role || "").toUpperCase()));
      row.appendChild(el("span", "msg-line", message.text || ""));
      this.el.content.appendChild(row);
    }
    this.el.content.scrollTop = this.el.content.scrollHeight;
  }

  renderEvents() {
    this.summary(`${this.events.length} events`);
    for (const event of this.events.slice(-100)) {
      const payload = { ...event };
      delete payload.type;
      const label = event.type || "event";
      const body = Object.keys(payload).length ? JSON.stringify(payload, null, 2) : "";
      this.el.content.appendChild(el("div", "row", `${label}  ${body}`));
    }
  }

  renderState() {
    const data = {
      status: this.app.status,
      micActive: this.app.micActive,
      generating: this.app.generating,
      mode: this.app.mode,
      connected: this.app.connected,
      health: this.app.health,
      asr: this.app.asr,
      settings: this.app.settings,
      server: this.app.server,
    };
    this.el.content.appendChild(el("div", "", JSON.stringify(data, null, 2)));
  }

  renderAsr() {
    const data = {
      status: this.app.asr,
      lastTranscript: this.app.lastTranscript,
      lastPartial: this.app.lastPartial,
      config: this.app.settings?.asr,
    };
    this.el.content.appendChild(el("div", "", JSON.stringify(data, null, 2)));
  }

  renderEmotions() {
    this.summary(this.app.i18n.t("debug.emotions"));
    const grid = el("div", "debug-emotions");
    for (const emotion of this.app.emotions || []) {
      const button = el("button", "debug-emotion", emotion.id);
      button.type = "button";
      button.title = `${emotion.en} / ${emotion.ru}`;
      button.addEventListener("click", () => {
        this.app.character.setEmotion(emotion.id, 1, 4200, "debug");
        this.app.addEmotionTimeline(emotion.id, "debug");
      });
      grid.appendChild(button);
    }
    this.el.content.appendChild(grid);

    const timeline = this.app.emotionTimeline || [];
    this.summary(`${timeline.length} recent`);
    for (const item of timeline.slice(-60).reverse()) {
      this.el.content.appendChild(el("div", "", `${time(item.ts)}  ${item.emotion}  (${item.source})`));
    }
  }

  async renderPrompt() {
    this.el.content.appendChild(el("div", "", "…"));
    try {
      const res = await fetch("api/prompt", { cache: "no-store" });
      const data = await res.json();
      this.el.content.textContent = data.prompt || "";
    } catch (error) {
      this.el.content.textContent = String(error);
    }
  }

  async refresh() {
    try {
      const res = await fetch("api/debug", { cache: "no-store" });
      if (!res.ok) return;
      this.snapshot = await res.json();
      if (!this.logs.length && Array.isArray(this.snapshot.logs)) {
        this.logs = this.snapshot.logs.slice(-400);
      }
      if (this.isOpen()) this.render();
    } catch (error) {
      /* server may be restarting */
    }
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.el.content.textContent || "");
      this.app.toast(this.app.i18n.t("debug.copied"), "good");
    } catch (error) {
      this.app.toast(this.app.i18n.t("toast.error"), "error");
    }
  }

  async download() {
    let data = this.snapshot;
    try {
      const res = await fetch("api/debug", { cache: "no-store" });
      if (res.ok) data = await res.json();
    } catch (error) {
      /* use the cached snapshot */
    }
    const blob = new Blob([JSON.stringify(data || {}, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = "vector-debug.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
