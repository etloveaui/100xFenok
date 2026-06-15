"use client";

import { useCallback, useRef } from "react";
import { base64ToPcmFloat32, getPcmSampleRate } from "@/features/mona-vnext/live/liveProtocol";

type AudioOutputRuntime = {
  context: AudioContext;
  gain: GainNode;
};

function getAudioContextCtor() {
  return window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export function useLiveAudioOutput() {
  const outputRef = useRef<AudioOutputRuntime | null>(null);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playbackCursorRef = useRef(0);

  const ensure = useCallback(async () => {
    const existing = outputRef.current;
    if (existing && existing.context.state !== "closed") {
      await existing.context.resume().catch(() => undefined);
      return existing;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    }

    const context = new AudioContextCtor();
    const gain = context.createGain();
    gain.gain.value = 1.12;
    gain.connect(context.destination);
    outputRef.current = { context, gain };
    await context.resume();

    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start();

    return outputRef.current;
  }, []);

  const flush = useCallback(() => {
    const output = outputRef.current;
    const sources = [...scheduledSourcesRef.current];
    scheduledSourcesRef.current = [];
    sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      try {
        source.disconnect();
      } catch {
        // Ignore disconnect races during interrupt/reset.
      }
    });
    playbackCursorRef.current = output && output.context.state !== "closed"
      ? output.context.currentTime
      : 0;
  }, []);

  const play = useCallback((data: string, mimeType?: string) => {
    const output = outputRef.current;
    if (!output || output.context.state === "closed") return false;

    try {
      void output.context.resume().catch(() => undefined);
      const pcm = base64ToPcmFloat32(data);
      if (pcm.length === 0) return false;

      const sampleRate = getPcmSampleRate(mimeType);
      const buffer = output.context.createBuffer(1, pcm.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i += 1) {
        channel[i] = Math.max(-1, Math.min(1, pcm[i]));
      }

      const source = output.context.createBufferSource();
      source.buffer = buffer;
      source.connect(output.gain);
      const isQueueAhead = playbackCursorRef.current > output.context.currentTime;
      const leadTimeSec = isQueueAhead ? 0.02 : 0.12;
      const startAt = Math.max(output.context.currentTime + leadTimeSec, playbackCursorRef.current || 0);
      source.start(startAt);
      scheduledSourcesRef.current.push(source);
      source.onended = () => {
        scheduledSourcesRef.current = scheduledSourcesRef.current.filter((item) => item !== source);
        try {
          source.disconnect();
        } catch {
          // Already disconnected by a flush.
        }
      };
      playbackCursorRef.current = startAt + buffer.duration;
      return true;
    } catch {
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    flush();
    const output = outputRef.current;
    outputRef.current = null;
    playbackCursorRef.current = 0;
    if (!output) return;
    try {
      output.gain.disconnect();
    } catch {
      // Already disconnected.
    }
    void output.context.close().catch(() => undefined);
  }, [flush]);

  return { ensure, play, flush, stop };
}
