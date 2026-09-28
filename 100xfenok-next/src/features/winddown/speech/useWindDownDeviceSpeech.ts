"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  compareWindDownSpeechTranscript,
  getWindDownSpeechRecognitionConstructor,
  getWindDownSpeechSupport,
  ownsWindDownSpeechOperation,
  windDownSpeechErrorMessage,
  type WindDownSpeechMatch,
  type WindDownSpeechRecognition,
  type WindDownSpeechSupport,
} from "@/features/winddown/speech/deviceSpeech";

export type WindDownDeviceSpeechPhase =
  | "idle"
  | "speaking"
  | "requesting"
  | "listening"
  | "heard"
  | "error";

type WindDownDeviceSpeechState = {
  phase: WindDownDeviceSpeechPhase;
  transcript: string;
  match: WindDownSpeechMatch | null;
  message: string | null;
};

const IDLE_STATE: WindDownDeviceSpeechState = {
  phase: "idle",
  transcript: "",
  match: null,
  message: null,
};

const WIND_DOWN_SPEECH_WATCHDOG_MS = 12_000;

function browserScope() {
  return typeof window === "undefined" ? null : window;
}

export function useWindDownDeviceSpeech(args: {
  targetText: string;
  onTranscript?: (transcript: string) => void;
}) {
  const [support, setSupport] = useState<WindDownSpeechSupport>({
    synthesis: false,
    recognition: false,
    processing: "browser-managed",
  });
  const [state, setState] = useState<WindDownDeviceSpeechState>(IDLE_STATE);
  const recognitionRef = useRef<WindDownSpeechRecognition | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const operationRef = useRef(0);
  const onTranscriptRef = useRef(args.onTranscript);
  onTranscriptRef.current = args.onTranscript;

  const cancelActive = useCallback(() => {
    operationRef.current += 1;
    if (watchdogRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onaudiostart = null;
      recognition.abort();
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  const stop = useCallback(() => {
    cancelActive();
    setState(IDLE_STATE);
  }, [cancelActive]);

  useEffect(() => {
    setSupport(getWindDownSpeechSupport(browserScope()));
  }, []);

  useEffect(() => {
    stop();
  }, [args.targetText, stop]);

  useEffect(() => {
    const handlePageHide = () => stop();
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") stop();
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibility);
      cancelActive();
    };
  }, [cancelActive, stop]);

  const speak = useCallback(() => {
    const text = args.targetText.trim();
    if (!text || typeof window === "undefined" || !window.speechSynthesis) {
      setState({
        phase: "error",
        transcript: "",
        match: null,
        message: "이 기기에서는 문장 듣기를 사용할 수 없어.",
      });
      return;
    }
    operationRef.current += 1;
    const operation = operationRef.current;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.84;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice =
      voices.find((voice) => voice.lang.toLowerCase() === "en-us" && voice.localService)
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
      ?? null;
    utterance.onstart = () => {
      if (operation === operationRef.current) {
        setState({ ...IDLE_STATE, phase: "speaking" });
      }
    };
    utterance.onend = () => {
      if (operation === operationRef.current) setState(IDLE_STATE);
    };
    utterance.onerror = () => {
      if (operation === operationRef.current) {
        setState({
          phase: "error",
          transcript: "",
          match: null,
          message: "기기 음성으로 문장을 읽지 못했어. 화면의 문장으로 계속할 수 있어.",
        });
      }
    };
    window.speechSynthesis.speak(utterance);
  }, [args.targetText]);

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;
    const Recognition = getWindDownSpeechRecognitionConstructor(window);
    if (!Recognition) {
      setState({
        phase: "error",
        transcript: "",
        match: null,
        message: "이 브라우저에서는 음성 받아쓰기를 사용할 수 없어. 직접 입력해 줘.",
      });
      return;
    }

    operationRef.current += 1;
    const operation = operationRef.current;
    window.speechSynthesis?.cancel();
    recognitionRef.current?.abort();
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    let settled = false;
    const ownsOperation = () =>
      ownsWindDownSpeechOperation({
        active: recognitionRef.current,
        candidate: recognition,
        operation,
        currentOperation: operationRef.current,
        settled,
      });

    setState({ ...IDLE_STATE, phase: "requesting" });
    recognition.onaudiostart = () => {
      if (ownsOperation()) {
        setState({ ...IDLE_STATE, phase: "listening" });
      }
    };
    recognition.onresult = (event) => {
      if (!ownsOperation()) return;
      const transcripts: string[] = [];
      for (let resultIndex = 0; resultIndex < event.results.length; resultIndex += 1) {
        const result = event.results[resultIndex];
        if (!result) continue;
        for (
          let alternativeIndex = 0;
          alternativeIndex < result.length;
          alternativeIndex += 1
        ) {
          const transcript = result[alternativeIndex]?.transcript?.trim();
          if (transcript) transcripts.push(transcript);
        }
      }
      const transcript = transcripts[0] ?? "";
      if (!transcript) return;
      settled = true;
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      recognitionRef.current = null;
      onTranscriptRef.current?.(transcript);
      setState({
        phase: "heard",
        transcript,
        match: compareWindDownSpeechTranscript(args.targetText, transcript),
        message: null,
      });
    };
    recognition.onerror = (event) => {
      if (!ownsOperation()) return;
      settled = true;
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      recognitionRef.current = null;
      setState({
        phase: "error",
        transcript: "",
        match: null,
        message: windDownSpeechErrorMessage(event.error),
      });
    };
    recognition.onend = () => {
      if (!ownsOperation()) return;
      settled = true;
      recognitionRef.current = null;
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      setState({
        phase: "error",
        transcript: "",
        match: null,
        message: windDownSpeechErrorMessage("no-speech"),
      });
    };
    try {
      recognition.start();
      watchdogRef.current = window.setTimeout(() => {
        if (!ownsOperation()) return;
        settled = true;
        watchdogRef.current = null;
        recognitionRef.current = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.onaudiostart = null;
        recognition.abort();
        setState({
          phase: "error",
          transcript: "",
          match: null,
          message:
            "기기 받아쓰기가 응답하지 않았어. 직접 입력하면 학습은 그대로 이어져.",
        });
      }, WIND_DOWN_SPEECH_WATCHDOG_MS);
    } catch {
      settled = true;
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      recognitionRef.current = null;
      setState({
        phase: "error",
        transcript: "",
        match: null,
        message: windDownSpeechErrorMessage("start-failed"),
      });
    }
  }, [args.targetText]);

  return {
    ...state,
    support,
    speak,
    startListening,
    stop,
  };
}
