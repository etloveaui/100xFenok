#!/usr/bin/env tsx

import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  GEMINI_API_KEY_ENV,
  GEMINI_AUTH_TOKEN_ENDPOINT,
  GEMINI_LIVE_MODEL_RESOURCE,
  GEMINI_LIVE_WS_ENDPOINT,
  getGeminiApiKey,
} from "../src/lib/server/admin-live";
import { buildLiveToolDeclarations } from "../src/lib/server/admin-live-tools";

type ActivityMode = "no-interrupt" | "barge-in";

type ProbeOptions = {
  allowLive: boolean;
  firstText: string;
  postText: string;
  postWav: string | null;
  postTtsText: string | null;
  postTtsVoice: string;
  postTtsWav: string | null;
  postQuietMs: number;
  postWaitMs: number;
  prePostTimeoutMs: number;
  out: string;
};

type TimelineEvent = {
  tMs: number;
  direction: "in" | "out" | "local";
  tag: string;
  payload: unknown;
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_FIRST_TEXT = "시작. 오늘 표현은 '최소한 10개는 필요해.'로 카드부터 보여주고, 내가 따라 말하게 해줘.";
const DEFAULT_POST_TEXT = "따라 했어. I need at least ten.";
const DEFAULT_POST_TTS_VOICE = "Samantha";
const DEFAULT_OUT_DIR = "data/probes/admin-live-stall";
const execFile = promisify(execFileCallback);

function parseArgs(argv: string[]): ProbeOptions {
  const options: ProbeOptions = {
    allowLive: process.env.ALLOW_LIVE_GEMINI_PROBE === "1",
    firstText: DEFAULT_FIRST_TEXT,
    postText: DEFAULT_POST_TEXT,
    postWav: null,
    postTtsText: null,
    postTtsVoice: DEFAULT_POST_TTS_VOICE,
    postTtsWav: null,
    postQuietMs: 1200,
    postWaitMs: 55_000,
    prePostTimeoutMs: 90_000,
    out: path.join(DEFAULT_OUT_DIR, `probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--allow-live") {
      options.allowLive = true;
    } else if (arg === "--first-text" && next) {
      options.firstText = next;
      i += 1;
    } else if (arg === "--post-text" && next) {
      options.postText = next;
      i += 1;
    } else if (arg === "--post-wav" && next) {
      options.postWav = next;
      i += 1;
    } else if (arg === "--post-tts-text" && next) {
      options.postTtsText = next;
      i += 1;
    } else if (arg === "--post-tts-voice" && next) {
      options.postTtsVoice = next;
      i += 1;
    } else if (arg === "--post-tts-wav" && next) {
      options.postTtsWav = next;
      i += 1;
    } else if (arg === "--post-quiet-ms" && next) {
      options.postQuietMs = Number(next);
      i += 1;
    } else if (arg === "--post-wait-ms" && next) {
      options.postWaitMs = Number(next);
      i += 1;
    } else if (arg === "--pre-post-timeout-ms" && next) {
      options.prePostTimeoutMs = Number(next);
      i += 1;
    } else if (arg === "--out" && next) {
      options.out = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.postWav && options.postTtsText) {
    throw new Error("--post-wav and --post-tts-text are mutually exclusive");
  }
  if (!Number.isFinite(options.postQuietMs) || options.postQuietMs < 0) {
    throw new Error("--post-quiet-ms must be a non-negative number");
  }
  if (!Number.isFinite(options.postWaitMs) || options.postWaitMs < 1000) {
    throw new Error("--post-wait-ms must be >= 1000");
  }
  if (!Number.isFinite(options.prePostTimeoutMs) || options.prePostTimeoutMs < 1000) {
    throw new Error("--pre-post-timeout-ms must be >= 1000");
  }
  return options;
}

function printUsage() {
  console.log([
    "Usage:",
    "  ALLOW_LIVE_GEMINI_PROBE=1 npm run probe:live-stall -- [options]",
    "",
    "Options:",
    "  --post-wav <path>        Send real 16kHz PCM WAV after the post-tool utterance.",
    "  --post-tts-text <text>   Synthesize a macOS TTS WAV, then send it as post audio.",
    `  --post-tts-voice <name>  macOS say voice for --post-tts-text. Default ${DEFAULT_POST_TTS_VOICE}.`,
    "  --post-tts-wav <path>    Persist synthesized TTS WAV at this path.",
    "  --post-text <text>       Text fallback when --post-wav is omitted.",
    "  --first-text <text>      Initial text intended to trigger showCard.",
    "  --post-quiet-ms <ms>     Quiet time after post-tool output before post input. Default 1200.",
    "  --post-wait-ms <ms>      Wait after post input for transcription/response. Default 55000.",
    "  --pre-post-timeout-ms <ms> Give up if no post-tool utterance arrives. Default 90000.",
    "  --out <path>             JSON report path. Default data/probes/admin-live-stall/...",
    "",
    "Safety:",
    `  External Gemini calls are blocked unless ALLOW_LIVE_GEMINI_PROBE=1 or --allow-live is set.`,
  ].join("\n"));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultTtsWavPath() {
  return path.join(DEFAULT_OUT_DIR, `tts-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecord(value: unknown, key: string): JsonRecord | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function eventTags(frame: unknown): string[] {
  const record = isRecord(frame) ? frame : {};
  const tags: string[] = [];
  if (record.setupComplete) tags.push("setupComplete");
  if (record.toolCall) tags.push("toolCall");
  if (record.goAway) tags.push("goAway");
  if (record.usageMetadata) tags.push("usageMetadata");

  const serverContent = getRecord(record, "serverContent");
  if (serverContent) {
    if (serverContent.generationComplete) tags.push("generationComplete");
    if (serverContent.interrupted) tags.push("interrupted");
    if (serverContent.turnComplete) tags.push("turnComplete");
    if (serverContent.inputTranscription) tags.push("inputTranscription");
    if (serverContent.outputTranscription) tags.push("outputTranscription");
    if (serverContent.modelTurn) tags.push("modelTurn");
  }

  return tags.length ? tags : ["message"];
}

function pushEvent(timeline: TimelineEvent[], startedAt: number, direction: TimelineEvent["direction"], tag: string, payload: unknown) {
  timeline.push({
    tMs: Date.now() - startedAt,
    direction,
    tag,
    payload,
  });
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function buildMinimalProbeSetup(activityMode: ActivityMode): Record<string, unknown> {
  const functionDeclarations = buildLiveToolDeclarations(["mona-show-card"]);
  return {
    model: GEMINI_LIVE_MODEL_RESOURCE,
    generationConfig: {
      responseModalities: ["AUDIO"],
      thinkingConfig: { thinkingLevel: "low" },
      temperature: 0.55,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Achernar",
          },
        },
      },
    },
    systemInstruction: {
      parts: [
        {
          text: [
            "You are a Korean speaking coach.",
            "After each prompt, wait for the user to reply.",
            "Call showCard when introducing a sentence.",
            "Never say tool names, card states, or internal plans aloud.",
          ].join(" "),
        },
      ],
    },
    realtimeInputConfig: {
      activityHandling: activityMode === "no-interrupt" ? "NO_INTERRUPTION" : "START_OF_ACTIVITY_INTERRUPTS",
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        prefixPaddingMs: 300,
        silenceDurationMs: 1200,
      },
    },
    inputAudioTranscription: {
      languageHints: {
        languageCodes: ["en-US", "ko-KR"],
      },
    },
    outputAudioTranscription: {
      languageHints: {
        languageCodes: ["en-US", "ko-KR"],
      },
    },
    tools: [{ functionDeclarations }],
    contextWindowCompression: { slidingWindow: {} },
  };
}

async function mintEphemeralToken(activityMode: ActivityMode) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { error: "MISSING_GEMINI_API_KEY", missingEnv: GEMINI_API_KEY_ENV };
  }

  const now = new Date();
  const sessionId = `probe-live-mona-${now.getTime().toString(36)}-${activityMode}`;
  const setup = buildMinimalProbeSetup(activityMode);

  const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now.getTime() + 60 * 1000).toISOString();
  const response = await fetch(GEMINI_AUTH_TOKEN_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      uses: 1,
      expireTime,
      newSessionExpireTime,
      bidiGenerateContentSetup: setup,
    }),
  }).catch((error: unknown) => ({ error }));

  if ("error" in response) {
    return {
      error: "GEMINI_EPHEMERAL_TOKEN_NETWORK_FAILED",
      message: response.error instanceof Error ? response.error.message : String(response.error),
      setup,
    };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      error: "GEMINI_EPHEMERAL_TOKEN_FAILED",
      providerStatus: response.status,
      providerBody: body,
      setup,
    };
  }

  const token = typeof body?.name === "string" ? body.name : "";
  if (!token) {
    return {
      error: "GEMINI_EPHEMERAL_TOKEN_EMPTY",
      providerBody: body,
      setup,
    };
  }

  return {
    sessionId,
    token,
    expiresAt: typeof body?.expireTime === "string" ? body.expireTime : expireTime,
    setup,
  };
}

function toolResponseFor(call: unknown) {
  const record = isRecord(call) ? call : {};
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" ? record.name : "";
  if (name === "showCard") {
    return { id, name, response: { ok: true, source: "probe-harness" } };
  }
  if (name === "getYesterdaySession") {
    return {
      id,
      name,
      response: {
        ok: true,
        source: "probe-harness",
        session: null,
        best3: [],
        weakNotes: [],
      },
    };
  }
  return { id, name, response: { ok: true, source: "probe-harness", skipped: true } };
}

async function readWavPcm16Mono(filePath: string): Promise<Buffer> {
  const buffer = await readFile(filePath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`WAV_REQUIRED: ${filePath}`);
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let data: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (id === "fmt ") {
      audioFormat = buffer.readUInt16LE(start);
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bitsPerSample = buffer.readUInt16LE(start + 14);
    } else if (id === "data") {
      data = buffer.subarray(start, end);
    }
    offset = end + (size % 2);
  }

  if (!data || audioFormat !== 1 || sampleRate !== 16_000 || bitsPerSample !== 16) {
    throw new Error(`WAV_MUST_BE_PCM16_16KHZ: ${filePath}`);
  }
  if (channels === 1) return data;
  if (channels < 1) throw new Error(`WAV_INVALID_CHANNELS: ${filePath}`);

  const samples = data.length / 2 / channels;
  const mono = Buffer.alloc(Math.floor(samples) * 2);
  for (let i = 0; i < samples; i += 1) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      sum += data.readInt16LE((i * channels + ch) * 2);
    }
    const value = Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
    mono.writeInt16LE(value, i * 2);
  }
  return mono;
}

async function synthesizeMacOsTtsWav(text: string, voice: string, wavPath: string) {
  await mkdir(path.dirname(wavPath), { recursive: true });
  const aiffPath = wavPath.toLowerCase().endsWith(".wav")
    ? wavPath.replace(/\.wav$/i, ".aiff")
    : `${wavPath}.aiff`;
  await execFile("say", ["-v", voice, "-o", aiffPath, text]);
  await execFile("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", aiffPath, wavPath]);
  await readWavPcm16Mono(wavPath);
  return wavPath;
}

async function sendAudio(socket: WebSocket, timeline: TimelineEvent[], startedAt: number, wavPath: string) {
  const pcm = await readWavPcm16Mono(wavPath);
  const chunkBytes = 3200;
  let chunks = 0;
  for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
    const chunk = pcm.subarray(offset, offset + chunkBytes);
    socket.send(JSON.stringify({
      realtimeInput: {
        audio: {
          data: chunk.toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      },
    }));
    chunks += 1;
    await delay(100);
  }
  socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  pushEvent(timeline, startedAt, "out", "postAudio", { wavPath, bytes: pcm.length, chunks });
}

async function runOne(activityMode: ActivityMode, options: ProbeOptions) {
  const timeline: TimelineEvent[] = [];
  const startedAt = Date.now();
  const tokenResult = await mintEphemeralToken(activityMode);
  if ("error" in tokenResult) {
    return {
      activityMode,
      blocked: true,
      tokenResult,
      timeline,
    };
  }

  const socket = new WebSocket(`${GEMINI_LIVE_WS_ENDPOINT}?access_token=${encodeURIComponent(tokenResult.token)}`);
  let sawSetupComplete = false;
  let sawToolCall = false;
  let sentPostInput = false;
  let postInputAtMs: number | null = null;
  let postToolOutputSeen = false;
  let postInputTimer: NodeJS.Timeout | null = null;
  let finishTimer: NodeJS.Timeout | null = null;
  let prePostTimer: NodeJS.Timeout | null = null;

  const finish = new Promise<{ activityMode: ActivityMode; timeline: TimelineEvent[]; token: Record<string, unknown> }>((resolve, reject) => {
    const clearTimers = () => {
      if (postInputTimer) clearTimeout(postInputTimer);
      if (finishTimer) clearTimeout(finishTimer);
      if (prePostTimer) clearTimeout(prePostTimer);
    };

    const sendPostInput = () => {
      if (sentPostInput || socket.readyState !== WebSocket.OPEN) return;
      sentPostInput = true;
      postInputAtMs = Date.now() - startedAt;
      void (async () => {
        if (options.postWav) {
          await sendAudio(socket, timeline, startedAt, options.postWav);
        } else {
          socket.send(JSON.stringify({ realtimeInput: { text: options.postText } }));
          pushEvent(timeline, startedAt, "out", "postText", { text: options.postText });
        }
      })().catch((error: unknown) => {
        pushEvent(timeline, startedAt, "local", "postInputError", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
      finishTimer = setTimeout(() => {
        clearTimers();
        socket.close();
        resolve({
          activityMode,
          timeline,
          token: {
            sessionId: tokenResult.sessionId,
            expiresAt: tokenResult.expiresAt,
            setupSummary: summarizeSetup(tokenResult.setup),
            postInputAtMs,
          },
        });
      }, options.postWaitMs);
    };

    prePostTimer = setTimeout(() => {
      clearTimers();
      socket.close();
      pushEvent(timeline, startedAt, "local", "prePostTimeout", {
        reason: sentPostInput ? "post-input-wait-active" : "no-post-tool-utterance",
        timeoutMs: options.prePostTimeoutMs,
      });
      resolve({
        activityMode,
        timeline,
        token: {
          sessionId: tokenResult.sessionId,
          expiresAt: tokenResult.expiresAt,
          setupSummary: summarizeSetup(tokenResult.setup),
          postInputAtMs,
          timeoutReason: sentPostInput ? "post-input-wait-active" : "no-post-tool-utterance",
        },
      });
    }, options.prePostTimeoutMs);

    socket.addEventListener("open", () => {
      pushEvent(timeline, startedAt, "local", "wsOpen", { activityMode });
    });

    socket.addEventListener("error", (event) => {
      clearTimers();
      reject(new Error(`WEBSOCKET_ERROR:${JSON.stringify(event)}`));
    });

    socket.addEventListener("close", () => {
      pushEvent(timeline, startedAt, "local", "wsClose", {});
    });

    socket.addEventListener("message", (event) => {
      const payload = typeof event.data === "string"
        ? safeJsonParse(event.data)
        : safeJsonParse(Buffer.from(event.data as ArrayBuffer).toString("utf8"));
      for (const tag of eventTags(payload)) {
        pushEvent(timeline, startedAt, "in", tag, payload);
      }

      const payloadRecord = isRecord(payload) ? payload : {};
      if (payloadRecord.setupComplete && !sawSetupComplete) {
        sawSetupComplete = true;
        socket.send(JSON.stringify({ realtimeInput: { text: options.firstText } }));
        pushEvent(timeline, startedAt, "out", "firstText", { text: options.firstText });
      }

      const toolCall = getRecord(payloadRecord, "toolCall");
      const toolCalls = toolCall?.functionCalls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        sawToolCall = true;
        const functionResponses = toolCalls.map(toolResponseFor);
        socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
        pushEvent(timeline, startedAt, "out", "toolResponse", { functionResponses });
      }

      const serverContent = getRecord(payloadRecord, "serverContent");
      const outputTranscription = getRecord(serverContent, "outputTranscription");
      if (sawToolCall && !sentPostInput && typeof outputTranscription?.text === "string") {
        postToolOutputSeen = true;
        if (postInputTimer) clearTimeout(postInputTimer);
        postInputTimer = setTimeout(sendPostInput, options.postQuietMs);
      }
      if (sawToolCall && postToolOutputSeen && !sentPostInput && serverContent?.turnComplete) {
        sendPostInput();
      }
    });
  });

  return finish;
}

function summarizeSetup(setup: Record<string, unknown>) {
  const realtimeInputConfig = setup.realtimeInputConfig as Record<string, unknown> | undefined;
  const generationConfig = setup.generationConfig as Record<string, unknown> | undefined;
  const tools = Array.isArray(setup.tools) ? setup.tools : [];
  const functionDeclarations = tools.flatMap((tool) => {
    if (!isRecord(tool) || !Array.isArray(tool.functionDeclarations)) return [];
    return tool.functionDeclarations
      .map((declaration) => {
        if (!isRecord(declaration)) return null;
        const name = declaration.name ?? declaration.functionName;
        return typeof name === "string" && name ? name : null;
      })
      .filter((name): name is string => Boolean(name));
  });

  return {
    model: setup.model,
    activityHandling: realtimeInputConfig?.activityHandling,
    automaticActivityDetection: realtimeInputConfig?.automaticActivityDetection,
    thinkingConfig: generationConfig?.thinkingConfig,
    responseModalities: generationConfig?.responseModalities,
    hasInputAudioTranscription: Boolean(setup.inputAudioTranscription),
    functionDeclarations,
  };
}

function summarizeBehavior(timeline: TimelineEvent[]) {
  const firstPostInput = timeline.find((event) => event.direction === "out" && (event.tag === "postText" || event.tag === "postAudio"));
  const postInputMs = firstPostInput?.tMs ?? null;
  const postInputFrames = postInputMs === null ? [] : timeline.filter((event) => event.tMs >= postInputMs);
  return {
    sawSetupComplete: timeline.some((event) => event.tag === "setupComplete"),
    sawToolCall: timeline.some((event) => event.tag === "toolCall"),
    sawToolResponse: timeline.some((event) => event.direction === "out" && event.tag === "toolResponse"),
    postInputTag: firstPostInput?.tag ?? null,
    turnCompleteAfterTool: timeline.some((event) => event.tag === "turnComplete" && event.tMs > (timeline.find((e) => e.direction === "out" && e.tag === "toolResponse")?.tMs ?? Infinity)),
    inputTranscriptionAfterPostInput: postInputFrames.some((event) => event.tag === "inputTranscription"),
    outputTranscriptionAfterPostInput: postInputFrames.some((event) => event.tag === "outputTranscription"),
    modelTurnAfterPostInput: postInputFrames.some((event) => event.tag === "modelTurn"),
    generationCompleteAfterPostInput: postInputFrames.some((event) => event.tag === "generationComplete"),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.allowLive) {
    console.error("[blocked] External Gemini Live probe requires ALLOW_LIVE_GEMINI_PROBE=1 or --allow-live.");
    console.error("[blocked] This guard prevents accidental credential/cost-bearing calls.");
    printUsage();
    process.exitCode = 2;
    return;
  }

  const preparedPostWav = options.postTtsText
    ? await synthesizeMacOsTtsWav(
        options.postTtsText,
        options.postTtsVoice,
        options.postTtsWav ?? defaultTtsWavPath(),
      )
    : options.postWav;
  const runOptions: ProbeOptions = { ...options, postWav: preparedPostWav };

  const runs: Array<Awaited<ReturnType<typeof runOne>>> = [];
  for (const activityMode of ["no-interrupt", "barge-in"] as const) {
    const run = await runOne(activityMode, runOptions);
    runs.push(run);
    if ("blocked" in run && run.blocked) break;
  }

  const report = {
    createdAt: new Date().toISOString(),
    script: "scripts/probe-gemini-live-stall.ts",
    postInputPath: options.postTtsText ? "tts-wav" : preparedPostWav ? "audio-wav" : "text-fallback",
    options: {
      firstText: options.firstText,
      postText: preparedPostWav ? null : options.postText,
      postWav: preparedPostWav,
      postTtsText: options.postTtsText,
      postTtsVoice: options.postTtsText ? options.postTtsVoice : null,
      postTtsWav: options.postTtsText ? preparedPostWav : null,
      postQuietMs: options.postQuietMs,
      postWaitMs: options.postWaitMs,
      prePostTimeoutMs: options.prePostTimeoutMs,
    },
    runs: runs.map((run) => ({
      ...run,
      summary: run.timeline ? summarizeBehavior(run.timeline) : undefined,
    })),
  };

  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`probe report written: ${options.out}`);
  console.log(JSON.stringify(report.runs.map((run) => {
    const tokenResult = "tokenResult" in run ? run.tokenResult : undefined;
    return {
      activityMode: run.activityMode,
      blocked: Boolean(run.blocked),
      summary: run.summary,
      tokenError: tokenResult?.error,
      providerStatus: tokenResult && "providerStatus" in tokenResult ? tokenResult.providerStatus : undefined,
    };
  }), null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
