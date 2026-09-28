/**
 * Versioned content and learner contracts for the WIND DOWN tour.
 */

import {
  WIND_DOWN_ACTS,
  WIND_DOWN_CHAPTERS,
  WIND_DOWN_REGIONS,
  type WindDownAct,
  type WindDownChapter,
  type WindDownRegion,
} from "@/features/winddown/game/model/tour";
import {
  WIND_DOWN_MEMBERS,
  type WindDownMember,
} from "@/features/winddown/game/model/roster";

export type WindDownContentPack = {
  readonly id: string;
  readonly version: string;
  readonly locale: string;
  readonly chapterCount: number;
  readonly acts: readonly WindDownAct[];
  readonly chapters: readonly WindDownChapter[];
  readonly regions: readonly WindDownRegion[];
  readonly members: readonly WindDownMember[];
  readonly sceneKeys: readonly string[];
};

export const WIND_DOWN_CONTENT_PACK: WindDownContentPack = {
  id: "wd-tour-core",
  version: "1.0.0",
  locale: "ko-KR",
  chapterCount: WIND_DOWN_CHAPTERS.length,
  acts: WIND_DOWN_ACTS,
  chapters: WIND_DOWN_CHAPTERS,
  regions: WIND_DOWN_REGIONS,
  members: WIND_DOWN_MEMBERS,
  sceneKeys: [...new Set(WIND_DOWN_CHAPTERS.map((chapter) => chapter.scene))],
};

export type WindDownLearnerProfile = {
  readonly id: string;
  /** Display name only; never a storage key. */
  readonly name: string;
  /** Stable deterministic seed owned by the learner profile. */
  readonly seed: number;
  readonly memberId: string;
};

export function isLearnerProfile(value: unknown): value is WindDownLearnerProfile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string"
    && candidate.id.length > 0
    && typeof candidate.name === "string"
    && typeof candidate.seed === "number"
    && Number.isFinite(candidate.seed)
    && typeof candidate.memberId === "string"
    && WIND_DOWN_CONTENT_PACK.members.some(
      (member) => member.id === candidate.memberId,
    )
  );
}

export const DEFAULT_LEARNER: WindDownLearnerProfile = {
  id: "mona",
  name: "모나",
  seed: 20260731,
  memberId: "luna",
};

export function isContentPackValid(pack: WindDownContentPack): boolean {
  const actIds = new Set(pack.acts.map((act) => act.id));
  const memberIds = new Set(pack.members.map((member) => member.id));
  return (
    pack.id.length > 0
    && pack.version.length > 0
    && pack.chapterCount === pack.chapters.length
    && pack.acts.length === 9
    && pack.chapters.length === 24
    && pack.regions.length === 12
    && memberIds.size === 4
    && pack.chapters.every(
      (chapter) =>
        actIds.has(chapter.act) && pack.sceneKeys.includes(chapter.scene),
    )
  );
}

export function memberForChapter(
  pack: WindDownContentPack,
  learner: WindDownLearnerProfile,
  chapterId: string,
): WindDownMember {
  const preferredIndex = Math.max(
    0,
    pack.members.findIndex((member) => member.id === learner.memberId),
  );
  const chapterIndex = Math.max(
    0,
    pack.chapters.findIndex((chapter) => chapter.id === chapterId),
  );
  const index = Math.abs(learner.seed + preferredIndex + chapterIndex)
    % pack.members.length;
  return pack.members[index] ?? WIND_DOWN_MEMBERS[0];
}
