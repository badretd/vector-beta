/* Settings drawer: generated, auto-saving, deliberately small. */

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function patchFor(path, value) {
  const patch = {};
  setPath(patch, path, value);
  return patch;
}

export class SettingsUI {
  constructor(app) {
    this.app = app;
    this.tab = "voice";
    this.models = [];
    this.devices = [];
    this.el = {
      drawer: $("settings-drawer"),
      backdrop: $("backdrop"),
      tabs: $("settings-tabs"),
      body: $("settings-body"),
      close: $("settings-close"),
      save: $("settings-save-state"),
      importBtn: $("settings-import"),
      exportBtn: $("settings-export"),
      resetBtn: $("settings-reset"),
    };
    this._bind();
  }

  _bind() {
    this.el.close.addEventListener("click", () => this.close());
    this.el.importBtn.addEventListener("click", () => this.importData());
    this.el.exportBtn.addEventListener("click", () => this.exportData());
    this.el.resetBtn.addEventListener("click", () => this.reset());
  }

  get settings() {
    return this.app.settings || {};
  }

  get(path) {
    return path.split(".").reduce((cur, part) => (cur && cur[part] !== undefined ? cur[part] : undefined), this.settings);
  }

  patch(path, value) {
    this.app.patchSettings(patchFor(path, value));
  }

  open(tab) {
    if (tab) this.tab = tab;
    this.render();
    this.el.drawer.hidden = false;
    this.app.showBackdrop(true);
    requestAnimationFrame(() => this.el.drawer.classList.add("open"));
    this.loadAuxiliary();
  }

  close() {
    this.el.drawer.classList.remove("open");
    this.app.hideBackdrop();
    setTimeout(() => {
      if (!this.el.drawer.classList.contains("open")) this.el.drawer.hidden = true;
    }, 320);
  }

  toggle(tab) {
    if (!this.el.drawer.hidden && this.el.drawer.classList.contains("open")) this.close();
    else this.open(tab);
  }

  isOpen() {
    return !this.el.drawer.hidden && this.el.drawer.classList.contains("open");
  }

  setTab(tab) {
    this.tab = tab;
    this.render();
  }

  saved() {
    this.el.save.textContent = this.app.i18n.t("settings.saved");
    this.el.save.classList.add("show");
    clearTimeout(this._savedTimer);
    this._savedTimer = setTimeout(() => this.el.save.classList.remove("show"), 1600);
  }

  render() {
    if (!this.settings || !this.settings.app) return;
    this.renderTabs();
    this.renderBody();
  }

  renderTabs() {
    const tabs = [
      ["voice", "settings.tabs.voice"],
      ["character", "settings.tabs.character"],
      ["companion", "settings.tabs.companion"],
      ["advanced", "settings.tabs.advanced"],
    ];
    this.el.tabs.textContent = "";
    for (const [id, key] of tabs) {
      const button = el("button", "tab", this.app.i18n.t(key));
      button.type = "button";
      button.dataset.tab = id;
      button.classList.toggle("active", id === this.tab);
      button.addEventListener("click", () => this.setTab(id));
      this.el.tabs.appendChild(button);
    }
  }

  renderBody() {
    this.el.body.textContent = "";
    if (this.tab === "voice") this.renderVoice();
    else if (this.tab === "character") this.renderCharacter();
    else if (this.tab === "companion") this.renderCompanion();
    else this.renderAdvanced();
  }

  // -- controls ---------------------------------------------------------

  field(labelKey, control, hintKey) {
    const wrap = el("div", "field");
    const label = el("label", "", this.app.i18n.t(labelKey));
    wrap.appendChild(label);
    wrap.appendChild(control);
    if (hintKey) wrap.appendChild(el("div", "hint-text", this.app.i18n.t(hintKey)));
    return wrap;
  }

  select(path, options, labels = null) {
    const node = el("select");
    for (const option of options) {
      const value = Array.isArray(option) ? option[0] : option;
      const text = Array.isArray(option)
        ? this.app.i18n.t(option[1])
        : (labels && labels[value]) || value;
      const item = el("option", "", text);
      item.value = value;
      node.appendChild(item);
    }
    node.value = String(this.get(path) ?? "");
    node.addEventListener("change", () => this.patch(path, node.value));
    return node;
  }

  text(path, placeholder = "") {
    const node = el("input");
    node.type = "text";
    node.value = String(this.get(path) ?? "");
    node.placeholder = placeholder;
    node.addEventListener("change", () => this.patch(path, node.value.trim()));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        node.blur();
      }
    });
    return node;
  }

  textarea(path, placeholder = "", rows = 4) {
    const node = el("textarea", "settings-input");
    node.rows = rows;
    node.value = String(this.get(path) ?? "");
    node.placeholder = placeholder;
    node.addEventListener("change", () => this.patch(path, node.value.trim()));
    return node;
  }

  number(path, min, max) {
    const node = el("input");
    node.type = "number";
    node.min = String(min);
    node.max = String(max);
    node.value = String(this.get(path) ?? "");
    node.addEventListener("change", () => {
      const value = Number(node.value);
      if (Number.isFinite(value)) this.patch(path, Math.max(min, Math.min(max, value)));
    });
    return node;
  }

  range(path, min, max, step, format = (v) => String(v)) {
    const row = el("div", "range-row");
    const node = el("input");
    node.type = "range";
    node.min = String(min);
    node.max = String(max);
    node.step = String(step);
    node.value = String(this.get(path) ?? min);
    const value = el("span", "range-value", format(Number(node.value)));
    node.addEventListener("input", () => {
      const current = Number(node.value);
      value.textContent = format(current);
      this.patch(path, current);
    });
    row.append(node, value);
    return row;
  }

  toggle(path) {
    const label = el("label", "toggle");
    const input = el("input");
    input.type = "checkbox";
    input.checked = Boolean(this.get(path));
    const track = el("span", "track");
    track.appendChild(el("span"));
    label.append(input, track);
    input.addEventListener("change", () => this.patch(path, input.checked));
    return label;
  }

  toggleField(labelKey, path) {
    const row = el("div", "inline-toggle");
    row.appendChild(el("span", "field-label", this.app.i18n.t(labelKey)));
    row.appendChild(this.toggle(path));
    return row;
  }

  colorField(labelKey, key) {
    const wrap = el("label", "color-field");
    wrap.appendChild(el("span", "", this.app.i18n.t(labelKey)));
    const input = el("input");
    input.type = "color";
    const palette = this.settings.face?.palette || {};
    const base = this.app.character?.palette?.[key] || "#7dffc4";
    input.value = palette[key] || base;
    input.addEventListener("input", () => {
      this.app.patchSettings({ face: { palette: { [key]: input.value } } });
    });
    wrap.appendChild(input);
    return wrap;
  }

  // -- tabs -------------------------------------------------------------

  renderVoice() {
    const languageOptions = this.app.i18n.available.map((entry) => [entry.code, entry.name]);
    this.el.body.appendChild(this.field(
      "settings.voice.language",
      this.select("app.language", languageOptions.map(([code]) => code), Object.fromEntries(languageOptions)),
    ));

    const modelOptions = ["tiny", "base", "small", "medium", "large-v3"];
    this.el.body.appendChild(this.field(
      "settings.voice.model",
      this.select("asr.model", modelOptions),
    ));

    const langOptions = [
      "auto", "en", "ru", "de", "es", "fr", "uk", "pl", "it", "pt", "zh", "ja",
    ];
    const langLabels = {
      auto: this.app.i18n.locale === "ru" ? "Авто" : "Auto",
      en: "English", ru: "Русский", de: "Deutsch", es: "Español", fr: "Français",
      uk: "Українська", pl: "Polski", it: "Italiano", pt: "Português", zh: "中文", ja: "日本語",
    };
    this.el.body.appendChild(this.field(
      "settings.voice.recognition",
      this.select("asr.language", langOptions, langLabels),
    ));

    const micSelect = el("select");
    const defaultOption = el("option", "", this.app.i18n.t("settings.voice.deviceDefault"));
    defaultOption.value = "";
    micSelect.appendChild(defaultOption);
    const saved = localStorage.getItem("vector.micDevice") || "";
    for (const device of this.devices) {
      const option = el("option", "", device.label || device.id.slice(0, 8));
      option.value = device.id;
      micSelect.appendChild(option);
    }
    micSelect.value = saved;
    micSelect.addEventListener("change", () => this.app.setMicDevice(micSelect.value));
    this.el.body.appendChild(this.field("settings.voice.device", micSelect));

    this.el.body.appendChild(this.field(
      "settings.voice.silence",
      this.range("asr.silence_ms", 250, 5000, 50, (v) => `${(v / 1000).toFixed(1)}s`),
    ));
    this.el.body.appendChild(this.field(
      "settings.voice.sensitivity",
      this.range("asr.vad_sensitivity", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
    ));
    this.el.body.appendChild(this.toggleField("settings.voice.partials", "asr.live_partials"));
  }

  renderCharacter() {
    const packs = this.app.characters?.packs || [];
    const packSelect = el("select");
    for (const pack of packs) {
      const option = el("option", "", pack.name);
      option.value = pack.id;
      packSelect.appendChild(option);
    }
    const customOption = el("option", "", this.app.i18n.t("settings.character.custom"));
    customOption.value = "custom";
    packSelect.appendChild(customOption);
    packSelect.value = this.get("character.pack") || "vector";
    packSelect.addEventListener("change", () => {
      this.app.applyPack(packSelect.value);
      this.render();
    });
    this.el.body.appendChild(this.field(
      "settings.character.pack",
      packSelect,
      "settings.character.packHint",
    ));

    if ((this.get("character.pack") || "vector") === "custom") {
      const nameInput = this.text(
        "character.custom.name",
        this.app.characters?.custom?.default_name || "Custom",
      );
      nameInput.addEventListener("change", () => {
        const fallback = this.app.characters?.custom?.default_name || "Custom";
        this.app.patchSettings({ persona: { name: nameInput.value.trim() || fallback } });
      });
      this.el.body.appendChild(this.field(
        "settings.character.customName",
        nameInput,
      ));
      const skins = this.app.characters?.skins || [];
      const skinLabels = Object.fromEntries(skins.map((skin) => [
        skin.id,
        this.app.i18n.locale === "ru" ? skin.ru : skin.en,
      ]));
      const skinSelect = this.select(
        "character.custom.skin",
        skins.map((skin) => skin.id),
        skinLabels,
      );
      skinSelect.addEventListener("change", () => {
        this.app.patchSettings({ face: { skin: skinSelect.value } });
        this.render();
      });
      this.el.body.appendChild(this.field(
        "settings.character.customSkin",
        skinSelect,
      ));
      const defaultPrompt = this.app.characters?.custom?.default_prompt || "";
      this.el.body.appendChild(this.field(
        "settings.character.customPrompt",
        this.textarea("character.custom.prompt", defaultPrompt, 5),
        "settings.character.customPromptHint",
      ));
    }

    const themeSelect = this.select("app.theme", [
      ["mono", "settings.character.mono"],
      ["mint", "settings.character.mint"],
      ["paper", "settings.character.paper"],
    ]);
    themeSelect.addEventListener("change", () => {
      this.app.patchSettings({
        face: { palette_name: themeSelect.value, palette: null },
      });
      this.render();
    });
    this.el.body.appendChild(this.field("settings.character.theme", themeSelect));

    const paletteSelect = this.select("face.palette_name", [
      ["mono", "settings.character.mono"],
      ["mint", "settings.character.mint"],
      ["paper", "settings.character.paper"],
    ]);
    paletteSelect.addEventListener("change", () => {
      this.app.patchSettings({ face: { palette: null } });
      if ((this.get("character.pack") || "vector") === "custom") {
        this.app.patchSettings({ character: { custom: { palette: paletteSelect.value } } });
      }
      this.render();
    });
    this.el.body.appendChild(this.field("settings.character.palette", paletteSelect));
    this.el.body.appendChild(this.field(
      "settings.character.size",
      this.range("face.scale", 0.7, 1.5, 0.05, (v) => `${v.toFixed(2)}×`),
    ));
    this.el.body.appendChild(this.toggleField("settings.character.follow", "face.eye_tracking"));
    this.el.body.appendChild(this.toggleField("settings.character.blink", "face.blink"));
    this.el.body.appendChild(this.toggleField("settings.character.breathe", "face.breathing"));
    this.el.body.appendChild(this.toggleField("settings.character.particles", "face.particles"));
    if ((this.get("face.skin") || "vector12") === "lumen16") {
      this.el.body.appendChild(this.toggleField("settings.character.antenna", "face.antenna"));
    }
    this.el.body.appendChild(this.toggleField("settings.character.reduced", "app.reduced_motion"));

    const colors = el("div", "color-grid");
    const tr = (english, russian) => (this.app.i18n.locale === "ru" ? russian : english);
    colors.appendChild(this.colorField(tr("Ink", "Чернила"), "ink"));
    colors.appendChild(this.colorField(tr("Pupil", "Зрачок"), "pupil"));
    colors.appendChild(this.colorField(tr("Blush", "Румянец"), "blush"));
    colors.appendChild(this.colorField(tr("Accent", "Акцент"), "accent"));
    this.el.body.appendChild(this.field("settings.character.colors", colors));

    const lab = el("button", "ghost-btn", this.app.i18n.t("settings.character.lab"));
    lab.type = "button";
    lab.addEventListener("click", () => this.app.openLab());
    const labWrap = el("div", "field");
    labWrap.appendChild(lab);
    this.el.body.appendChild(labWrap);
  }

  renderCompanion() {
    const activePack = (this.app.characters?.packs || []).find(
      (pack) => pack.id === (this.get("character.pack") || "vector"),
    );
    this.el.body.appendChild(this.field(
      "settings.companion.name",
      this.text("persona.name", activePack?.name || "Vector"),
      "settings.companion.nameHint",
    ));

    const languages = [
      "auto", "en", "ru", "de", "es", "fr", "uk", "pl", "it", "pt", "zh", "ja",
    ];
    const labels = {
      auto: this.app.i18n.locale === "ru" ? "Авто" : "Auto",
      en: "English", ru: "Русский", de: "Deutsch", es: "Español", fr: "Français",
      uk: "Українська", pl: "Polski", it: "Italiano", pt: "Português", zh: "中文", ja: "日本語",
    };
    this.el.body.appendChild(this.field(
      "settings.companion.replyLanguage",
      this.select("persona.reply_language", languages, labels),
    ));
    this.el.body.appendChild(this.field(
      "settings.companion.length",
      this.select("persona.verbosity", [
        ["short", "settings.companion.short"],
        ["medium", "settings.companion.medium"],
      ]),
    ));
    this.el.body.appendChild(this.field(
      "settings.companion.turnMode",
      this.select("input.mode", [
        ["silence", "mode.silence"],
        ["hotkey", "mode.hotkey"],
        ["auto", "mode.auto"],
      ]),
    ));
    this.el.body.appendChild(this.toggleField("settings.companion.nudges", "engagement.proactive"));
    this.el.body.appendChild(this.toggleField("settings.companion.mood", "engagement.mood"));
    this.el.body.appendChild(this.toggleField("settings.companion.remember", "engagement.remember_facts"));

    const memory = el("div", "field");
    memory.appendChild(el("div", "section-title", this.app.i18n.t("settings.companion.facts")));
    memory.appendChild(this.renderFacts());
    this.el.body.appendChild(memory);
  }

  renderFacts() {
    const wrap = el("div", "facts");
    wrap.id = "settings-facts";
    const facts = this.app.history?.facts || [];
    if (!facts.length) {
      wrap.appendChild(el("div", "hint-text", this.app.i18n.t("settings.companion.noFacts")));
    } else {
      for (const fact of facts) {
        const row = el("div", "fact");
        row.appendChild(el("span", "", fact));
        const remove = el("button", "", "×");
        remove.type = "button";
        remove.title = this.app.i18n.locale === "ru" ? "Забыть" : "Forget";
        remove.addEventListener("click", () => this.app.send({ type: "delete_fact", text: fact }));
        row.appendChild(remove);
        wrap.appendChild(row);
      }
    }

    const add = el("div", "fact-add");
    const input = el("input");
    input.type = "text";
    input.placeholder = this.app.i18n.t("settings.companion.addFact");
    const button = el("button", "ghost-btn", this.app.i18n.t("settings.companion.add"));
    button.type = "button";
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      this.app.send({ type: "add_fact", text });
      input.value = "";
      this.app.toast(this.app.i18n.t("toast.factAdded"), "good");
    };
    button.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
    add.append(input, button);
    wrap.appendChild(add);

    if (facts.length) {
      const clear = el("button", "link-btn", this.app.i18n.t("settings.companion.clearFacts"));
      clear.type = "button";
      clear.addEventListener("click", () => this.app.send({ type: "clear_facts" }));
      wrap.appendChild(clear);
    }
    return wrap;
  }

  refreshFacts() {
    if (this.tab !== "companion" || !this.isOpen()) return;
    const current = $("settings-facts");
    if (!current) return;
    current.replaceWith(this.renderFacts());
  }

  renderAdvanced() {
    this.el.body.appendChild(this.field("settings.advanced.url", this.text("llm.base_url")));

    const modelSelect = el("select");
    const currentModel = this.get("llm.model") || "";
    const names = new Set([currentModel, ...this.models].filter(Boolean));
    for (const name of names) {
      const option = el("option", "", name);
      option.value = name;
      modelSelect.appendChild(option);
    }
    modelSelect.value = currentModel;
    modelSelect.addEventListener("change", () => this.patch("llm.model", modelSelect.value));
    this.el.body.appendChild(this.field("settings.advanced.model", modelSelect));

    this.el.body.appendChild(this.field(
      "settings.advanced.temperature",
      this.range("llm.temperature", 0, 2, 0.05, (v) => v.toFixed(2)),
    ));
    this.el.body.appendChild(this.field("settings.advanced.context", this.number("llm.num_ctx", 512, 131072)));
    this.el.body.appendChild(this.field(
      "settings.advanced.maxTokens",
      this.range("llm.max_tokens", 32, 800, 8, (v) => String(v)),
    ));

    this.el.body.appendChild(this.field(
      "settings.advanced.device",
      this.select("asr.device", ["auto", "cpu", "cuda"]),
    ));
    this.el.body.appendChild(this.field(
      "settings.advanced.precision",
      this.select("asr.compute_type", ["auto", "int8", "float16", "int8_float16"]),
    ));
    this.el.body.appendChild(this.field(
      "settings.advanced.logLevel",
      this.select("debug.log_level", ["DEBUG", "INFO", "WARNING", "ERROR"]),
    ));
    this.el.body.appendChild(this.toggleField("settings.advanced.demo", "llm.mock"));
    this.el.body.appendChild(el("div", "hint-text", this.app.i18n.t("settings.advanced.restart")));
  }

  // -- auxiliary data ---------------------------------------------------

  async loadAuxiliary() {
    if (this.tab === "voice") {
      this.devices = await this.app.audio.listDevices();
      this.render();
    }
    if (this.tab === "advanced") {
      try {
        const res = await fetch("api/models", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          this.models = (data.models || []).map((model) => model.name).filter(Boolean);
          this.render();
        }
      } catch (error) {
        /* offline is fine */
      }
    }
  }

  // -- import / export / reset ------------------------------------------

  async exportData() {
    try {
      const res = await fetch("api/export");
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = el("a");
      link.href = url;
      link.download = "vector-export.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.app.toast(this.app.i18n.t("toast.exported"), "good");
    } catch (error) {
      this.app.toast(this.app.i18n.t("toast.error"), "error");
    }
  }

  importData() {
    const input = el("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await fetch("api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("import failed");
        await this.app.reloadSettings();
        this.app.toast(this.app.i18n.t("toast.imported"), "good");
      } catch (error) {
        this.app.toast(this.app.i18n.t("toast.error"), "error");
      }
    });
    input.click();
  }

  async reset() {
    if (!window.confirm(this.app.i18n.t("settings.advanced.resetConfirm"))) return;
    try {
      const res = await fetch("api/settings/reset", { method: "POST" });
      if (!res.ok) throw new Error("reset failed");
      const settings = await res.json();
      this.app.applySettings(settings);
      this.render();
      this.app.toast(this.app.i18n.t("toast.reset"), "good");
    } catch (error) {
      this.app.toast(this.app.i18n.t("toast.error"), "error");
    }
  }
}
