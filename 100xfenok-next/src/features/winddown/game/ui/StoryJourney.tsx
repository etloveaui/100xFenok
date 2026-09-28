"use client";

import { useRef } from "react";
import type { WindDownAct, WindDownChapter } from "@/features/winddown/game/model/tour";
import { isChapterUnlocked } from "@/features/winddown/game/model/progress";
import {
  WIND_DOWN_STORY_EPISODES,
  storyEpisodeState,
} from "@/features/winddown/game/model/story";
import styles from "./artist-story.module.css";

type WindDownStoryEpisode = (typeof WIND_DOWN_STORY_EPISODES)[number];

type Props = {
  acts: readonly WindDownAct[];
  chapters: readonly WindDownChapter[];
  episodes: readonly WindDownStoryEpisode[];
  xp: number;
  currentChapterId: string;
  selectedEpisodeId: string;
  onSelect: (episode: WindDownStoryEpisode) => void;
};

function stateLabel(
  episode: WindDownStoryEpisode,
  xp: number,
  currentChapterId: string,
): string {
  if (storyEpisodeState(episode, xp) === "preview") return "미리보기";
  return episode.chapterId === currentChapterId ? "현재 무대" : "다시보기";
}

export default function StoryJourney({
  acts,
  chapters,
  episodes,
  xp,
  currentChapterId,
  selectedEpisodeId,
  onSelect,
}: Props) {
  const journeyRef = useRef<HTMLDetailsElement | null>(null);

  const selectAndClose = (episode: WindDownStoryEpisode) => {
    onSelect(episode);
    if (journeyRef.current) journeyRef.current.open = false;
  };

  return (
    <details ref={journeyRef} className={styles.journey} aria-label="우리의 아홉 막">
      <summary className={styles.journeySummary}>
        <span className={styles.journeySummaryCopy}>
          <span className={styles.eyebrow}>OUR JOURNEY</span>
          <span className={styles.sectionTitle}>우리의 투어</span>
        </span>
        <span className={styles.sectionHint}>모든 막을 열어 보고<br />현재 여정으로 돌아올 수 있어</span>
      </summary>
      <div className={styles.journeyBody}>
        <ol className={styles.actList}>
          {acts.map((act) => {
            const actEpisodes = episodes.filter((episode) =>
              chapters.find((chapter) => chapter.id === episode.chapterId)?.act === act.id,
            );
            return (
              <li className={styles.actBlock} key={act.id}>
                <div className={styles.actHeader}>
                  <h3 className={styles.actName}>{act.name}</h3>
                  <span className={styles.actTag}>{act.tag}</span>
                </div>
                <ul className={styles.episodeList}>
                  {actEpisodes.map((episode) => {
                    const state = stateLabel(episode, xp, currentChapterId);
                    const selected = episode.id === selectedEpisodeId;
                    const chapter = chapters.find((item) => item.id === episode.chapterId);
                    const legacyUnlocked = chapter ? isChapterUnlocked(chapter, xp) : false;
                    return (
                      <li key={episode.id}>
                        <button
                          type="button"
                          className={`${styles.episodeButton} ${selected ? styles.episodeButtonSelected : ""}`}
                          aria-pressed={selected}
                          data-story-episode-id={episode.id}
                          data-story-state={state}
                          onClick={() => selectAndClose(episode)}
                        >
                          <span className={styles.episodeTitle}>{episode.title}</span>
                          <span className={styles.episodeMeta}>
                            <span className={styles.episodeState}>{state}</span>
                            <span data-legacy-unlocked={legacyUnlocked ? "true" : "false"}>
                              {legacyUnlocked ? episode.location : `Lv.${chapter?.unlockLevel ?? "?"}`}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
}
