export type WindDownSpeechMatch = "match" | "close" | "different";

export type WindDownSpeechSupport = {
  synthesis: boolean;
  recognition: boolean;
  processing: "browser-managed";
};

export type WindDownSpeechRecognitionAlternative = {
  transcript: string;
  confidence?: number;
};

export type WindDownSpeechRecognitionResult = {
  readonly length: number;
  readonly isFinal?: boolean;
  readonly [index: number]: WindDownSpeechRecognitionAlternative | undefined;
};

export type WindDownSpeechRecognitionResultList = {
  readonly length: number;
  readonly [index: number]: WindDownSpeechRecognitionResult | undefined;
};

export type WindDownSpeechRecognitionEvent = {
  results: WindDownSpeechRecognitionResultList;
};

export type WindDownSpeechRecognitionErrorEvent = {
  error: string;
};

export type WindDownSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onaudiostart: (() => void) | null;
  onresult: ((event: WindDownSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WindDownSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export type WindDownSpeechRecognitionConstructor =
  new () => WindDownSpeechRecognition;

type WindDownSpeechScope = {
  speechSynthesis?: unknown;
  SpeechRecognition?: WindDownSpeechRecognitionConstructor;
  webkitSpeechRecognition?: WindDownSpeechRecognitionConstructor;
};

export function getWindDownSpeechRecognitionConstructor(
  scope: WindDownSpeechScope | null | undefined,
): WindDownSpeechRecognitionConstructor | null {
  return scope?.SpeechRecognition ?? scope?.webkitSpeechRecognition ?? null;
}

export function getWindDownSpeechSupport(
  scope: WindDownSpeechScope | null | undefined,
): WindDownSpeechSupport {
  return {
    synthesis: Boolean(scope?.speechSynthesis),
    recognition: Boolean(getWindDownSpeechRecognitionConstructor(scope)),
    processing: "browser-managed",
  };
}

export function ownsWindDownSpeechOperation(args: {
  active: object | null;
  candidate: object;
  operation: number;
  currentOperation: number;
  settled: boolean;
}): boolean {
  return (
    !args.settled
    && args.operation === args.currentOperation
    && args.active === args.candidate
  );
}

export function shouldOfferWindDownLearnSpeech(args: {
  exerciseKind: "meaning-choice" | "sentence-builder";
  answerVisible: boolean;
}): boolean {
  return args.answerVisible || args.exerciseKind === "meaning-choice";
}

export function normalizeWindDownSpeechText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordEditDistance(left: readonly string[], right: readonly string[]) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0)
          + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

export function compareWindDownSpeechTranscript(
  target: string,
  transcript: string,
): WindDownSpeechMatch {
  const normalizedTarget = normalizeWindDownSpeechText(target);
  const normalizedTranscript = normalizeWindDownSpeechText(transcript);
  if (!normalizedTarget || !normalizedTranscript) return "different";
  if (normalizedTarget === normalizedTranscript) return "match";

  const targetWords = normalizedTarget.split(" ");
  const transcriptWords = normalizedTranscript.split(" ");
  const longest = Math.max(targetWords.length, transcriptWords.length);
  const similarity =
    longest === 0
      ? 0
      : 1 - wordEditDistance(targetWords, transcriptWords) / longest;
  return similarity >= 0.7 ? "close" : "different";
}

export function windDownSpeechErrorMessage(code: string): string {
  if (code === "not-allowed") {
    return "마이크 권한이 꺼져 있어. Safari 설정에서 허용하거나 직접 입력해 줘.";
  }
  if (code === "service-not-allowed") {
    return "이 기기에서는 음성 받아쓰기를 열 수 없어. Siri 설정을 확인하거나 직접 입력해 줘.";
  }
  if (code === "audio-capture") {
    return "마이크를 사용할 수 없어. 다른 앱의 녹음을 닫거나 직접 입력해 줘.";
  }
  if (code === "network") {
    return "기기 음성 서비스에 연결하지 못했어. 직접 입력하면 학습은 그대로 이어져.";
  }
  if (code === "language-not-supported") {
    return "이 기기의 영어 받아쓰기를 사용할 수 없어. 직접 입력해 줘.";
  }
  if (code === "no-speech") {
    return "말소리가 들리지 않았어. 한 번 더 천천히 말해 줘.";
  }
  if (code === "aborted") return "받아쓰기를 멈췄어.";
  return "기기 받아쓰기를 시작하지 못했어. 직접 입력하면 학습은 그대로 이어져.";
}
