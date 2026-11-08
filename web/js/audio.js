/* Microphone capture -> 16 kHz mono float32 chunks. */

class Resampler {
  constructor(inputRate, outputRate = 16000) {
    this.step = inputRate / outputRate;
    this.buf = [];
    this.pos = 0;
    this.out = new Float32Array(320);
    this.outLen = 0;
  }

  push(channel, emit) {
    for (let i = 0; i < channel.length; i++) this.buf.push(channel[i]);
    while (this.pos + 1 < this.buf.length) {
      const i0 = Math.floor(this.pos);
      const frac = this.pos - i0;
      const value = this.buf[i0] * (1 - frac) + this.buf[i0 + 1] * frac;
      this.out[this.outLen++] = value;
      this.pos += this.step;
      if (this.outLen === this.out.length) {
        emit(this.out.slice());
        this.outLen = 0;
      }
    }
    const drop = Math.floor(this.pos);
    if (drop > 8192) {
      this.buf.splice(0, drop);
      this.pos -= drop;
    }
  }
}

export class AudioEngine {
  constructor({ onChunk, onLevel, onState, onError } = {}) {
    this.onChunk = onChunk || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.active = false;
    this.starting = false;
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.processor = null;
    this.sink = null;
    this.level = 0;
    this._raf = 0;
    this.deviceId = null;
  }

  async listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((device) => device.kind === "audioinput")
        .map((device) => ({
          id: device.deviceId,
          label: device.label || "Microphone",
          group: device.groupId,
        }));
    } catch (error) {
      return [];
    }
  }

  async start() {
    if (this.active || this.starting) return true;
    this.starting = true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("getUserMedia is not supported");
      }
      const constraints = {
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      };
      if (this.deviceId) constraints.audio.deviceId = { exact: this.deviceId };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = stream;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      this.source = ctx.createMediaStreamSource(stream);
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.sink.connect(ctx.destination);

      let usedWorklet = false;
      if (ctx.audioWorklet) {
        try {
          await ctx.audioWorklet.addModule("js/pcm-worklet.js");
          this.node = new AudioWorkletNode(ctx, "vector-pcm", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
            channelCountMode: "explicit",
          });
          this.node.port.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              this._emit(new Float32Array(event.data));
            }
          };
          this.source.connect(this.node);
          this.node.connect(this.sink);
          usedWorklet = true;
        } catch (error) {
          usedWorklet = false;
        }
      }

      if (!usedWorklet) {
        const resampler = new Resampler(ctx.sampleRate, 16000);
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        this.processor = processor;
        processor.onaudioprocess = (event) => {
          const channel = event.inputBuffer.getChannelData(0);
          resampler.push(channel, (chunk) => this._emit(chunk));
        };
        this.source.connect(processor);
        processor.connect(this.sink);
      }

      this.active = true;
      this.starting = false;
      this.onState(true);
      this._startLevelLoop();
      return true;
    } catch (error) {
      this.starting = false;
      this.active = false;
      await this.stop(true);
      this.onError(error);
      return false;
    }
  }

  _emit(chunk) {
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / Math.max(1, chunk.length));
    const level = Math.min(1, Math.sqrt(rms) * 4.2);
    this.level = this.level * 0.72 + level * 0.28;
    this.onChunk(chunk);
  }

  _startLevelLoop() {
    const tick = () => {
      if (!this.active) return;
      this.onLevel(this.level);
      this._raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(tick);
  }

  async stop(silent = false) {
    this.active = false;
    cancelAnimationFrame(this._raf);
    try { this.node?.port?.postMessage("stop"); } catch (error) { /* noop */ }
    try { this.node?.disconnect(); } catch (error) { /* noop */ }
    try { this.processor?.disconnect(); } catch (error) { /* noop */ }
    try { this.source?.disconnect(); } catch (error) { /* noop */ }
    try { this.sink?.disconnect(); } catch (error) { /* noop */ }
    try { this.stream?.getTracks().forEach((track) => track.stop()); } catch (error) { /* noop */ }
    try { if (this.ctx && this.ctx.state !== "closed") await this.ctx.close(); } catch (error) { /* noop */ }
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.processor = null;
    this.sink = null;
    this.level = 0;
    this.onLevel(0);
    if (!silent) this.onState(false);
  }
}
