"use client";

import { useCallback, useRef } from "react";
import {
  buildRealtimeAudioInput,
  downsampleToPcm16,
} from "@/features/mona-vnext/live/liveProtocol";

type AudioInputRuntime = {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  monitorGain: GainNode;
};

type StartOptions = {
  socket: WebSocket;
  onFrameSent?: () => void;
  onAudioStats?: (stats: {
    inputSampleRate: number;
    rms: number;
    peak: number;
  }) => void;
  onPermission?: (state: "granted" | "denied" | "prompt" | "stopped") => void;
};

function getAudioContextCtor() {
  return window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export function useLiveAudioInput() {
  const runtimeRef = useRef<AudioInputRuntime | null>(null);
  const frameCountRef = useRef(0);

  const stop = useCallback((onPermission?: StartOptions["onPermission"]) => {
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    if (!runtime) return;

    try {
      runtime.processor.disconnect();
      runtime.source.disconnect();
      runtime.monitorGain.disconnect();
    } catch {
      // Runtime may already be partially torn down.
    }
    runtime.stream.getTracks().forEach((track) => track.stop());
    void runtime.context.close().catch(() => undefined);
    onPermission?.("stopped");
  }, []);

  const start = useCallback(async ({ socket, onFrameSent, onAudioStats, onPermission }: StartOptions) => {
    stop(onPermission);
    frameCountRef.current = 0;

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    onPermission?.("granted");

    const context = new AudioContextCtor();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const monitorGain = context.createGain();
    monitorGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = downsampleToPcm16(input, context.sampleRate);
      if (pcm.length === 0) return;
      socket.send(JSON.stringify(buildRealtimeAudioInput(pcm)));
      onFrameSent?.();
      frameCountRef.current += 1;
      if (frameCountRef.current === 1 || frameCountRef.current % 50 === 0) {
        let sumSquares = 0;
        let peak = 0;
        for (let i = 0; i < input.length; i += 1) {
          const sample = Math.abs(input[i]);
          sumSquares += sample * sample;
          if (sample > peak) peak = sample;
        }
        onAudioStats?.({
          inputSampleRate: context.sampleRate,
          rms: Math.sqrt(sumSquares / input.length),
          peak,
        });
      }
    };

    source.connect(processor);
    processor.connect(monitorGain);
    monitorGain.connect(context.destination);
    runtimeRef.current = { context, stream, source, processor, monitorGain };
  }, [stop]);

  return { start, stop };
}
