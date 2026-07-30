"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  buildRealtimeAudioInput,
  downsampleToPcm16,
  MONA_VNEXT_INPUT_SAMPLE_RATE,
} from "@/features/mona-vnext/live/liveProtocol";

type CaptureNode = AudioWorkletNode | ScriptProcessorNode;

type AudioInputRuntime = {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  capture: CaptureNode;
  monitorGain: GainNode;
  mode: "worklet" | "script-processor";
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

type CaptureMessage =
  | { type: "pcm"; buffer: ArrayBuffer }
  | { type: "stats"; inputSampleRate: number; rms: number; peak: number };

const AUDIO_WORKLET_URL = "/winddown/mona-pcm-capture.worklet.js";

function getAudioContextCtor() {
  return window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function isWorkletCapture(node: CaptureNode): node is AudioWorkletNode {
  return typeof AudioWorkletNode !== "undefined" && node instanceof AudioWorkletNode;
}

export function useLiveAudioInput() {
  const runtimeRef = useRef<AudioInputRuntime | null>(null);
  const primedContextRef = useRef<AudioContext | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef<Omit<StartOptions, "socket">>({});
  const frameCountRef = useRef(0);

  const sendPcmFrame = useCallback((pcm: Int16Array) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || pcm.length === 0) return;
    socket.send(JSON.stringify(buildRealtimeAudioInput(pcm)));
    callbacksRef.current.onFrameSent?.();
    frameCountRef.current += 1;
  }, []);

  const prime = useCallback(async () => {
    const activeContext = runtimeRef.current?.context;
    if (activeContext && activeContext.state !== "closed") {
      await activeContext.resume();
      return;
    }

    const primedContext = primedContextRef.current;
    if (primedContext && primedContext.state !== "closed") {
      await primedContext.resume();
      return;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    const context = new AudioContextCtor();
    primedContextRef.current = context;
    await context.resume();
  }, []);

  const stop = useCallback((onPermission?: StartOptions["onPermission"]) => {
    const runtime = runtimeRef.current;
    const primedContext = primedContextRef.current;
    runtimeRef.current = null;
    primedContextRef.current = null;
    socketRef.current = null;
    callbacksRef.current = {};

    if (runtime) {
      if (isWorkletCapture(runtime.capture)) {
        runtime.capture.port.postMessage({ type: "stop" });
        runtime.capture.port.onmessage = null;
      } else {
        runtime.capture.onaudioprocess = null;
      }
      try {
        runtime.capture.disconnect();
        runtime.source.disconnect();
        runtime.monitorGain.disconnect();
      } catch {
        // Runtime may already be partially torn down.
      }
      runtime.stream.getTracks().forEach((track) => track.stop());
      void runtime.context.close().catch(() => undefined);
    } else if (primedContext) {
      void primedContext.close().catch(() => undefined);
    }
    onPermission?.("stopped");
  }, []);

  const start = useCallback(async ({ socket, onFrameSent, onAudioStats, onPermission }: StartOptions) => {
    socketRef.current = socket;
    callbacksRef.current = { onFrameSent, onAudioStats, onPermission };

    const activeRuntime = runtimeRef.current;
    if (activeRuntime && activeRuntime.context.state !== "closed") {
      activeRuntime.stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      await activeRuntime.context.resume();
      onPermission?.("granted");
      return;
    }

    frameCountRef.current = 0;
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    const primedContext = primedContextRef.current;
    const context = primedContext && primedContext.state !== "closed"
      ? primedContext
      : new AudioContextCtor();
    primedContextRef.current = null;
    await context.resume();

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      onPermission?.("granted");

      const source = context.createMediaStreamSource(stream);
      const monitorGain = context.createGain();
      monitorGain.gain.value = 0;
      let capture: CaptureNode | null = null;
      let mode: AudioInputRuntime["mode"] = "script-processor";

      if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
        try {
          await context.audioWorklet.addModule(AUDIO_WORKLET_URL);
          const worklet = new AudioWorkletNode(context, "mona-pcm-capture", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
              targetSampleRate: MONA_VNEXT_INPUT_SAMPLE_RATE,
              chunkSamples: 320,
            },
          });
          worklet.port.onmessage = (event: MessageEvent<CaptureMessage>) => {
            if (event.data.type === "pcm") {
              sendPcmFrame(new Int16Array(event.data.buffer));
              return;
            }
            callbacksRef.current.onAudioStats?.({
              inputSampleRate: event.data.inputSampleRate,
              rms: event.data.rms,
              peak: event.data.peak,
            });
          };
          capture = worklet;
          mode = "worklet";
        } catch {
          // Older iPhones and restrictive WebViews keep the guarded fallback.
        }
      }

      if (!capture) {
        const processor = context.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);
          const pcm = downsampleToPcm16(input, context.sampleRate);
          sendPcmFrame(pcm);
          if (frameCountRef.current !== 1 && frameCountRef.current % 50 !== 0) return;
          let sumSquares = 0;
          let peak = 0;
          for (let index = 0; index < input.length; index += 1) {
            const sample = Math.abs(input[index]);
            sumSquares += sample * sample;
            if (sample > peak) peak = sample;
          }
          callbacksRef.current.onAudioStats?.({
            inputSampleRate: context.sampleRate,
            rms: Math.sqrt(sumSquares / input.length),
            peak,
          });
        };
        capture = processor;
      }

      source.connect(capture);
      capture.connect(monitorGain);
      monitorGain.connect(context.destination);
      runtimeRef.current = { context, stream, source, capture, monitorGain, mode };
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
      socketRef.current = null;
      onPermission?.("denied");
      throw error;
    }
  }, [sendPcmFrame]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const visible = document.visibilityState === "visible";
      runtime.stream.getAudioTracks().forEach((track) => {
        track.enabled = visible;
      });
      if (visible) {
        void runtime.context.resume().catch(() => undefined);
      } else {
        void runtime.context.suspend().catch(() => undefined);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => () => {
    stop();
  }, [stop]);

  return { prime, start, stop };
}
