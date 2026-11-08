/* Tiny synthesized UI sounds. No speech, no samples, no network. */

class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.045;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
  }

  tone(freq, dur, type = "sine", when = 0, gain = 1, slide = 0) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    const start = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const envelope = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), start + dur);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(0.8 * gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(envelope);
    envelope.connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  play(name) {
    if (!this.enabled) return;
    switch (name) {
      case "micOn":
        this.tone(440, 0.09, "sine", 0, 0.6);
        this.tone(660, 0.12, "sine", 0.08, 0.45);
        break;
      case "micOff":
        this.tone(520, 0.09, "sine", 0, 0.5, -140);
        break;
      case "send":
        this.tone(620, 0.06, "triangle", 0, 0.4);
        this.tone(880, 0.08, "triangle", 0.05, 0.3);
        break;
      case "receive":
        this.tone(760, 0.07, "sine", 0, 0.25);
        this.tone(980, 0.1, "sine", 0.06, 0.2);
        break;
      case "emotion":
        this.tone(880, 0.07, "sine", 0, 0.18);
        this.tone(1174, 0.12, "sine", 0.06, 0.14);
        break;
      case "error":
        this.tone(180, 0.16, "sawtooth", 0, 0.22, -60);
        this.tone(140, 0.18, "square", 0.1, 0.1);
        break;
      case "poke":
        this.tone(700, 0.05, "square", 0, 0.18);
        this.tone(1040, 0.09, "square", 0.04, 0.12);
        break;
      case "toggle":
        this.tone(340, 0.05, "sine", 0, 0.25);
        break;
      case "wake":
        this.tone(392, 0.12, "sine", 0, 0.2);
        this.tone(523, 0.14, "sine", 0.1, 0.18);
        this.tone(659, 0.2, "sine", 0.2, 0.15);
        break;
      default:
        break;
    }
  }
}

export const sound = new Sound();
