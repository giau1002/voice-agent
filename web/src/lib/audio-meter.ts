/** Reads the received remote track. Never loops microphone PCM into avatar output. */
export class AudioMeter {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Float32Array<ArrayBuffer> | null = null;
  private smoothed = 0;

  async unlock() {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  attach(track: MediaStreamTrack) {
    this.detach();
    if (!this.context) return;
    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    // The SDK's <audio> plays sound; this analysis branch has no output connection.
    this.data = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
  }

  sample(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getFloatTimeDomainData(this.data);
    let sum = 0;
    for (const value of this.data) sum += value * value;
    const level = Math.min(1, Math.max(0, (Math.sqrt(sum / this.data.length) - .003) * 5));
    this.smoothed += (level - this.smoothed) * (level > this.smoothed ? .55 : .32);
    return this.smoothed;
  }

  detach() { this.source?.disconnect(); this.source = null; this.analyser = null; this.data = null; this.smoothed = 0; }
  close() { this.detach(); const context = this.context; this.context = null; void context?.close().catch(() => {}); }
}
