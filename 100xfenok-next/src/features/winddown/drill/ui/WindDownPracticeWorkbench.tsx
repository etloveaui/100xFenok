"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { WindDownDeviceSpeechPractice } from "@/features/winddown/speech/WindDownDeviceSpeechPractice";
import {
  applyWindDownPracticeAction,
  createWindDownPracticeSession,
  WINDDOWN_VOICE_CORRECTION_METHODS,
  windDownPracticeListeningTexts,
  type WindDownPracticeMethod,
  type WindDownPracticeResponse,
  type WindDownPracticeState,
} from "@/features/winddown/drill/practice";

type Props = {
  response: WindDownPracticeResponse;
  onBack: () => void;
};

const METHOD_LABELS: Record<WindDownPracticeMethod, string> = {
  "recall-reveal": "회상 → 정답 보기",
  "audio-first-response": "먼저 듣고 말하기",
  "listening-variants": "다른 표현 듣기",
  "linked-recall-listen-response": "연결 연습",
  "pronunciation-transcript": "발음 연습 · 받아쓰기 확인",
  "pattern-transform": "패턴 바꿔 말하기",
};

const THEME_LABELS: Record<string, string> = {
  work: "직장과 일", "family-friends": "가족과 친구", "selftalk-emotion": "마음과 감정",
  free: "일상 표현", "work-advanced": "직장 심화", "out-shopping-dining": "외출·쇼핑·식사",
};

const METHODS = Object.keys(METHOD_LABELS) as WindDownPracticeMethod[];

const SELECT_CLASS = "mt-2 min-h-[48px] min-w-0 max-w-full w-full appearance-none rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] pl-3 pr-10 text-sm font-black text-[var(--wd-text)]";
const SELECT_STYLE: CSSProperties = {
  colorScheme: "dark",
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%23b9afd7' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  backgroundSize: "16px",
};

function selectedTargetMaterialId(response: WindDownPracticeResponse): string | null {
  if (response.target.kind === "canonical-material") return response.target.materialId;
  if (response.target.kind === "generic") return response.materials[0]?.id ?? null;
  return null;
}

function makeSession(args: {
  response: WindDownPracticeResponse;
  method: WindDownPracticeMethod;
  materialId: string | null;
}): WindDownPracticeState | null {
  const material = args.materialId
    ? args.response.materials.find((candidate) => candidate.id === args.materialId)
    : undefined;
  if (args.response.target.kind === "voice-correction") {
    if (!args.response.voiceCorrection) return null;
    return createWindDownPracticeSession({
      method: args.method,
      seed: args.response.voiceCorrection.citation.productSessionId,
      voiceCorrection: args.response.voiceCorrection,
    });
  }
  if (!material) return null;
  return createWindDownPracticeSession({
    method: args.method,
    seed: `${args.response.material.contentDigest}:${material.id}`,
    material,
  });
}

export default function WindDownPracticeWorkbench({ response, onBack }: Props) {
  const isVoiceCorrection = response.target.kind === "voice-correction";
  const [method, setMethod] = useState<WindDownPracticeMethod>("recall-reveal");
  const [materialId, setMaterialId] = useState(() => selectedTargetMaterialId(response));
  const [themeFilter, setThemeFilter] = useState("all");
  const [variantIndex, setVariantIndex] = useState(0);
  const [answerText, setAnswerText] = useState("");
  const [session, setSession] = useState<WindDownPracticeState | null>(() =>
    makeSession({ response, method: "recall-reveal", materialId: selectedTargetMaterialId(response) }),
  );

  const material = useMemo(
    () => response.materials.find((candidate) => candidate.id === materialId) ?? null,
    [materialId, response.materials],
  );
  const themes = useMemo(
    () => Array.from(new Set(response.materials.map((candidate) => candidate.practice?.theme?.trim() ?? "").filter(Boolean))).sort(),
    [response.materials],
  );
  const filteredMaterials = useMemo(
    () => themeFilter === "all"
      ? response.materials
      : response.materials.filter((candidate) => candidate.practice?.theme?.trim() === themeFilter),
    [response.materials, themeFilter],
  );
  const availableMethods = useMemo(() => {
    if (isVoiceCorrection) return WINDDOWN_VOICE_CORRECTION_METHODS;
    return METHODS.filter((candidate) => candidate !== "pattern-transform" || Boolean(material?.practice?.pattern));
  }, [isVoiceCorrection, material?.practice?.pattern]);
  const targetText = session?.material?.en ?? session?.voiceCorrection?.modelCorrection ?? "";
  const listeningTexts = material ? windDownPracticeListeningTexts(material) : [];

  useEffect(() => {
    const nextMethod = availableMethods.includes(method) ? method : availableMethods[0];
    if (nextMethod !== method) setMethod(nextMethod);
    setSession(makeSession({ response, method: nextMethod, materialId }));
    setVariantIndex(0);
    setAnswerText("");
  }, [materialId, method, response, availableMethods]);

  useEffect(() => {
    setMaterialId(selectedTargetMaterialId(response));
    setThemeFilter("all");
    setMethod("recall-reveal");
  }, [response]);

  const chooseMaterial = (nextId: string) => {
    setMaterialId(nextId);
  };

  const submit = (text: string) => {
    setSession((current) => current
      ? applyWindDownPracticeAction(current, { type: "submit-response", text })
      : current);
  };

  const advanceSession = (type: "advance" | "complete") => {
    setAnswerText("");
    setSession((current) => current
      ? applyWindDownPracticeAction(current, { type })
      : current);
  };

  if (!session) {
    return (
      <section data-winddown-practice role="alert" className="rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-6">
        <h2 className="text-xl font-black">연습 문장을 찾지 못했어.</h2>
        <p className="mt-2 text-sm font-semibold text-[var(--wd-muted)]">연습할 문장으로 다시 골라 줘.</p>
        <button type="button" onClick={onBack} className="mt-5 min-h-[48px] w-full rounded-2xl border border-[var(--wd-border)] px-4 text-sm font-black">Quick Drill로 돌아가기</button>
      </section>
    );
  }

  const canSubmit = session.phase === "recall" || session.phase === "response";
  const isLinked = method === "linked-recall-listen-response";
  const currentStepLabel = session.currentStep ? METHOD_LABELS[session.currentStep.method] : METHOD_LABELS[method];

  return (
    <section data-winddown-practice aria-label="문장 연습" className="min-w-0 break-words [overflow-wrap:anywhere] rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black tracking-[.16em] text-[var(--wd-accent)]">문장 연습 · 연습 전용</p>
          <h2 className="mt-1 text-xl font-black">한 문장을 여러 번 만나기</h2>
        </div>
        <button type="button" onClick={onBack} className="min-h-[48px] shrink-0 rounded-full border border-[var(--wd-border)] px-4 text-xs font-black text-[var(--wd-muted)]">보드</button>
      </div>

      {response.target.kind === "generic" && response.materials.length > 0 ? (
        <div className="mt-5 grid gap-3">
          {themes.length > 0 ? (
            <label className="block text-xs font-black text-[var(--wd-muted)]">
              주제
              <select data-practice-theme value={themeFilter} onChange={(event) => { const nextTheme = event.target.value; setThemeFilter(nextTheme); const nextMaterial = (nextTheme === "all" ? response.materials : response.materials.filter((candidate) => candidate.practice?.theme?.trim() === nextTheme))[0]; if (nextMaterial) chooseMaterial(nextMaterial.id); }} className={SELECT_CLASS} style={SELECT_STYLE}>
                <option value="all">전체</option>
                {themes.map((theme) => <option key={theme} value={theme}>{THEME_LABELS[theme] ?? theme}</option>)}
              </select>
            </label>
          ) : null}
          <label className="block text-xs font-black text-[var(--wd-muted)]">
            연습할 문장
            <select data-practice-material value={materialId ?? ""} onChange={(event) => chooseMaterial(event.target.value)} className={SELECT_CLASS} style={SELECT_STYLE}>
            {filteredMaterials.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.ko}</option>)}
          </select>
          </label>
        </div>
      ) : null}

      <label className="mt-4 block text-xs font-black text-[var(--wd-muted)]">
        연습 방법
        <select data-practice-method value={method} onChange={(event) => setMethod(event.target.value as WindDownPracticeMethod)} className={SELECT_CLASS} style={SELECT_STYLE}>
          {availableMethods.map((candidate) => <option key={candidate} value={candidate}>{METHOD_LABELS[candidate]}</option>)}
        </select>
      </label>

      {isVoiceCorrection ? (
        <p className="mt-4 rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-4 py-3 text-xs font-bold leading-5 text-[var(--wd-muted)]">
          대화에서 받은 교정은 참고용으로만 보여 줘. 정답·발음 점수·학습 기록으로 채점하지 않아.
        </p>
      ) : null}

      {isLinked ? (
        <div className="mt-5 rounded-2xl border border-[var(--wd-border)] px-4 py-3" aria-label={`연결 연습 ${Math.min(session.stepIndex + 1, session.steps.length)}/${session.steps.length}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-black text-[var(--wd-muted)]">연결 연습</p>
            <p aria-live="polite" className="text-xs font-black tabular-nums text-[var(--wd-accent)]">{Math.min(session.stepIndex + 1, session.steps.length)}/{session.steps.length}</p>
          </div>
          <ol className="mt-3 grid gap-2 text-sm font-bold">
            {session.steps.map((step, index) => (
              <li key={`${step.method}-${index}`} aria-current={index === session.stepIndex ? "step" : undefined} className={index === session.stepIndex ? "text-[var(--wd-accent)]" : "text-[var(--wd-muted)]"}>
                <span className="mr-2">{index + 1}</span>{METHOD_LABELS[step.method]}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs font-black text-[var(--wd-text)]">현재 단계: {session.phase === "complete" ? "완료" : currentStepLabel}</p>
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl bg-[var(--wd-bg)] p-4">
        <p className="text-xs font-black text-[var(--wd-muted)]">{isVoiceCorrection ? "이전에 말한 문장" : material?.ko ?? "문장을 떠올려 봐"}</p>
        {isVoiceCorrection && session.voiceCorrection?.learnerText ? <p className="mt-2 break-words text-sm font-black">“{session.voiceCorrection.learnerText}”</p> : null}
        {session.phase !== "listening" && !(isVoiceCorrection && session.revealed) ? (
          <p className="mt-3 text-lg font-black">{method === "pattern-transform" ? "이 패턴으로 문장을 바꿔 말하거나 입력해 봐." : "영어 문장을 말하거나 입력해 봐."}</p>
        ) : null}

        {method === "pattern-transform" && material?.practice?.pattern ? (
          <div data-practice-pattern className="mt-4 rounded-xl border border-[var(--wd-border)] bg-[var(--wd-surface)] px-3 py-3">
            <p className="text-[10px] font-black tracking-[.12em] text-[var(--wd-accent)]">문형</p>
            <p className="mt-1 text-sm font-black">{material.practice.pattern}</p>
            {material.practice.variationsEn.length > 0 ? <p className="mt-2 text-xs font-bold leading-5 text-[var(--wd-muted)]">예시: {material.practice.variationsEn.join(" · ")}</p> : null}
          </div>
        ) : null}

        {canSubmit ? (
          <div className="mt-4 flex gap-2">
            <input aria-label="연습 답변" value={answerText} onChange={(event) => setAnswerText(event.target.value)} className="min-h-[48px] min-w-0 flex-1 rounded-xl border border-[var(--wd-border)] bg-[var(--wd-surface)] px-3 text-sm font-bold text-[var(--wd-text)]" placeholder="영어로 답해 봐" onKeyDown={(event) => { if (event.key === "Enter" && answerText.trim()) submit(answerText); }} />
            <button type="button" disabled={!answerText.trim()} onClick={() => submit(answerText)} className="min-h-[48px] rounded-xl bg-[var(--wd-accent)] px-4 text-xs font-black text-[var(--wd-bg)] disabled:cursor-not-allowed disabled:opacity-50">확인</button>
          </div>
        ) : null}

        {method === "audio-first-response" || method === "pronunciation-transcript" || method === "pattern-transform" || (isLinked && session.currentStep?.method === "audio-first-response") ? (
          <WindDownDeviceSpeechPractice
            targetText={targetText}
            controls="listen-and-speak"
            showMatchFeedback={!isVoiceCorrection && method !== "pattern-transform"}
            onTranscript={canSubmit ? (text) => setAnswerText(text) : undefined}
          />
        ) : null}

        {session.phase === "listening" && listeningTexts.length > 0 ? (
          <div className="mt-5">
            <p className="text-sm font-black">다른 표현 듣기</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {listeningTexts.map((text, index) => (
                <button key={`${text}-${index}`} type="button" aria-pressed={variantIndex === index} onClick={() => setVariantIndex(index)} className={`min-h-[48px] shrink-0 rounded-xl border px-3 text-xs font-black ${variantIndex === index ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] text-[var(--wd-accent)]" : "border-[var(--wd-border)] bg-[var(--wd-surface)] text-[var(--wd-muted)]"}`}>표현 {index + 1}</button>
              ))}
            </div>
            <WindDownDeviceSpeechPractice targetText={listeningTexts[variantIndex] ?? listeningTexts[0] ?? ""} controls="listen-and-speak" showMatchFeedback={false} />
            <button data-practice-advance type="button" onClick={() => advanceSession("advance")} className="mt-4 min-h-[48px] w-full rounded-2xl bg-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-bg)]">다음 단계</button>
          </div>
        ) : null}

        {session.attempt ? (
          <p className="mt-4 text-xs font-bold text-[var(--wd-muted)]">이번 답변: “{session.attempt.text}” · 점수에 반영하지 않아</p>
        ) : null}

        {session.phase === "awaiting-reveal" ? (
          <button data-practice-reveal type="button" onClick={() => setSession((current) => current ? applyWindDownPracticeAction(current, { type: "reveal" }) : current)} className="mt-5 min-h-[48px] w-full rounded-2xl bg-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-bg)]">{isVoiceCorrection ? "교정 내용 보기" : "정답 보기"}</button>
        ) : null}

        {session.revealed ? (
          <div data-practice-reveal-text aria-live="polite" className="mt-5 rounded-2xl border border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] px-4 py-4">
            <p className="text-[10px] font-black tracking-[.14em] text-[var(--wd-accent)]">참고 문장</p>
            <p className="mt-2 break-words text-lg font-black">{session.revealText}</p>
            {material && listeningTexts.length > 1 ? <p className="mt-3 break-words text-xs font-bold leading-5 text-[var(--wd-muted)]">다른 표현: {listeningTexts.slice(1).join(" · ")}</p> : null}
          </div>
        ) : null}

        {session.phase === "revealed" ? (
          <button type="button" onClick={() => advanceSession("complete")} className="mt-4 min-h-[48px] w-full rounded-2xl border border-[var(--wd-border)] px-4 text-sm font-black">{isLinked && session.stepIndex < session.steps.length - 1 ? "다음 단계" : "연습 마치기"}</button>
        ) : null}
      </div>

      {session.phase === "complete" ? <p className="mt-4 text-center text-xs font-black text-[var(--wd-accent)]">연습을 마쳤어. 자유 연습은 복습 점수에 반영되지 않아.</p> : null}
    </section>
  );
}
