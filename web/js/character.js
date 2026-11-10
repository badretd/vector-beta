/* Vector's animated pixel character.
 *
 * A tiny procedural face drawn on a logical grid. The renderer is intentionally
 * dumb: it interpolates a small set of pose parameters and draws chunky pixels.
 * Everything else — blinking, saccades, breathing, particles, emotion blends —
 * is coordinated here so the rest of the UI only has to say "listening" or
 * "sad".
 */

export const EMOTIONS = {
  neutral: { en: "neutral", ru: "спокойствие", color: "#9fb8b1" },
  happy: { en: "happy", ru: "радость", color: "#ffd166" },
  excited: { en: "excited", ru: "восторг", color: "#ffb703" },
  curious: { en: "curious", ru: "любопытство", color: "#7dffc4" },
  thinking: { en: "thinking", ru: "размышление", color: "#8ecae6" },
  sad: { en: "sad", ru: "грусть", color: "#7ad7ff" },
  surprised: { en: "surprised", ru: "удивление", color: "#ffd60a" },
  confused: { en: "confused", ru: "недоумение", color: "#c7a5ff" },
  sleepy: { en: "sleepy", ru: "сонливость", color: "#a0a8ff" },
  angry: { en: "angry", ru: "злость", color: "#ff6b6b" },
  embarrassed: { en: "embarrassed", ru: "смущение", color: "#ff8fa3" },
  love: { en: "love", ru: "нежность", color: "#ff5d8f" },
  proud: { en: "proud", ru: "гордость", color: "#ffc857" },
  scared: { en: "scared", ru: "испуг", color: "#b8a1ff" },
  bored: { en: "bored", ru: "скука", color: "#8d99ae" },
  wink: { en: "wink", ru: "подмигивание", color: "#ffd166" },
  laugh: { en: "laugh", ru: "смех", color: "#ffe066" },
  glitch: { en: "glitch", ru: "глюк", color: "#ff4d6d" },
  listening: { en: "listening", ru: "внимание", color: "#7dffc4" },
  processing: { en: "processing", ru: "обработка", color: "#8ecae6" },
};

export const ALIASES = {
  joy: "happy", glad: "happy", cheerful: "happy", smile: "happy", smiling: "happy",
  laughs: "laugh", laughing: "laugh", laughter: "laugh", amused: "laugh", haha: "laugh",
  interest: "curious", interested: "curious", question: "confused", puzzled: "confused",
  fear: "scared", afraid: "scared", anxious: "scared", shy: "embarrassed", blush: "embarrassed",
  loving: "love", affection: "love", tired: "sleepy", drowsy: "sleepy", annoyed: "angry",
  mad: "angry", wow: "surprised", shock: "surprised", shocked: "surprised", calm: "neutral",
  ok: "neutral", normal: "neutral", smug: "proud", error: "glitch", glitching: "glitch",
  thinking: "thinking", processing: "processing", listening: "listening", bored: "bored",
};

const BASE = {
  eyeOpen: 1, eyeShape: "round", pupil: 1, brow: 0, browInner: 0,
  mouth: 0.22, mouthOpen: 0, mouthWidth: 1, mouthWave: 0, smirk: 0,
  blush: 0, tear: 0, sweat: 0, sparkle: 0, hearts: 0, zzz: 0,
  shake: 0, bounce: 0, glow: 1, tilt: 0, glitch: 0, steam: 0,
  question: 0, exclaim: 0, dots: 0, droop: 0, sleep: 0, cat: 0,
  level: 0, typing: 0,
};

const PRESETS = {
  neutral: { mouth: 0.35, mouthWidth: 1.0, blush: 0.06 },
  happy: { eyeShape: "happy", mouth: 0.9, mouthWidth: 1.15, blush: 0.3, bounce: 0.36, sparkle: 0.42 },
  excited: { eyeOpen: 1.2, mouth: 1, mouthOpen: 0.36, mouthWidth: 1.25, blush: 0.2, bounce: 0.8, sparkle: 0.8, hearts: 0.16, glow: 1.2 },
  curious: { eyeOpen: 1.1, pupil: 1.2, brow: 0.55, mouth: 0.2, mouthWidth: 0.85, tilt: 1.5, question: 0.8, sparkle: 0.2 },
  thinking: { eyeShape: "half", brow: 0.35, mouth: -0.05, mouthWidth: 0.8, tilt: -1.2, dots: 1, droop: 0.15 },
  sad: { eyeOpen: 0.8, brow: 0.6, browInner: 0.8, mouth: -0.9, mouthWidth: 0.9, tear: 0.6, droop: 0.5, glow: 0.8 },
  surprised: { eyeOpen: 1.5, pupil: 0.7, brow: 0.9, mouthOpen: 0.9, mouth: 0, mouthWidth: 0.8, exclaim: 0.9, shake: 0.12, glow: 1.3 },
  confused: { eyeShape: "squint", brow: 0.5, mouth: -0.1, mouthWave: 1, mouthWidth: 0.9, question: 1, tilt: 1.8, droop: 0.1 },
  sleepy: { eyeOpen: 0.2, brow: 0.1, mouth: -0.1, mouthWidth: 0.8, zzz: 1, droop: 0.7, sleep: 0.7, glow: 0.65 },
  angry: { eyeOpen: 0.7, brow: -0.9, browInner: -0.5, mouth: -0.8, mouthWidth: 0.95, steam: 0.7, shake: 0.1, glow: 1.1 },
  embarrassed: { eyeOpen: 0.8, pupil: 0.9, brow: 0.25, mouth: -0.1, mouthWave: 0.8, mouthWidth: 0.8, blush: 1, sweat: 0.4, tilt: -1.4, droop: 0.2 },
  love: { eyeShape: "heart", mouth: 0.85, mouthWidth: 1.2, blush: 1, hearts: 1, bounce: 0.3, glow: 1.3 },
  proud: { eyeShape: "happy", mouth: 0.55, smirk: 1, mouthWidth: 1.1, sparkle: 0.8, brow: 0.25, glow: 1.2 },
  scared: { eyeOpen: 1.4, pupil: 0.55, brow: 0.8, browInner: 0.5, mouthOpen: 0.3, mouthWave: 1, mouthWidth: 0.7, shake: 0.5, sweat: 0.7, tear: 0.2, glow: 1.2 },
  bored: { eyeOpen: 0.45, eyeShape: "half", brow: -0.25, mouth: -0.2, mouthWidth: 0.9, droop: 0.45, dots: 0.5, glow: 0.7 },
  wink: { eyeShape: "wink", mouth: 0.65, smirk: 1, mouthWidth: 1.05, sparkle: 0.5, blush: 0.2 },
  laugh: { eyeShape: "happy", mouth: 1, mouthOpen: 0.85, mouthWidth: 1.3, bounce: 0.7, tear: 0.15, sparkle: 0.5, glow: 1.2 },
  glitch: { eyeShape: "x", mouth: 0.1, mouthWave: 1, glitch: 1, shake: 0.4, glow: 1.4, tilt: 1 },
  listening: { eyeOpen: 1.2, pupil: 1.15, brow: 0.3, mouth: 0.18, mouthWidth: 0.85, glow: 1.35, tilt: 0.5 },
  processing: { eyeShape: "half", brow: 0.2, mouth: 0, mouthWidth: 0.75, dots: 1, tilt: -0.6, glow: 1.15 },
};

export const SKINS = {
  vector12: { id: "vector12", grid: 12, en: "Original 12×12", ru: "Оригинальный 12×12" },
  lumen16: { id: "lumen16", grid: 16, en: "Detailed 16×16", ru: "Детальный 16×16" },
  moss14: { id: "moss14", grid: 14, en: "CRT 14×14", ru: "ЭЛТ 14×14" },
};

export const PALETTES = {
  mono: {
    ink: "#f2f2f2", inkSoft: "#8a8a8a", pupil: "#000000", mouth: "#f2f2f2",
    blush: "#c98b8b", tear: "#9db8c8", sparkle: "#d8d8d8",
    accent: "#e6c06a", accent2: "#d8d8d8", glow: "#ffffff",
  },
  mint: {
    ink: "#c9ffe9", inkSoft: "#74c7a8", pupil: "#071a16", mouth: "#c9ffe9",
    blush: "#ff9fb1", tear: "#7ad7ff", sparkle: "#ffe9a8",
    accent: "#7dffc4", accent2: "#ffd166", glow: "#7dffc4",
  },
  paper: {
    ink: "#2b2118", inkSoft: "#7f6d58", pupil: "#fbf5e9", mouth: "#2b2118",
    blush: "#e89aa4", tear: "#5c9dbb", sparkle: "#d8583e",
    accent: "#d8583e", accent2: "#2d7f74", glow: "#d8583e",
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (current, target, dt, speed = 9) => lerp(current, target, clamp(dt * speed, 0, 1));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const SEPARATION_MODES = ["inset", "gap", "trim", "off"];
// "auto" is the pre-inset value; keep it as a safe alias for old settings.
const normalizeSeparation = (mode) => {
  if (mode === "auto") return "inset";
  return SEPARATION_MODES.includes(mode) ? mode : "inset";
};

function canonical(name) {
  const key = String(name || "").trim().toLowerCase();
  return ALIASES[key] || (PRESETS[key] ? key : null);
}

export class Character {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    const requestedSkin = options.skin || (options.style === "pixel" ? "lumen16" : "vector12");
    this.skin = SKINS[requestedSkin] ? requestedSkin : "vector12";
    this.grid = SKINS[this.skin].grid;
    this.cell = 16;
    this.separation = normalizeSeparation(options.separation);
    this._eyeCells = [];
    this._mouthCells = [];
    this._collisionCells = [];
    this._record = null;
    this.palette = { ...PALETTES[options.paletteName || "mono"], ...(options.palette || {}) };
    this.opts = {
      eyeTracking: true,
      blink: true,
      breathing: true,
      particles: true,
      glow: true,
      antenna: true,
      reducedMotion: false,
      ...options,
    };
    this.params = { ...BASE };
    this.target = { ...BASE };
    this.emotion = "happy";
    this.baseEmotion = "happy";
    this.emotionUntil = 0;
    this.emotionSource = "mood";
    this.intensity = 1;
    this.state = "idle";
    this.mood = { affection: 50, curiosity: 70, energy: 75 };
    this.look = { x: 0, y: 0 };
    this.lookTarget = { x: 0, y: 0 };
    this.pointer = null;
    this.nextSaccade = performance.now() + rand(2200, 5200);
    this.nextBlink = performance.now() + rand(1800, 4200);
    this.blinkStart = 0;
    this.blinking = false;
    this.blink = 0;
    this.t = 0;
    this.last = performance.now();
    this.bob = 0;
    this.tiltPx = 0;
    this.particles = [];
    this.running = false;
    this.onPoke = null;
    this.onEmotion = null;
    this._loop = this._loop.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._bindPointer();
    document.addEventListener("visibilitychange", this._onVisibility);
    this._resizeCanvas();
  }

  // -- public API -------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
  }

  destroy() {
    this.stop();
    document.removeEventListener("visibilitychange", this._onVisibility);
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerleave", this._onPointerLeave);
  }

  setSkin(skin) {
    const next = SKINS[skin] ? skin : "vector12";
    if (next === this.skin) return;
    this.skin = next;
    this.grid = SKINS[next].grid;
    this._resizeCanvas();
  }

  setSeparation(mode) {
    this.separation = normalizeSeparation(mode);
  }

  // Kept for older callers and the ?style= lab links.
  setStyle(style) {
    this.setSkin(style === "pixel" ? "lumen16" : "vector12");
  }

  setPalette(nameOrPalette, overrides = {}) {
    if (typeof nameOrPalette === "string") {
      this.palette = { ...(PALETTES[nameOrPalette] || PALETTES.mono), ...(overrides || {}) };
    } else {
      this.palette = { ...this.palette, ...(nameOrPalette || {}) };
    }
  }

  setOptions(options = {}) {
    this.opts = { ...this.opts, ...options };
  }

  setEmotion(name, intensity = 1, duration = 4800, source = "llm") {
    const key = canonical(name);
    if (!key) return;
    this.emotion = key;
    this.intensity = clamp(intensity || 1, 0.2, 1.4);
    this.emotionSource = source;
    this.emotionUntil = duration > 0 ? performance.now() + duration : 0;
    if (source === "llm" || source === "user") this.spawnBurst(key);
    if (this.onEmotion) this.onEmotion(key, EMOTIONS[key]);
  }

  setState(state) {
    const previous = this.state;
    this.state = state || "idle";
    if (this.state === "listening" && this.emotion === "neutral") {
      this.setEmotion("listening", 0.8, 0, "state");
    }
    if (this.state === "thinking" && (this.emotion === "neutral" || this.emotion === "listening")) {
      this.setEmotion("processing", 0.8, 0, "state");
    }
    if (this.state === "sleeping") {
      this.setEmotion("sleepy", 1, 0, "state");
    }
    if (this.state === "idle" && this.emotionSource === "state" && ["listening", "processing"].includes(this.emotion)) {
      this.setEmotion(this.baseEmotion, 0.6, 0, "mood");
    }
    if (previous === "sleeping" && this.state !== "sleeping") {
      this.setEmotion("surprised", 0.7, 720, "local");
    }
  }

  setSpeaking(on) {
    if (on) {
      this.setState("speaking");
    } else if (this.state === "speaking") {
      this.setState("idle");
    }
  }

  setMood(mood = {}) {
    this.mood = { ...this.mood, ...mood };
    const e = this.mood.energy;
    if (e < 20) this.baseEmotion = "sleepy";
    else if (this.mood.affection < 25) this.baseEmotion = "sad";
    else if (this.mood.curiosity > 85) this.baseEmotion = "curious";
    else this.baseEmotion = "happy";
    if (this.emotion === "neutral" && !this.emotionUntil) {
      this.setEmotion(this.baseEmotion, 0.5, 0, "mood");
    }
  }

  setLevel(level) {
    this.params.level = clamp(Number(level) || 0, 0, 1);
  }

  poke() {
    this.setEmotion("surprised", 1, 620, "local");
    this.spawnBurst("surprised");
    setTimeout(() => {
      if (this.emotion === "surprised") this.setEmotion("happy", 0.85, 2200, "local");
    }, 640);
  }

  wake() {
    if (this.state === "sleeping") {
      this.setState("idle");
      this.setEmotion("surprised", 0.8, 700, "local");
      setTimeout(() => this.setEmotion("happy", 0.8, 2200, "local"), 720);
    } else {
      this.poke();
    }
  }

  spawnBurst(emotion) {
    if (!this.opts.particles || this.opts.reducedMotion) return;
    const symbols = {
      love: ["heart", "spark"], happy: ["spark", "dot"], excited: ["spark", "heart"],
      laugh: ["spark", "dot"], surprised: ["exclaim", "spark"], curious: ["question", "spark"],
      sad: ["dot", "tear"], angry: ["exclaim", "dot"], proud: ["spark", "heart"],
      embarrassed: ["heart", "dot"], glitch: ["dot", "exclaim"], wink: ["spark"],
      scared: ["exclaim", "dot"], sleepy: ["dot"], listening: ["spark"],
    }[emotion] || ["spark"];
    const count = ["love", "excited", "laugh", "glitch", "surprised"].includes(emotion) ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.particles.push({
        x: this.grid / 2 + side * rand(3, this.grid / 2 - 1),
        y: rand(2, this.grid - 4),
        vx: side * rand(0.4, 1.4),
        vy: -rand(0.8, 2.0),
        life: rand(0.7, 1.5),
        maxLife: 1.5,
        size: Math.random() < 0.3 ? 2 : 1,
        color: pick([this.palette.accent, this.palette.accent2, this.palette.blush, this.palette.sparkle]),
        symbol: pick(symbols),
      });
    }
    if (this.particles.length > 80) this.particles.splice(0, this.particles.length - 80);
  }

  // -- internals --------------------------------------------------------

  _resizeCanvas() {
    this.canvas.width = this.grid * this.cell;
    this.canvas.height = this.grid * this.cell;
    this.ctx.imageSmoothingEnabled = false;
  }

  _bindPointer() {
    this._onPointerMove = (event) => {
      if (!this.opts.eyeTracking || this.opts.reducedMotion) return;
      const nx = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      const ny = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
      this.pointer = { x: clamp(nx, -1, 1), y: clamp(ny, -1, 1) };
      this.lookTarget.x = clamp(nx * 1.35, -1.2, 1.2);
      this.lookTarget.y = clamp(ny * 1.1, -1, 1);
    };
    this._onPointerLeave = () => {
      this.pointer = null;
    };
    window.addEventListener("pointermove", this._onPointerMove, { passive: true });
    window.addEventListener("pointerleave", this._onPointerLeave);
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.poke();
      if (this.onPoke) this.onPoke();
    });
  }

  _onVisibility() {
    if (document.hidden) {
      this.stop();
    } else if (!this.running) {
      this.start();
    }
  }

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.update(dt, now);
    this.draw();
    requestAnimationFrame(this._loop);
  }

  update(dt, now) {
    if (this.emotionUntil && now > this.emotionUntil) {
      this.emotionUntil = 0;
      this.emotion = this.baseEmotion;
      this.emotionSource = "mood";
    }

    const preset = PRESETS[this.emotion] || {};
    const target = { ...BASE, ...preset };
    const intensity = this.intensity || 1;
    for (const key of Object.keys(BASE)) {
      if (key in preset && key !== "eyeShape") {
        target[key] = BASE[key] + (preset[key] - BASE[key]) * intensity;
      }
    }

    if (this.state === "listening") {
      target.eyeOpen = Math.max(target.eyeOpen, 1.15);
      target.glow = Math.max(target.glow, 1.2);
      target.mouth = Math.max(target.mouth, 0.1);
    } else if (this.state === "thinking") {
      target.dots = Math.max(target.dots, 0.9);
      target.eyeShape = "half";
      target.brow = Math.max(target.brow, 0.2);
    } else if (this.state === "speaking") {
      target.mouthOpen = Math.max(target.mouthOpen, 0.1 + 0.12 * Math.sin(this.t * 13));
      target.eyeOpen = Math.max(target.eyeOpen, 0.9);
    } else if (this.state === "sleeping") {
      target.eyeOpen = 0;
      target.zzz = 1;
      target.droop = 0.7;
      target.sleep = 0.8;
    }
    this.target = target;

    for (const key of Object.keys(BASE)) {
      if (key === "eyeShape") continue;
      const speed = key === "mouthOpen" || key === "typing" ? 14 : key === "zzz" || key === "glitch" ? 6 : 10;
      this.params[key] = smooth(this.params[key], target[key], dt, speed);
    }
    this.params.eyeShape = target.eyeShape;

    // Blink.
    if (this.opts.blink && !this.opts.reducedMotion && this.state !== "sleeping") {
      if (!this.blinking && now > this.nextBlink) {
        this.blinking = true;
        this.blinkStart = now;
        this.nextBlink = now + rand(2200, 6200) + (Math.random() < 0.16 ? 180 : 0);
      }
      if (this.blinking) {
        const p = (now - this.blinkStart) / 150;
        if (p >= 1) {
          this.blinking = false;
          this.blink = 0;
          if (Math.random() < 0.12) this.nextBlink = now + 180;
        } else {
          this.blink = Math.sin(p * Math.PI);
        }
      } else {
        this.blink = smooth(this.blink, 0, dt, 20);
      }
    } else {
      this.blink = 0;
    }

    // Saccades when the pointer is not steering the gaze.
    if (!this.pointer && now > this.nextSaccade && this.state !== "sleeping") {
      this.nextSaccade = now + rand(1800, 5200);
      this.lookTarget.x = rand(-0.75, 0.75);
      this.lookTarget.y = rand(-0.45, 0.45);
    }
    this.look.x = smooth(this.look.x, this.lookTarget.x, dt, 5);
    this.look.y = smooth(this.look.y, this.lookTarget.y, dt, 5);

    // Body motion.
    const breath = this.opts.breathing && !this.opts.reducedMotion ? Math.sin(this.t * 1.65) : 0;
    const bounce = this.params.bounce * Math.abs(Math.sin(this.t * 5.1)) * 1.5;
    this.bob = Math.round(breath * 0.55 - bounce + this.params.droop * 1.1);
    this.tiltPx = Math.round(this.params.tilt + this.look.x * 0.7);
    this.params.level = smooth(this.params.level, this.state === "listening" ? this.params.level : this.params.level * 0.7, dt, 6);
    this.params.typing = Math.max(0, this.params.typing - dt * 2.2);

    // Particles.
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy *= 0.985;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.y > -2);
  }

  draw() {
    const ctx = this.ctx;
    const grid = this.grid;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(this.cell, 0, 0, this.cell, 0, 0);

    const p = this.params;
    const shakeX = p.shake > 0.05 ? Math.round(rand(-1, 1) * p.shake) : 0;
    const shakeY = p.shake > 0.05 ? Math.round(rand(-1, 1) * p.shake) : 0;
    ctx.save();
    ctx.translate(this.tiltPx + shakeX, this.bob + shakeY);

    if (this.skin === "vector12") this.drawVector12();
    else if (this.skin === "moss14") this.drawMoss();
    else this.drawLumen();

    if (this.opts.debugCollision) this.drawCollisionOverlay();

    ctx.restore();

    this.drawParticles();
    if (this.skin !== "vector12" && p.glitch > 0.12) this.drawGlitch();
  }

  // -- high-level face styles -------------------------------------------

  drawLumen() {
    this.drawAntenna();
    this.drawEyes(16);
    this.drawMouth(16);
    this.drawBlush(16);
    this.drawTears(16);
    this.drawSweat(16);
    this.drawConstellation();
    this.drawSparkles();
    this.drawHearts();
    this.drawZzz();
    this.drawSteam();
    this.drawQuestion();
    this.drawExclaim();
    this.drawDots();
    this.separate();
    this.drawBrows();
  }

  drawVector12() {
    // The original 12×12 sprite is deliberately spare: two eyes and a mouth.
    // Keep it that way. The animation lives in the gaze, blink, and mouth.
    if (this.emotion === "laugh" && this.state !== "speaking") {
      this._eyeCells = [];
      this._mouthCells = [];
      this._collisionCells = [];
      this.drawOriginalLaugh();
      return;
    }
    this.drawEyes(12);
    this.drawOriginalMouth();
    this.separate();
  }

  drawMoss() {
    // A small CRT terminal: square phosphor eyes, a dim bezel, a flat mouth,
    // and a single status LED. It shares the same pose parameters as the others.
    this.drawMossBezel();
    this.drawMossScanline();
    this.drawMossLed();
    this.drawMossEyes();
    this.drawMossMouth();
    this.drawMossBlush();
    this.drawTears(14);
    this.drawSweat(14);
    this.drawHearts();
    this.drawZzz();
    this.drawSteam();
    this.drawQuestion();
    this.drawExclaim();
    this.drawDots();
    this.separate();
    this.drawMossBrows();
  }

  // -- MOSS: a small CRT terminal ---------------------------------------

  drawMossBezel() {
    const c = this.palette.inkSoft;
    this.px(1, 1, 12, 1, c, 0.2);
    this.px(1, 12, 12, 1, c, 0.2);
    this.px(1, 1, 1, 12, c, 0.2);
    this.px(12, 1, 1, 12, c, 0.2);
    // Corner notches keep it from reading as a plain rectangle.
    this.px(1, 1, 1, 1, c, 0.08);
    this.px(12, 1, 1, 1, c, 0.08);
    this.px(1, 12, 1, 1, c, 0.08);
    this.px(12, 12, 1, 1, c, 0.08);
  }

  drawMossScanline() {
    // A slow moving phosphor sweep. Skip it entirely under reduced motion: a
    // frozen bar across the face reads as a moustache, not a scanline.
    if (this.opts.reducedMotion) return;
    const y = 2 + Math.floor(((this.t * 1.4) % 9));
    this.px(3, y, 8, 1, this.palette.ink, 0.035);
  }

  drawMossLed() {
    const pulse = this.opts.reducedMotion ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * 2.4));
    this.px(7, 1, 1, 1, this.palette.inkSoft, 0.7);
    this.px(7, 0, 1, 1, this.palette.accent, 0.55 + 0.4 * pulse);
    if (this.opts.glow) this.px(6, 0, 3, 2, this.palette.accent, 0.06 * pulse);
  }

  drawMossEyes() {
    this._runShape("eye", () => this._drawMossEyesBody());
  }

  _drawMossEyesBody() {
    const p = this.params;
    const open = clamp(p.eyeOpen * (1 - this.blink), 0, 1.6);
    const lookX = Math.round(clamp(this.look.x, -1, 1));
    const lookY = Math.round(clamp(this.look.y, -1, 1));
    const shape = p.eyeShape;
    const ink = this.palette.ink;
    const pupil = this.palette.pupil;

    const drawOne = (x, y, side) => {
      if (shape === "heart") {
        this.smallHeart(x, y - 1, this.palette.blush, 0.95);
        return;
      }
      if (shape === "x") {
        for (let i = 0; i < 3; i++) {
          this.px(x + i, y + i, 1, 1, ink);
          this.px(x + i, y + 2 - i, 1, 1, ink);
        }
        return;
      }
      if (shape === "happy") {
        // A three-cell caret, not a wide band that could read as a brow.
        this.px(x, y + 1, 1, 1, ink, 0.95);
        this.px(x + 1, y, 1, 1, ink, 0.95);
        this.px(x + 2, y + 1, 1, 1, ink, 0.95);
        return;
      }
      if (shape === "wink" && side === "right") {
        this.px(x, y + 1, 3, 1, ink, 0.95);
        return;
      }
      if (shape === "half" || shape === "squint" || open < 0.32 || this.state === "sleeping") {
        this.px(x, y + 1, 3, 1, ink, 0.95);
        return;
      }
      // A 3×2 phosphor socket with a single pupil cell. It stays readable as a
      // terminal eye at this scale, while leaving room to look around.
      const h = open > 1.25 ? 3 : 2;
      const top = open > 1.25 ? y - 1 : y;
      this.px(x, top, 3, h, ink, 0.96);
      const lookShift = lookX > 0 ? 1 : lookX < 0 ? -1 : 0;
      const pupilX = clamp(x + 1 + lookShift, x, x + 2);
      const pupilY = clamp(top + (h > 2 ? 1 : 0) + (lookY > 0 ? 1 : 0), top, top + h - 1);
      this.px(pupilX, pupilY, 1, 1, pupil, 0.96);
    };

    drawOne(3, 4, "left");
    drawOne(8, 4, "right");
  }

  drawMossBrows() {
    const p = this.params;
    const lift = p.brow * 0.6;
    const inner = p.browInner * 0.6;
    const draw = (x0, x1, side, bias = 0) => {
      const innerX = side === "left" ? x1 : x0;
      const outerX = side === "left" ? x0 : x1;
      for (let i = 0; i <= 2; i++) {
        const f = i / 2;
        const x = Math.round(outerX + (innerX - outerX) * f);
        const y = Math.max(2, Math.min(3, Math.round(3 - lift - inner * f + bias)));
        this.px(x, y, 1, 1, this.palette.ink, 0.58);
      }
    };
    draw(3, 5, "left", 0);
    draw(9, 11, "right", -0.55);
  }

  drawMossMouth() {
    this._runShape("mouth", () => this._drawMossMouthBody());
  }

  _drawMossMouthBody() {
    const p = this.params;
    const cx = 7;
    const cy = 9;
    const half = clamp(Math.round(2 + (p.mouthWidth - 1) * 2), 2, 4);
    const open = clamp(p.mouthOpen, 0, 1);
    const color = this.palette.mouth;

    if (open > 0.15) {
      const h = 1 + Math.round(open * 2);
      this.px(cx - half, cy, half * 2, h, color, 0.9);
      this.px(cx - half + 1, cy + 1, Math.max(1, half * 2 - 2), Math.max(1, h - 1), this.palette.pupil, 0.85);
      return;
    }

    // A dead zone keeps neutral and thinking flat; happy lifts the corners by
    // one cell and sad/angry turn the line into a shallow frown.
    const raw = p.mouth;
    const curve = Math.abs(raw) < 0.45 ? 0 : (raw - Math.sign(raw) * 0.45) * 1.4;
    for (let x = cx - half; x <= cx + half; x++) {
      const f = 1 - Math.pow((x - cx) / half, 2);
      this.px(x, Math.round(cy + curve * f), 1, 1, color, 0.92);
    }
  }

  drawMossBlush() {
    const p = this.params;
    if (p.blush < 0.15) return;
    const a = p.blush;
    this.px(2, 8, 1, 1, this.palette.blush, 0.26 * a);
    this.px(11, 8, 1, 1, this.palette.blush, 0.26 * a);
  }

  drawConstellation() {
    const spots = [[2, 3, 0], [13, 4, 1.6], [2, 12, 3.1], [12, 2, 4.4], [7, 1, 2.2], [14, 8, 5.2]];
    const base = this.opts.particles ? 0.55 : 0.32;
    for (const [x, y, phase] of spots) {
      const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(this.t * 2.2 + phase));
      this.px(x, y, 1, 1, this.palette.sparkle, base * pulse);
    }
  }

  drawOriginalLaugh() {
    // The exact Laugh.png frame: asymmetric eyes and a wavy mouth.
    const c = this.palette.ink;
    this.px(4, 4, 1, 1, c, 0.97);
    this.px(7, 5, 1, 1, c, 0.97);
    this.px(2, 6, 1, 1, c, 0.95);
    this.px(2, 7, 4, 1, c, 0.95);
    this.px(8, 7, 1, 1, c, 0.95);
    this.px(5, 8, 4, 1, c, 0.95);
  }

  drawOriginalMouth() {
    this._runShape("mouth", () => this._drawOriginalMouthBody());
  }

  _drawOriginalMouthBody() {
    const p = this.params;
    const e = this.emotion;
    const open = clamp(p.mouthOpen, 0, 1);
    const speaking = this.state === "speaking";
    const color = this.palette.mouth;
    const dark = this.palette.pupil;
    const line = (x1, x2, y, alpha = 0.95) => {
      for (let x = x1; x <= x2; x++) this.px(x, y, 1, 1, color, alpha);
    };

    // A murmuring mouth while the reply streams, even on a neutral face.
    if (speaking && open < 0.2) {
      const h = 1 + Math.round(Math.abs(Math.sin(this.t * 13)) * 1.6);
      this.px(5, 7, 2, h, color, 0.95);
      if (h > 1) this.px(5, 7, 1, h - 1, dark, 0.9);
      return;
    }

    if (e === "laugh" || open > 0.5) {
      const w = e === "laugh" ? 4 : 3;
      const h = e === "laugh" ? 2 : 2;
      this.px(6 - Math.ceil(w / 2), 7, w, h, color, 0.95);
      this.px(7 - Math.ceil(w / 2), 7, Math.max(1, w - 2), Math.max(1, h - 1), dark, 0.9);
      return;
    }

    if (e === "surprised" || (open > 0.15 && ["scared", "embarrassed"].includes(e))) {
      this.px(5, 7, 2, 2, color, 0.95);
      this.px(5, 8, 1, 1, dark, 0.9);
      return;
    }

    if (["sad", "angry"].includes(e)) {
      line(3, 8, 7);
      this.px(2, 8, 1, 1, color, 0.95);
      this.px(9, 8, 1, 1, color, 0.95);
      return;
    }

    if (e === "embarrassed") {
      line(4, 7, 7);
      this.px(3, 8, 1, 1, color, 0.75);
      this.px(8, 6, 1, 1, color, 0.75);
      return;
    }

    if (["thinking", "curious", "confused", "processing"].includes(e)) {
      this.px(2, 6, 1, 1, color, 0.95);
      line(2, 7, 7);
      return;
    }

    if (["glitch"].includes(e)) {
      this.px(4, 7, 2, 1, color, 0.8);
      this.px(6, 8, 2, 1, color, 0.8);
      return;
    }

    if (["happy", "excited", "love", "proud", "wink", "listening"].includes(e)) {
      const half = e === "proud" || e === "wink" ? 3 : 4;
      const left = Math.round(5.5 - half);
      const right = Math.round(5.5 + half - 0.5);
      this.px(left, 6, 1, 1, color, 0.95);
      this.px(right, 6, 1, 1, color, 0.95);
      line(left, right, 7);
      if (p.smirk > 0.3) this.px(right, 5, 1, 1, color, 0.85);
      return;
    }

    // neutral, bored, sleepy: the original Neutral sprite has no mouth.
  }

  // -- primitive helpers -------------------------------------------------

  px(x, y, w = 1, h = 1, color = this.palette.ink, alpha = 1) {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    ctx.globalAlpha = 1;
    if (this._record) {
      const rx = Math.round(x);
      const ry = Math.round(y);
      const rw = Math.max(1, Math.round(w));
      const rh = Math.max(1, Math.round(h));
      const cells = this._record === "eye" ? this._eyeCells : this._mouthCells;
      for (let cy = ry; cy < ry + rh; cy++) {
        for (let cx = rx; cx < rx + rw; cx++) cells.push([cx, cy]);
      }
    }
  }

  // -- smart separation --------------------------------------------------

  separate() {
    const offending = this._collisions(this._eyeCells, this._mouthCells);
    this._collisionCells = offending;
    if (!offending.length) return;
    const mode = this.separation;
    if (mode === "off") return;
    if (mode === "inset") {
      this._insetEdges(offending);
      return;
    }
    if (mode === "trim") {
      this._clearCells(offending);
    } else {
      this._clearCells(this._haloCells(this._eyeCells));
    }
    this._redrawEyes();
  }

  _collisions(eyes, mouth) {
    const offending = [];
    if (!eyes.length || !mouth.length) return offending;
    const eyeSet = new Set(eyes.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of mouth) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (eyeSet.has(`${x + dx},${y + dy}`)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) offending.push([x, y]);
    }
    return offending;
  }

  _runShape(record, draw) {
    const cells = record === "eye" ? this._eyeCells : this._mouthCells;
    cells.length = 0;
    this._record = record;
    try {
      draw();
    } finally {
      this._record = null;
    }
  }

  _seamPixels() {
    const backing = this.canvas.width || 1;
    const css = this.canvas.clientWidth || backing;
    const scale = css / backing;
    // Roughly two CSS pixels, snapped to whole backing pixels.
    return clamp(Math.round(2 / Math.max(scale, 0.2)), 1, 6);
  }

  _insetEdges(offending) {
    const eyes = this._eyeCells;
    if (!eyes.length) return;
    const eyeSet = new Set(eyes.map(([x, y]) => `${x},${y}`));
    const band = this._seamPixels();
    const overlaps = [];

    for (const [mx, my] of offending) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) {
            // A mouth pixel drawn in the same cell as an eye pixel is a true
            // overlap. Remove that mouth pixel and let the eye keep the cell.
            overlaps.push([mx, my]);
            continue;
          }
          const ex = mx + dx;
          const ey = my + dy;
          if (!eyeSet.has(`${ex},${ey}`)) continue;
          // Only the mouth yields. The eyes are the most important pixels on
          // the face, so never shave them; pull the facing mouth edge back.
          if (dx === 0) {
            this._clearBand(mx, my, dy > 0 ? "bottom" : "top", band);
          } else if (dy === 0) {
            this._clearBand(mx, my, dx > 0 ? "right" : "left", band);
          } else {
            this._clearCorner(mx, my, dx, dy, band);
          }
        }
      }
    }

    if (overlaps.length) {
      // Clear the eye cells first so the redraw does not stack alpha on top of
      // the existing eye pixels; then let the eye keep the contested cell.
      this._clearCells(this._eyeCells);
      this._redrawEyes();
    }
  }

  _clearCorner(x, y, towardX, towardY, px) {
    const t = px / this.cell;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000000";
    const x0 = towardX > 0 ? x + 1 - t : x;
    const y0 = towardY > 0 ? y + 1 - t : y;
    ctx.fillRect(x0, y0, t, t);
    ctx.restore();
  }

  _clearBand(x, y, side, px) {
    const t = px / this.cell;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000000";
    if (side === "top") ctx.fillRect(x, y, 1, t);
    else if (side === "bottom") ctx.fillRect(x, y + 1 - t, 1, t);
    else if (side === "left") ctx.fillRect(x, y, t, 1);
    else ctx.fillRect(x + 1 - t, y, t, 1);
    ctx.restore();
  }

  _haloCells(cells) {
    const out = new Map();
    for (const [x, y] of cells) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = `${x + dx},${y + dy}`;
          out.set(key, [x + dx, y + dy]);
        }
      }
    }
    return [...out.values()];
  }

  _clearCells(cells) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000000";
    for (const [x, y] of cells) ctx.fillRect(x, y, 1, 1);
    ctx.restore();
  }

  _redrawEyes() {
    this._record = null;
    if (this.skin === "moss14") this._drawMossEyesBody();
    else this._drawEyesBody(this.grid);
  }

  drawCollisionOverlay() {
    const ctx = this.ctx;
    for (const [x, y] of this._eyeCells) {
      this.px(x, y, 1, 1, this.palette.accent, 0.2);
    }
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#ff4d6d";
    for (const [x, y] of this._collisionCells) ctx.fillRect(x, y, 1, 1);
    ctx.restore();
  }

  // -- parts -------------------------------------------------------------

  drawAntenna() {
    if (!this.opts.antenna) return;
    const x = this.grid / 2;
    const sway = this.opts.reducedMotion ? 0 : Math.round(Math.sin(this.t * 2.0) * 0.6);
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.t * 2.6));
    this.px(x + sway, 2, 1, 1, this.palette.inkSoft, 0.9);
    if (this.opts.glow) {
      this.px(x - 1 + sway, 0, 3, 3, this.palette.accent, 0.08 * pulse);
    }
    this.px(x + sway, 1, 1, 1, this.palette.accent, 0.8 + 0.2 * pulse);
    this.px(x + sway, 1, 1, 1, "#ffffff", 0.35 * pulse);
  }

  drawEyes(grid) {
    this._runShape("eye", () => this._drawEyesBody(grid));
  }

  _drawEyesBody(grid) {
    const p = this.params;
    const open = clamp(p.eyeOpen * (1 - this.blink), 0, 1.6);
    const lookX = Math.round(clamp(this.look.x, -1, 1));
    const lookY = Math.round(clamp(this.look.y, -1, 1));
    const original = grid === 12;

    if (original) {
      // The drawn 12×12 sprite only ever had two vertical eye pixels. Keep that
      // silhouette; animation comes from gaze, blink, and the mouth.
      const drawSimple = (x, y, side) => {
        if (p.eyeShape === "wink" && side === "right") {
          this.px(x, y + 1, 1, 1, this.palette.ink, 0.95);
          return;
        }
        if (
          p.eyeShape === "half" ||
          p.eyeShape === "squint" ||
          open < 0.32 ||
          this.state === "sleeping"
        ) {
          this.px(x, y + 1, 1, 1, this.palette.ink, 0.95);
          return;
        }
        this.px(x + lookX, y, 1, 2, this.palette.ink, 0.97);
      };
      drawSimple(4, 4, "left");
      drawSimple(7, 4, "right");
      return;
    }

    const drawOne = (x, y, side) => {
      const shape = p.eyeShape;
      if (shape === "heart") {
        this.smallHeart(x - 1, y - 1, this.palette.blush, 0.95);
        return;
      }
      if (shape === "x") {
        for (let i = -1; i <= 1; i++) {
          this.px(x + i, y + i, 1, 1, this.palette.ink);
          this.px(x + i, y - i, 1, 1, this.palette.ink);
        }
        return;
      }
      if (shape === "happy") {
        // A small upward arc, not a shared monobrow: two pixels of lid and one
        // raised outer corner.
        this.px(x, y + 1, 2, 1, this.palette.ink);
        this.px(x + (side === "left" ? -1 : 2), y, 1, 1, this.palette.ink, 0.9);
        return;
      }
      if (shape === "wink" && side === "right") {
        this.px(x - 1, y + 1, 3, 1, this.palette.ink, 0.95);
        return;
      }
      if (shape === "half" || open < 0.32) {
        this.px(x, y + 1, original ? 1 : 2, 1, this.palette.ink, 0.95);
        return;
      }
      if (shape === "squint") {
        this.px(x, y + 1, original ? 1 : 2, 1, this.palette.ink, 0.95);
        this.px(x + (side === "left" ? 1 : -1), y, 1, 1, this.palette.ink, 0.8);
        return;
      }
      if (original) {
        const h = open > 1.2 ? 3 : 2;
        const top = y + (2 - h);
        this.px(x + lookX, top, 1, h, this.palette.ink);
        return;
      }
      const h = Math.round(clamp(open, 0.35, 1.5) * 3);
      const top = y + Math.max(0, 3 - h);
      this.px(x, top, 2, h, this.palette.ink, 0.97);
      const pupilW = 1;
      const pupilH = Math.max(1, Math.min(h - 1, 2 + Math.round(p.pupil) - 1));
      const px = x + (lookX > 0 ? 1 : 0);
      const py = top + Math.max(0, Math.min(h - pupilH, Math.round(h / 2) - 1 + lookY));
      this.px(px, py, pupilW, pupilH, this.palette.pupil, 0.95);
      this.px(x + 1, top, 1, 1, "#ffffff", 0.5);
    };

    if (original) {
      drawOne(4, 4, "left");
      drawOne(7, 4, "right");
    } else {
      drawOne(5, 5, "left");
      drawOne(9, 5, "right");
    }
  }

  drawBrows() {
    const p = this.params;
    if (Math.abs(p.brow) < 0.12 && Math.abs(p.browInner) < 0.12) return;
    const lift = p.brow * 0.8;
    const inner = p.browInner * 0.8;
    const draw = (x0, x1, side) => {
      const innerX = side === "left" ? x1 : x0;
      const outerX = side === "left" ? x0 : x1;
      for (let i = 0; i <= 3; i++) {
        const f = i / 3;
        const x = Math.round(outerX + (innerX - outerX) * f);
        const y = Math.max(2, Math.min(3, Math.round(3 - lift - inner * f)));
        this.px(x, y, 1, 1, this.palette.ink, 0.58);
      }
    };
    draw(4, 6, "left");
    draw(9, 11, "right");
  }

  drawMouth(grid) {
    this._runShape("mouth", () => this._drawMouthBody(grid));
  }

  _drawMouthBody(grid) {
    const p = this.params;
    const original = grid === 12;
    const cx = grid / 2;
    const cy = original ? 7 : 11;
    const maxHalf = original ? 3 : 4;
    let half = Math.round((original ? 2 : 2) + (p.mouthWidth - 1) * (original ? 2 : 2.5));
    half = clamp(half, 2, maxHalf);
    if (p.mouth > 0.6) half = Math.max(half, original ? 3 : 3);
    if (p.mouth < -0.55) half = Math.max(half, 3);
    const left = Math.round(cx - half);
    const right = Math.round(cx + half);
    const open = clamp(p.mouthOpen, 0, 1);
    const color = this.palette.mouth;

    if (p.cat > 0.5) {
      this.px(cx - 3, cy, 2, 1, color, 0.9);
      this.px(cx + 1, cy, 2, 1, color, 0.9);
      this.px(cx - 2, cy - 1, 1, 1, color, 0.7);
      this.px(cx + 2, cy - 1, 1, 1, color, 0.7);
      return;
    }

    if (open > 0.15) {
      const h = 1 + Math.round(open * (original ? 2 : 3));
      this.px(left + 1, cy - 1, right - left - 1, h + 1, color, 0.92);
      this.px(left + 2, cy, right - left - 3, Math.max(1, h - 1), this.palette.pupil, 0.95);
      this.px(cx - 1, cy + h - 2, 2, 1, this.palette.blush, 0.8);
      return;
    }

    const curve = p.mouth * (original ? 1.8 : 1.35);
    const wave = p.mouthWave * Math.sin(this.t * 6.5) * 0.5;
    for (let x = left; x <= right; x++) {
      const f = 1 - Math.pow((x - cx) / Math.max(1, half), 2);
      let y = cy + curve * f + wave * Math.sin(x * 1.5 + this.t * 5);
      if (p.smirk > 0.2 && x > cx) y -= p.smirk;
      this.px(x, Math.round(y), 1, 1, color, 0.94);
    }
    if (p.mouth > 0.35) {
      this.px(left - 1, cy - 1, 1, 1, color, 0.55);
      this.px(right + 1, cy - 1, 1, 1, color, 0.55);
    }
  }

  drawBlush(grid) {
    const p = this.params;
    if (p.blush < 0.05) return;
    const a = p.blush;
    if (grid === 12) {
      const cheek = (x, y) => {
        this.px(x, y, 2, 1, this.palette.blush, 0.45 * a);
        this.px(x + 1, y + 1, 1, 1, this.palette.blush, 0.35 * a);
      };
      cheek(2, 6);
      cheek(8, 6);
      return;
    }
    const cheek = (x, y) => {
      this.px(x, y, 2, 1, this.palette.blush, 0.22 * a);
      this.px(x + 1, y + 1, 1, 1, this.palette.blush, 0.3 * a);
    };
    cheek(2, 8);
    cheek(grid >= 16 ? 12 : 10, 8);
  }

  drawTears(grid) {
    const p = this.params;
    if (p.tear < 0.08) return;
    const a = clamp(p.tear, 0, 1);
    const xs = grid === 12 ? [4, 7] : [5, 9];
    const y0 = grid === 12 ? 6 : 8;
    for (let i = 0; i < xs.length; i++) {
      const phase = (this.t * 0.7 + i * 0.5) % 1;
      const y = y0 + phase * 3;
      this.px(xs[i], y, 1, 2, this.palette.tear, 0.6 * a);
      this.px(xs[i] + 1, y + 1, 1, 1, this.palette.tear, 0.35 * a);
    }
    this.px(xs[0], y0 - 1, 2, 1, this.palette.tear, 0.28 * a);
    this.px(xs[1], y0 - 1, 2, 1, this.palette.tear, 0.28 * a);
  }

  drawSweat(grid) {
    const p = this.params;
    if (p.sweat < 0.08) return;
    const a = clamp(p.sweat, 0, 1);
    const x = grid === 12 ? 10 : grid - 3;
    const y = 4 + Math.sin(this.t * 3) * 0.5;
    this.px(x, y, 1, 2, this.palette.tear, 0.75 * a);
    this.px(x + 1, y + 1, 1, 1, this.palette.tear, 0.45 * a);
  }

  drawSparkles() {
    const p = this.params;
    if (p.sparkle < 0.08 || !this.opts.particles) return;
    const a = clamp(p.sparkle, 0, 1);
    const spots = [[2, 3, 0], [13, 5, 1.7], [2, 11, 3.1], [14, 10, 4.4], [4, 1, 2.2]];
    for (const [x, y, phase] of spots) {
      const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(this.t * 3 + phase));
      this.px(x, y, 1, 1, this.palette.sparkle, a * pulse);
      this.px(x - 1, y, 1, 1, this.palette.sparkle, a * pulse * 0.55);
      this.px(x + 1, y, 1, 1, this.palette.sparkle, a * pulse * 0.55);
      this.px(x, y - 1, 1, 1, this.palette.sparkle, a * pulse * 0.55);
      this.px(x, y + 1, 1, 1, this.palette.sparkle, a * pulse * 0.55);
    }
  }

  drawHearts() {
    const p = this.params;
    if (p.hearts < 0.08 || !this.opts.particles) return;
    const a = clamp(p.hearts, 0, 1);
    for (let i = 0; i < 3; i++) {
      const phase = (this.t * 0.42 + i * 0.33) % 1;
      const x = 2 + i * 5 + Math.sin(this.t * 1.3 + i) * 1.2;
      const y = this.grid - 1 - phase * (this.grid - 3);
      const alpha = a * Math.sin(phase * Math.PI);
      if (alpha <= 0.03) continue;
      this.pixelHeart(Math.round(x), Math.round(y), 2, this.palette.blush, alpha);
    }
  }

  drawZzz() {
    const p = this.params;
    if (p.zzz < 0.08) return;
    const a = clamp(p.zzz, 0, 1);
    const baseX = this.grid - 3;
    const baseY = 3;
    const drawZ = (x, y, s, alpha) => {
      this.px(x, y, s, 1, this.palette.ink, alpha);
      this.px(x + s - 1, y + 1, 1, 1, this.palette.ink, alpha);
      this.px(x + 1, y + Math.max(1, s - 2), 1, 1, this.palette.ink, alpha);
      this.px(x, y + s - 1, s, 1, this.palette.ink, alpha);
    };
    for (let i = 0; i < 3; i++) {
      const phase = (this.t * 0.38 + i * 0.33) % 1;
      const alpha = a * Math.sin(phase * Math.PI) * 0.9;
      if (alpha <= 0.03) continue;
      drawZ(Math.round(baseX + i * 1.5 - phase * 2), Math.round(baseY - phase * 8 + i * 2), 2 + i, alpha);
    }
  }

  drawSteam() {
    const p = this.params;
    if (p.steam < 0.08 || !this.opts.particles) return;
    const a = clamp(p.steam, 0, 1);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const phase = (this.t * 0.5 + i * 0.5) % 1;
      const x = this.grid / 2 + side * (4 + phase * 3);
      const y = 2 - phase * 5;
      const alpha = a * Math.sin(phase * Math.PI) * 0.5;
      this.px(x, y, 2, 2, "#cfd8d3", alpha);
      this.px(x + side, y - 2, 1, 2, "#cfd8d3", alpha * 0.7);
    }
  }

  drawQuestion() {
    const p = this.params;
    if (p.question < 0.08) return;
    const a = clamp(p.question, 0, 1) * (0.65 + 0.35 * Math.sin(this.t * 4));
    const x = this.grid - 4;
    const y = 2;
    this.px(x, y, 3, 1, this.palette.accent2, a);
    this.px(x + 2, y + 1, 1, 1, this.palette.accent2, a);
    this.px(x + 1, y + 2, 1, 1, this.palette.accent2, a);
    this.px(x + 1, y + 4, 1, 1, this.palette.accent2, a);
  }

  drawExclaim() {
    const p = this.params;
    if (p.exclaim < 0.08) return;
    const a = clamp(p.exclaim, 0, 1);
    const x = this.grid - 3;
    const y = 2;
    this.px(x, y, 2, 3, this.palette.accent2, a);
    this.px(x, y + 5, 2, 2, this.palette.accent2, a);
  }

  drawDots() {
    const p = this.params;
    if (p.dots < 0.08) return;
    const a = clamp(p.dots, 0, 1);
    for (let i = 0; i < 3; i++) {
      const phase = (this.t * 1.2 + i * 0.2) % 1;
      const alpha = a * (0.25 + 0.75 * Math.max(0, Math.sin(phase * Math.PI)));
      this.px(this.grid - 5 + i * 2, 2 - Math.round(Math.sin(phase * Math.PI)), 1, 1, this.palette.ink, alpha);
    }
  }

  drawGlitch() {
    const p = this.params;
    const a = clamp(p.glitch, 0, 1);
    const colors = [this.palette.accent, this.palette.accent2, this.palette.blush, this.palette.tear];
    for (let i = 0; i < 5; i++) {
      const y = Math.floor(rand(2, this.grid - 2));
      const x = Math.floor(rand(1, this.grid - 4));
      const w = 2 + Math.floor(rand(0, 5));
      this.px(x, y, w, 1, pick(colors), 0.25 * a);
    }
    if (Math.random() < 0.3) {
      this.px(1, 3, this.grid - 2, 1, this.palette.accent, 0.16 * a);
      this.px(1, this.grid - 3, this.grid - 2, 1, this.palette.blush, 0.16 * a);
    }
  }

  drawParticles() {
    for (const p of this.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1) * 0.9;
      if (p.symbol === "heart") this.smallHeart(Math.round(p.x), Math.round(p.y), p.color, alpha);
      else if (p.symbol === "question") {
        this.px(p.x, p.y, 2, 1, p.color, alpha);
        this.px(p.x + 1, p.y + 1, 1, 1, p.color, alpha);
        this.px(p.x + 1, p.y + 3, 1, 1, p.color, alpha);
      } else if (p.symbol === "exclaim") {
        this.px(p.x, p.y, 1, 2, p.color, alpha);
        this.px(p.x, p.y + 3, 1, 1, p.color, alpha);
      } else if (p.symbol === "dot") {
        this.px(p.x, p.y, p.size, p.size, p.color, alpha);
      } else if (p.symbol === "tear") {
        this.px(p.x, p.y, 1, 2, this.palette.tear, alpha);
      } else {
        this.px(p.x, p.y, 1, 1, p.color, alpha);
        this.px(p.x - 1, p.y, 1, 1, p.color, alpha * 0.6);
        this.px(p.x + 1, p.y, 1, 1, p.color, alpha * 0.6);
        this.px(p.x, p.y - 1, 1, 1, p.color, alpha * 0.6);
        this.px(p.x, p.y + 1, 1, 1, p.color, alpha * 0.6);
      }
    }
  }

  smallHeart(x, y, color = this.palette.blush, alpha = 1) {
    const rows = ["#.#", "###", ".#."];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === "#") this.px(x + c, y + r, 1, 1, color, alpha);
      }
    }
  }

  pixelHeart(x, y, scale = 2, color = this.palette.blush, alpha = 1) {
    const rows = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === "#") this.px(x + c * scale / 2, y + r * scale / 2, scale / 2, scale / 2, color, alpha);
      }
    }
  }
}
