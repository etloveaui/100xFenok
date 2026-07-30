import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const inputPath = path.join(process.cwd(), "src/features/mona-vnext/live/useLiveAudioInput.ts");
const sessionPath = path.join(process.cwd(), "src/features/mona-vnext/live/useGeminiLiveSession.ts");
const appPath = path.join(process.cwd(), "src/features/mona-vnext/MonaVoiceCoachApp.tsx");
const workletPath = path.join(process.cwd(), "public/winddown/mona-pcm-capture.worklet.js");

const inputSource = readFileSync(inputPath, "utf8");
const sessionSource = readFileSync(sessionPath, "utf8");
const appSource = readFileSync(appPath, "utf8");

assert.ok(existsSync(workletPath), "the production PCM capture worklet is missing");
const workletSource = readFileSync(workletPath, "utf8");

assert.ok(workletSource.includes("extends AudioWorkletProcessor"));
assert.ok(workletSource.includes('registerProcessor("mona-pcm-capture"'));
assert.ok(inputSource.includes("const prime = useCallback"));
assert.ok(inputSource.includes("context.audioWorklet.addModule"));
assert.ok(inputSource.includes('new AudioWorkletNode(context, "mona-pcm-capture"'));
assert.ok(inputSource.includes("context.createScriptProcessor"), "older iPhones still need a guarded fallback");
assert.ok(inputSource.includes("autoGainControl: true"), "quiet bedtime speech should use device AGC");
assert.ok(inputSource.includes('document.addEventListener("visibilitychange"'));
assert.ok(inputSource.includes("return { prime, start, stop }"));
assert.ok(sessionSource.includes("audioInput.prime()"));
assert.ok(sessionSource.includes("audioOutput.ensure()"));
assert.ok(appSource.includes('window.addEventListener("pagehide"'));

type WorkletMessage = {
  type?: unknown;
  buffer?: unknown;
  rms?: unknown;
  peak?: unknown;
};

type WorkletProcessorInstance = {
  port: {
    messages: WorkletMessage[];
    onmessage: ((event: { data?: unknown }) => void) | null;
    postMessage: (message: WorkletMessage, transfer?: unknown[]) => void;
  };
  process: (inputs: Float32Array[][]) => boolean;
};

type WorkletProcessorConstructor = new (options: {
  processorOptions: { targetSampleRate: number; chunkSamples: number };
}) => WorkletProcessorInstance;

let registeredProcessor: WorkletProcessorConstructor | null = null;

class MockAudioWorkletProcessor {
  port = {
    messages: [] as WorkletMessage[],
    onmessage: null as ((event: { data?: unknown }) => void) | null,
    postMessage: (message: WorkletMessage) => {
      this.port.messages.push(message);
    },
  };
}

vm.runInNewContext(workletSource, {
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  sampleRate: 48000,
  registerProcessor: (name: string, processor: WorkletProcessorConstructor) => {
    assert.equal(name, "mona-pcm-capture");
    registeredProcessor = processor;
  },
  ArrayBuffer,
  Float32Array,
  Int16Array,
  Math,
  Number,
});

assert.ok(registeredProcessor, "worklet did not register its processor");
const Processor = registeredProcessor as WorkletProcessorConstructor;
const processor = new Processor({
  processorOptions: { targetSampleRate: 16000, chunkSamples: 320 },
});
for (let block = 0; block < 200; block += 1) {
  assert.equal(processor.process([[new Float32Array(128).fill(0.25)]]), true);
}

const pcmMessages = processor.port.messages.filter((message) => message.type === "pcm");
const statsMessages = processor.port.messages.filter((message) => message.type === "stats");
assert.ok(pcmMessages.length >= 20, "worklet did not emit enough 20ms PCM chunks");
assert.ok(statsMessages.length >= 1, "worklet did not emit input-level telemetry");
const firstPcmBuffer = pcmMessages[0].buffer;
assert.ok(firstPcmBuffer instanceof ArrayBuffer);
const firstPcm = new Int16Array(firstPcmBuffer);
assert.equal(firstPcm.length, 320);
assert.ok(firstPcm[0] >= 8190 && firstPcm[0] <= 8192);
assert.ok(Number(statsMessages[0].rms) >= 0.249 && Number(statsMessages[0].rms) <= 0.251);

console.log("PASS iphone-audio - touch priming, worklet capture, fallback, AGC, and lifecycle guards are wired");
