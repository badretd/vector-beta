/* AudioWorklet: resample microphone input to 16 kHz mono float32 and batch 20 ms. */
class VectorPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.input = [];
    this.pos = 0;
    this.out = new Float32Array(320);
    this.outLen = 0;
    this.alive = true;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.alive = false;
    };
  }

  process(inputs) {
    if (!this.alive) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel || !channel.length) return true;

    for (let i = 0; i < channel.length; i++) this.input.push(channel[i]);

    // Linear interpolation from the device rate to 16 kHz.
    while (this.pos + 1 < this.input.length) {
      const i0 = Math.floor(this.pos);
      const frac = this.pos - i0;
      const value = this.input[i0] * (1 - frac) + this.input[i0 + 1] * frac;
      this.out[this.outLen++] = value;
      this.pos += this.step;
      if (this.outLen === this.out.length) {
        const copy = this.out.slice();
        this.port.postMessage(copy.buffer, [copy.buffer]);
        this.outLen = 0;
      }
    }

    const drop = Math.floor(this.pos);
    if (drop > 4096) {
      this.input.splice(0, drop);
      this.pos -= drop;
    }
    return true;
  }
}

registerProcessor("vector-pcm", VectorPCMProcessor);
