class MonaPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.targetSampleRate = Number(processorOptions.targetSampleRate) || 16000;
    this.chunkSamples = Number(processorOptions.chunkSamples) || 320;
    this.sampleRatio = sampleRate / this.targetSampleRate;
    this.samplesUntilOutput = this.sampleRatio;
    this.bucketSum = 0;
    this.bucketCount = 0;
    this.pcmChunk = [];
    this.statsSumSquares = 0;
    this.statsPeak = 0;
    this.statsFrames = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data?.type === "stop") this.stopped = true;
    };
  }

  emitPcmChunk() {
    if (this.pcmChunk.length < this.chunkSamples) return;
    const pcm = new Int16Array(this.pcmChunk.splice(0, this.chunkSamples));
    this.port.postMessage({ type: "pcm", buffer: pcm.buffer }, [pcm.buffer]);
  }

  emitStatsIfReady() {
    if (this.statsFrames < sampleRate / 2) return;
    this.port.postMessage({
      type: "stats",
      inputSampleRate: sampleRate,
      rms: Math.sqrt(this.statsSumSquares / this.statsFrames),
      peak: this.statsPeak,
    });
    this.statsSumSquares = 0;
    this.statsPeak = 0;
    this.statsFrames = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;

    for (let index = 0; index < channel.length; index += 1) {
      const rawSample = Number.isFinite(channel[index]) ? channel[index] : 0;
      const sample = Math.max(-1, Math.min(1, rawSample));
      const absolute = Math.abs(sample);
      this.statsSumSquares += sample * sample;
      this.statsPeak = Math.max(this.statsPeak, absolute);
      this.statsFrames += 1;

      this.bucketSum += sample;
      this.bucketCount += 1;
      this.samplesUntilOutput -= 1;
      if (this.samplesUntilOutput > 0) continue;

      const average = this.bucketCount ? this.bucketSum / this.bucketCount : 0;
      this.pcmChunk.push(average < 0 ? average * 0x8000 : average * 0x7fff);
      this.bucketSum = 0;
      this.bucketCount = 0;
      this.samplesUntilOutput += this.sampleRatio;
      this.emitPcmChunk();
    }

    this.emitStatsIfReady();
    return true;
  }
}

registerProcessor("mona-pcm-capture", MonaPcmCaptureProcessor);
