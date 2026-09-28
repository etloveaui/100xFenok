"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_LEARNER,
  WIND_DOWN_CONTENT_PACK,
  isContentPackValid,
  memberForChapter,
  type WindDownLearnerProfile,
} from "@/features/winddown/game/model/contract";
import {
  normalizeWindDownCeremonyProjection,
  type WindDownCeremonyProjection,
  type WindDownCeremonySlotId,
} from "@/features/winddown/game/model/ceremony";
import {
  chapterGrowth,
  currentChapter,
  levelFromXp,
  nextChapter,
  nightsToReach,
} from "@/features/winddown/game/model/progress";
import {
  WIND_DOWN_STORY_EPISODES,
  storyEpisodeById,
  storyEpisodeState,
  storyEpisodesForChapter,
  storyRoleplayHref,
} from "@/features/winddown/game/model/story";
import { WIND_DOWN_MEMBERS } from "@/features/winddown/game/model/roster";
import type { WindDownChapter } from "@/features/winddown/game/model/tour";
import StoryJourney from "./StoryJourney";
import WindDownStoryScene from "./WindDownStoryScene";
import styles from "./artist-story.module.css";

type Props = {
  /** Identity is presentation-only here; progress always comes from receipts. */
  learner?: WindDownLearnerProfile;
};

type GameProgress = {
  schemaVersion: 1;
  xp: number;
  creditedAnswerCount: number;
  collectedReviewStarCount: number;
  creditedNightCount: number;
};

type NextAction = "review" | "learn" | "roleplay" | "free";

type GameHabitResponse = {
  game: GameProgress;
  ceremony: WindDownCeremonyProjection;
  nextAction: NextAction;
};

type WindDownStoryEpisode = (typeof WIND_DOWN_STORY_EPISODES)[number];

const ACTIONS: Record<NextAction, { href: string; label: string }> = {
  review: { href: "/winddown/review", label: "복습 이어하기" },
  learn: { href: "/winddown/learn", label: "Learn 이어하기" },
  roleplay: { href: "/winddown/roleplay", label: "말하기 이어하기" },
  free: { href: "/winddown/live-talk", label: "오늘 더 말하기" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function gameHabitFrom(value: unknown): GameHabitResponse | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.game)) return null;
  const game = value.game;
  const ceremony = normalizeWindDownCeremonyProjection(value.ceremony);
  const tonight = value.tonight;
  if (
    game.schemaVersion !== 1
    || !isNonNegativeInteger(game.xp)
    || !isNonNegativeInteger(game.creditedAnswerCount)
    || !isNonNegativeInteger(game.collectedReviewStarCount)
    || !isNonNegativeInteger(game.creditedNightCount)
    || !ceremony
    || !isRecord(tonight)
    || !["review", "learn", "roleplay", "free"].includes(String(tonight.nextAction))
  ) {
    return null;
  }
  return {
    game: {
      schemaVersion: 1,
      xp: game.xp,
      creditedAnswerCount: game.creditedAnswerCount,
      collectedReviewStarCount: game.collectedReviewStarCount,
      creditedNightCount: game.creditedNightCount,
    },
    ceremony,
    nextAction: tonight.nextAction as NextAction,
  };
}

function ceremonyFrom(value: unknown): WindDownCeremonyProjection | null {
  return isRecord(value) && value.ok === true
    ? normalizeWindDownCeremonyProjection(value.ceremony)
    : null;
}

function chapterForEpisode(
  episode: WindDownStoryEpisode | null,
): WindDownChapter | null {
  return episode
    ? WIND_DOWN_CONTENT_PACK.chapters.find(
        (chapter) => chapter.id === episode.chapterId,
      ) ?? null
    : null;
}

function viewingState(
  episode: WindDownStoryEpisode,
  chapter: WindDownChapter,
  current: WindDownChapter,
  xp: number,
): "current" | "replay" | "preview" {
  if (storyEpisodeState(episode, xp) === "preview") return "preview";
  return chapter.id === current.id ? "current" : "replay";
}

function viewingStateLabel(state: "current" | "replay" | "preview") {
  return state === "current"
    ? "현재 커리어"
    : state === "replay"
      ? "다시보기"
      : "미리보기";
}

function generalPreparationCopy(action: NextAction) {
  if (action === "review") return "오늘 복습할 문장을 먼저 떠올려 봐요.";
  if (action === "learn") return "오늘의 새 문장 다섯 개를 익혀요.";
  if (action === "roleplay") return "오늘의 일반 말하기 준비를 이어가요.";
  return "점수 없이 오늘을 편하게 더 말해요.";
}

export default function WindDownGameClient({
  learner = DEFAULT_LEARNER,
}: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [habit, setHabit] = useState<GameHabitResponse | null>(null);
  const requestSequence = useRef(0);
  const ceremonyRequestPending = useRef(false);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [dialogueOpen, setDialogueOpen] = useState(false);
  const [ceremonyStatus, setCeremonyStatus] = useState<
    "idle" | "saving" | "conflict" | "refreshed" | "error"
  >("idle");
  const [ceremonyStatusSlotLabel, setCeremonyStatusSlotLabel] = useState("");

  const xp = habit?.game.xp ?? 0;
  const level = levelFromXp(xp);
  const here = useMemo(() => currentChapter(xp), [xp]);
  const next = useMemo(() => nextChapter(xp), [xp]);
  const growth = useMemo(() => chapterGrowth(xp), [xp]);
  const selectedEpisode = useMemo(
    () => selectedEpisodeId ? storyEpisodeById(selectedEpisodeId) : null,
    [selectedEpisodeId],
  );
  const chapter = useMemo(
    () => chapterForEpisode(selectedEpisode) ?? here,
    [here, selectedEpisode],
  );
  const episode = useMemo(
    () => selectedEpisode ?? storyEpisodesForChapter(chapter.id)[0] ?? null,
    [chapter.id, selectedEpisode],
  );
  const member = useMemo(
    () => WIND_DOWN_MEMBERS.find((candidate) => candidate.id === episode?.guide)
      ?? memberForChapter(WIND_DOWN_CONTENT_PACK, learner, chapter.id),
    [chapter.id, episode?.guide, learner],
  );

  const loadProgress = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setStatus("loading");
    try {
      const response = await fetch("/api/winddown/habit", { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      const nextHabit = gameHabitFrom(body);
      if (!response.ok || !nextHabit) {
        throw new Error("winddown_game_progress_invalid");
      }
      if (requestSequence.current !== sequence) return;
      setHabit(nextHabit);
      setStatus("ready");
    } catch {
      if (requestSequence.current !== sequence) return;
      setHabit(null);
      setStatus("error");
    }
  }, []);

  const commitCeremony = useCallback(async (
    slotId: WindDownCeremonySlotId,
    optionId: string,
    slotLabel: string,
  ) => {
    if (ceremonyRequestPending.current) return;
    ceremonyRequestPending.current = true;
    setCeremonyStatusSlotLabel(slotLabel);
    setCeremonyStatus("saving");
    try {
      const response = await fetch("/api/winddown/game/ceremony", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, optionId }),
      });
      const body: unknown = await response.json().catch(() => null);
      const ceremony = ceremonyFrom(body);
      if (response.status === 409) {
        const errorCode = isRecord(body) && typeof body.error === "string"
          ? body.error
          : "";
        const latestResponse = await fetch("/api/winddown/habit", {
          cache: "no-store",
        });
        const latestBody: unknown = await latestResponse.json().catch(() => null);
        const latestHabit = gameHabitFrom(latestBody);
        if (!latestResponse.ok || !latestHabit) {
          throw new Error("winddown_ceremony_conflict_refresh_failed");
        }
        setHabit(latestHabit);
        setCeremonyStatus(
          errorCode === "WINDDOWN_CEREMONY_CHOICE_CONFLICT"
            ? "conflict"
            : "refreshed",
        );
        return;
      }
      if (!response.ok || !ceremony) {
        throw new Error("winddown_ceremony_commit_failed");
      }
      setHabit((current) => current ? { ...current, ceremony } : current);
      setCeremonyStatus("idle");
    } catch {
      setCeremonyStatus("error");
    } finally {
      ceremonyRequestPending.current = false;
    }
  }, []);

  const selectEpisode = useCallback((nextEpisode: WindDownStoryEpisode) => {
    setSelectedEpisodeId(nextEpisode.id);
    setDialogueOpen(false);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("story", nextEpisode.id);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    const stageHeading = document.getElementById("winddown-story-stage-heading");
    if (stageHeading) {
      stageHeading.focus({ preventScroll: true });
      stageHeading.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
    }
  }, []);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  useEffect(() => {
    const requestedStory = new URLSearchParams(window.location.search).get("story");
    if (!requestedStory) return;
    const validatedEpisode = storyEpisodeById(requestedStory);
    if (validatedEpisode) setSelectedEpisodeId(validatedEpisode.id);
  }, []);

  const forecast = next ? nightsToReach(next.unlockLevel, xp) : 0;
  const action = habit ? ACTIONS[habit.nextAction] : null;
  const chosenCeremonies = habit?.ceremony.slots.filter(
    (slot) => slot.choice !== null,
  ) ?? [];
  const openCeremony = habit?.ceremony.slots.find(
    (slot) => slot.unlocked && slot.choice === null,
  ) ?? null;
  const nextCeremony = habit?.ceremony.slots.find(
    (slot) => !slot.unlocked,
  ) ?? null;
  const ceremonyUnavailable = habit?.ceremony.status === "unavailable";

  if (!isContentPackValid(WIND_DOWN_CONTENT_PACK)) {
    return (
      <main className={styles.page} role="alert">
        <div className={styles.shell}>
          <section className={styles.statusPanel} style={{ background: "var(--wd-surface)" }}>
            <h1 className={styles.statusTitle}>투어 콘텐츠를 안전하게 열지 못했어.</h1>
            <Link href="/winddown" className={`${styles.button} ${styles.secondaryButton} ${styles.statusRetry} motion-reduce:transition-none`}>
              오늘 밤으로 돌아가기
            </Link>
          </section>
        </div>
      </main>
    );
  }

  if (status === "loading" || !habit || !action) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <nav className={styles.topbar} aria-label="월드 투어 이동">
            <Link href="/winddown" className={styles.backLink}>← 오늘 밤</Link>
            <span className={styles.brand}>WIND DOWN</span>
            <span className={styles.topContext}>투어 기록</span>
          </nav>
          {status === "loading" ? (
            <section aria-busy="true" className={styles.statusPanel} style={{ background: "var(--wd-surface)" }}>
              <h1 className={styles.statusTitle}>학습 기록으로 투어를 여는 중</h1>
              <p className={styles.statusCopy}>저장된 완료 기록만 확인하고 있어.</p>
            </section>
          ) : (
            <section role="alert" className={styles.statusPanel} style={{ background: "var(--wd-surface)" }}>
              <h1 className={styles.statusTitle}>투어 기록을 열지 못했어.</h1>
              <p className={styles.statusCopy}>경험치를 추측하지 않았어. 다시 확인해 줘.</p>
              <button
                type="button"
                onClick={() => void loadProgress()}
                className={`${styles.button} ${styles.primaryButton} ${styles.statusRetry} motion-reduce:transition-none`}
              >
                다시 불러오기
              </button>
            </section>
          )}
        </div>
      </main>
    );
  }

  if (!episode) {
    return (
      <main className={styles.page} role="alert">
        <div className={styles.shell}>
          <section className={styles.statusPanel} style={{ background: "var(--wd-surface)" }}>
            <h1 className={styles.statusTitle}>이야기를 안전하게 열지 못했어.</h1>
            <p className={styles.statusCopy}>저장된 학습 기록은 그대로야. 다음 장면을 준비하고 있어.</p>
            <Link href="/winddown" className={`${styles.button} ${styles.secondaryButton} ${styles.statusRetry} motion-reduce:transition-none`}>
              오늘 밤으로 돌아가기
            </Link>
          </section>
        </div>
      </main>
    );
  }

  const state = viewingState(episode, chapter, here, xp);
  const stateLabel = viewingStateLabel(state);
  const roleplayHref = state === "preview" ? null : storyRoleplayHref(episode);
  const chapterAct = WIND_DOWN_CONTENT_PACK.acts.find((act) => act.id === chapter.act);
  const progressPercent = Math.round(growth * 100);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.topbar} aria-label="월드 투어 이동">
          <Link href="/winddown" className={styles.backLink}>← 오늘 밤</Link>
          <span className={styles.brand}>WIND DOWN</span>
          <span className={styles.topContext}>{chapterAct?.tag ?? "ACT"} · {episode.location}</span>
        </nav>

        <header className={styles.heading} id="winddown-story-stage-heading" tabIndex={-1}>
          <p className={styles.eyebrow}>{chapterAct?.tag ?? "ACT"} · {chapterAct?.name ?? ""}</p>
          <h1 className={styles.title}>{episode.title}</h1>
          <p className={styles.location}>{episode.location} · {stateLabel} · 지금의 무대: {here.label}</p>
          {chosenCeremonies.length > 0 ? (
            <div className={styles.identityLine} aria-label="저장된 팀 이름">
              {chosenCeremonies.map((slot) => slot.choice ? (
                <span className={styles.identityItem} key={slot.id}>
                  <span className={styles.identityLabel}>{slot.label}</span>
                  <span className={styles.identityValue}>{slot.choice.label}</span>
                </span>
              ) : null)}
            </div>
          ) : null}
        </header>

        <div className={styles.stageGrid}>
          <section
            className={styles.stageColumn}
            aria-label={`${episode.title} 이야기 장면`}
            data-story-stage="true"
          >
            <WindDownStoryScene
              sceneKey={episode.sceneKey}
              title={episode.title}
              caption={episode.dialogue}
            />
          </section>

          <section className={styles.missionPanel} aria-label="오늘의 연습" data-story-mission="true">
            <div>
              <p className={styles.eyebrow}>TODAY'S PRACTICE</p>
              <h2 className={styles.missionHeading}>오늘의 연습</h2>
              <p className={styles.missionSetup}>{episode.setup}</p>
              <span className={styles.missionState}>{stateLabel}</span>
              <div className={styles.missionGuide}>
                <p className={styles.missionGuideLabel}>STORY GUIDE · 이야기 안내</p>
                <p className={styles.missionGuideName}>{member.name} · {member.roleLabel}</p>
                <p className={styles.missionGuideCopy}>{member.voice.greet}</p>
              </div>
            </div>
            <div>
              <p className={styles.missionObjective}>{episode.objective}</p>
              <div className={styles.missionActions}>
                {roleplayHref ? (
                  <Link href={roleplayHref} className={`${styles.button} ${styles.primaryButton} motion-reduce:transition-none`}>
                    연습 시작
                  </Link>
                ) : (
                  <span className={`${styles.button} ${styles.disabledButton}`} aria-disabled="true">
                    미리보기 · 연습은 아직 열리지 않았어
                  </span>
                )}
                <p className={styles.generalCopy}>마이크는 직접 시작해요.</p>
              </div>
            </div>
            <div className={styles.generalAction}>
              <div>
                <p className={styles.generalLabel}>오늘의 기본 연습</p>
                <p className={styles.generalCopy}>{generalPreparationCopy(habit.nextAction)}</p>
              </div>
              <Link href={action.href} className={styles.generalLink}>{action.label}</Link>
            </div>
          </section>

          <section className={styles.reading} aria-label="이야기 이어 읽기">
            <p className={styles.eyebrow}>STORY CONTINUATION</p>
            <h2 className={styles.sectionTitle}>이야기 이어 읽기</h2>
            <p className={styles.readingText}>{episode.reflection}</p>
            <p className={styles.readingNote}>성장 기록은 저장된 학습과 복습을 따라 이어져.</p>
            {episode.keepsake ? <span className={styles.keepsake}>이야기 속 기념물 · {episode.keepsake}</span> : null}
            <button
              type="button"
              className={`${styles.disclosure} motion-reduce:transition-none`}
              aria-expanded={dialogueOpen}
              onClick={() => setDialogueOpen((open) => !open)}
            >
              <span>대화와 영어 예시 보기</span>
              <span className={styles.disclosureMarker} aria-hidden="true">{dialogueOpen ? "−" : "+"}</span>
            </button>
            {dialogueOpen ? (
              <div className={styles.dialogueGrid}>
                <div className={styles.dialogueCard}>
                  <p className={styles.dialogueLabel}>DIALOGUE</p>
                  <p className={styles.dialogueText}>{episode.dialogue}</p>
                </div>
                <div className={styles.dialogueCard}>
                  <p className={styles.dialogueLabel}>ENGLISH EXAMPLE</p>
                  <p className={styles.dialogueText}>{episode.englishExample}</p>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <StoryJourney
          acts={WIND_DOWN_CONTENT_PACK.acts}
          chapters={WIND_DOWN_CONTENT_PACK.chapters}
          episodes={WIND_DOWN_STORY_EPISODES}
          xp={xp}
          currentChapterId={here.id}
          selectedEpisodeId={episode.id}
          onSelect={selectEpisode}
        />

        <section className={styles.ceremony} aria-label="우리의 이름">
          <p className={styles.eyebrow}>OUR STORY</p>
          <h2 className={styles.sectionTitle}>우리 팀의 기념 이름</h2>
          {chosenCeremonies.length > 0 ? (
            <ul className={styles.ceremonyChoices}>
              {chosenCeremonies.map((slot) => (
                <li key={slot.id} className={styles.choiceChip}>
                  {slot.label} · {slot.choice?.label}
                </li>
              ))}
            </ul>
          ) : null}
          {ceremonyUnavailable ? (
            <div>
              <p className={styles.readingText}>이름 후보를 지금 불러오지 못했어.</p>
              <p className={styles.ceremonyCopy}>학습과 투어 기록은 그대로야. 출판된 문장 자료가 다시 열리면 여기서 이어갈 수 있어.</p>
            </div>
          ) : openCeremony ? (
            <div>
              <p className={styles.readingNote}>학습 기록이 Lv.{openCeremony.unlockLevel}을 열었어</p>
              <h3 className={styles.missionObjective}>{openCeremony.label}을 정할 순간</h3>
              <p className={styles.ceremonyCopy}>
                {openCeremony.optionSource === "mastery-derived"
                  ? "모나가 여러 밤 복습에서 계속 다시 잡아낸 문장으로 만든 후보야. 한 번 정하면 공식 이름으로 남아."
                  : "아직 후보로 만들 숙달 문장이 부족해 첫 이름 후보를 준비했어. 한 번 정하면 공식 이름으로 남아."}
              </p>
              <div className={styles.ceremonyButtons}>
                {openCeremony.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={ceremonyStatus === "saving"}
                    onClick={() => void commitCeremony(
                      openCeremony.id,
                      option.id,
                      openCeremony.label,
                    )}
                    className={styles.ceremonyButton}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : nextCeremony ? (
            <p className={styles.ceremonyCopy}>다음 이야기 · {nextCeremony.label}은 Lv.{nextCeremony.unlockLevel}에 열려.</p>
          ) : (
            <p className={styles.ceremonyCopy}>우리 팀의 공식 이야기가 모두 정해졌어.</p>
          )}
          <p aria-live="polite" className={styles.statusText}>
            {ceremonyStatus === "saving"
              ? `${ceremonyStatusSlotLabel}을 공식 이름으로 저장하는 중…`
              : ceremonyStatus === "conflict"
                ? `${ceremonyStatusSlotLabel}은 다른 화면에서 먼저 정해져 저장된 이름을 불러왔어.`
              : ceremonyStatus === "refreshed"
                ? `${ceremonyStatusSlotLabel} 후보가 갱신되어 최신 목록을 불러왔어.`
              : ceremonyStatus === "error"
                ? `${ceremonyStatusSlotLabel}을 저장하지 못했어. 연결을 확인하고 다시 눌러 줘.`
                : ""}
          </p>
        </section>

        <section className={styles.progress} aria-label="저장된 학습 진행">
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>SAVED LEARNING</p>
              <h2 className={styles.sectionTitle}>저장된 학습으로 나아가기</h2>
            </div>
            <span className={styles.missionState}>Lv.{level}</span>
          </div>
          <div className={styles.progressMeter} role="progressbar" aria-label="현재 무대 성장" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <i className={styles.progressMeterFill} style={{ width: `${progressPercent}%` }} />
          </div>
          <p className={styles.progressCopy}>
            {next
              ? `${next.label} 개방까지 Lv.${next.unlockLevel} · 매일 19 XP면 예상 약 ${forecast}일`
              : "마지막 장까지 열었어."}
          </p>
          <p className={styles.progressCopy}>
            {here.label} 성장 {Math.round(growth * 100)}% · 저장된 학습 기록이 쌓일 때 자라
          </p>
          <div className={styles.progressStats}>
            <div className={styles.progressStat}>
              <span className={styles.progressStatLabel}>저장된 문장</span>
              <span className={styles.progressStatValue}>{habit.game.creditedAnswerCount}</span>
            </div>
            <div className={styles.progressStat}>
              <span className={styles.progressStatLabel}>복습 별</span>
              <span className={styles.progressStatValue}>{habit.game.collectedReviewStarCount}</span>
            </div>
            <div className={styles.progressStat}>
              <span className={styles.progressStatLabel}>완료한 밤</span>
              <span className={styles.progressStatValue}>{habit.game.creditedNightCount}</span>
            </div>
          </div>
        </section>

        <nav className={styles.footer} aria-label="나의 학습 기록">
          <Link href="/winddown/conversations" className={styles.footerLink}>대화 보관함 <span aria-hidden="true">→</span></Link>
          <Link href="/winddown/records" className={styles.footerLink}>학습 기록 보관 <span aria-hidden="true">→</span></Link>
          <Link href="/winddown" className={styles.footerLink}>오늘 밤으로 돌아가기 <span aria-hidden="true">→</span></Link>
        </nav>
      </div>
    </main>
  );
}
