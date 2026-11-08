/* Tiny dependency-free i18n with nested keys and interpolation. */

const FALLBACK = "en";

class I18n {
  constructor() {
    this.locale = FALLBACK;
    this.data = {};
    this.fallback = {};
    this.available = [
      { code: "en", name: "English" },
      { code: "ru", name: "Русский" },
    ];
  }

  async init(locale) {
    try {
      const res = await fetch("locales/en.json", { cache: "no-store" });
      this.fallback = res.ok ? await res.json() : {};
    } catch (error) {
      this.fallback = {};
    }
    const wanted = locale || "en";
    await this.load(wanted);
    try {
      const res = await fetch("api/locales", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.locales && data.locales.length) this.available = data.locales;
      }
    } catch (error) {
      /* optional */
    }
    this.apply();
  }

  async load(locale) {
    this.locale = locale === "ru" ? "ru" : "en";
    if (this.locale === FALLBACK) {
      this.data = this.fallback;
      return;
    }
    try {
      const res = await fetch(`locales/${this.locale}.json`, { cache: "no-store" });
      this.data = res.ok ? await res.json() : {};
    } catch (error) {
      this.data = {};
    }
  }

  t(key, vars = {}) {
    const read = (obj) => key.split(".").reduce((cur, part) => (
      cur && cur[part] !== undefined ? cur[part] : undefined
    ), obj);
    let value = read(this.data);
    if (value === undefined) value = read(this.fallback);
    if (value === undefined) value = key;
    if (typeof value !== "string") return value;
    return value.replace(/\{(\w+)\}/g, (_, name) => (
      vars[name] !== undefined ? vars[name] : `{${name}}`
    ));
  }

  apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const value = this.t(el.getAttribute("data-i18n"));
      if (typeof value === "string") el.textContent = value;
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", this.t(el.getAttribute("data-i18n-placeholder")));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", this.t(el.getAttribute("data-i18n-title")));
    });
    document.documentElement.lang = this.locale;
  }

  async setLocale(locale) {
    await this.load(locale);
    this.apply();
    document.dispatchEvent(new CustomEvent("locale-changed", { detail: this.locale }));
  }

  label(code) {
    const found = this.available.find((entry) => entry.code === code);
    return found ? found.name : String(code || "").toUpperCase();
  }
}

export const i18n = new I18n();
