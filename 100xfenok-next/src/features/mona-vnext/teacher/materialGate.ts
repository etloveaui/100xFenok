import type {
  TeacherMaterialCandidate,
  TeacherMaterialGateResult,
  TeacherMaterialQuarantineEntry,
  TeacherMaterialWarningEntry,
  TeacherSessionCard,
} from "./teacherSession";

const CONTAMINATED_TRIED = ["hold up", "hola"];

const KO_EN_CONTENT_MARKERS: Array<{ ko: RegExp; en: RegExp; reason: string }> = [
  { ko: /우리|우린|우리는/, en: /\b(we|us|our|ours)\b/i, reason: "semantic_missing_we" },
  { ko: /나|내|나는|내가|저|제가/, en: /\b(i|me|my|mine)\b/i, reason: "semantic_missing_i" },
  { ko: /너|네|니|당신/, en: /\b(you|your|yours)\b/i, reason: "semantic_missing_you" },
  { ko: /비/, en: /\b(rain|raining|rainy)\b/i, reason: "semantic_missing_rain" },
  { ko: /아직|아직도/, en: /\b(still|yet)\b/i, reason: "semantic_missing_still" },
  { ko: /필요/, en: /\b(need|needs|needed)\b/i, reason: "semantic_missing_need" },
  { ko: /다시|또/, en: /\b(again|another|reconsider|still)\b/i, reason: "semantic_missing_again" },
  { ko: /말이\s*되|말이\s*됐/, en: /\b(makes?\s+sense|made\s+sense)\b/i, reason: "semantic_missing_make_sense" },
  { ko: /좋겠|바라|희망/, en: /\b(hope|wish)\b/i, reason: "semantic_missing_hope" },
  { ko: /잠깐|기다/, en: /\b(wait|hold|second|moment)\b/i, reason: "semantic_missing_wait" },
  { ko: /생각|결정/, en: /\b(think|thought|decision|decide|reconsider|review)\b/i, reason: "semantic_missing_thought" },
];

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function countEnglishWords(value: string) {
  const words = value.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g);
  return words?.length ?? 0;
}

function hasHangul(value: string) {
  return /[가-힣]/.test(value);
}

function hasKoreanSentenceShape(value: string) {
  const trimmed = normalizeText(value);
  return trimmed.length >= 4 && hasHangul(trimmed) && !/[{}[\]<>]/.test(trimmed);
}

function hasRegisterClash(value: string) {
  const compact = value.replace(/\s+/g, "");
  return /(우리|우린|우리는).*(세요|습니까|하십니까|해요\?)/.test(compact)
    || /(나는|내가|나).*(세요|습니까|하십니까)/.test(compact);
}

function semanticParityReasons(ko: string, targetEn: string) {
  const reasons: string[] = [];
  for (const marker of KO_EN_CONTENT_MARKERS) {
    if (marker.ko.test(ko) && !marker.en.test(targetEn)) {
      reasons.push(marker.reason);
    }
  }
  return reasons;
}

function isContaminatedTried(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return CONTAMINATED_TRIED.some((needle) => normalized.includes(needle));
}

function cloneAcceptedCard(candidate: TeacherMaterialCandidate): TeacherSessionCard {
  return {
    expressionId: candidate.expressionId,
    ko: candidate.ko,
    targetEn: candidate.targetEn,
    acceptedVariants: [...candidate.acceptedVariants],
    difficulty: candidate.difficulty,
    exposureCount: candidate.exposureCount ?? 0,
  };
}

function cloneQuarantine(candidate: TeacherMaterialCandidate, reasons: string[]): TeacherMaterialQuarantineEntry {
  return {
    ...candidate,
    acceptedVariants: [...candidate.acceptedVariants],
    tried: candidate.tried ? [...candidate.tried] : undefined,
    reasons,
  };
}

function cloneWarning(candidate: TeacherMaterialCandidate, reasons: string[]): TeacherMaterialWarningEntry {
  return {
    ...candidate,
    acceptedVariants: [...candidate.acceptedVariants],
    tried: candidate.tried ? [...candidate.tried] : undefined,
    reasons,
  };
}

export function validateTeacherMaterial(candidates: TeacherMaterialCandidate[]): TeacherMaterialGateResult {
  const accepted: TeacherSessionCard[] = [];
  const quarantine: TeacherMaterialQuarantineEntry[] = [];
  const warnings: TeacherMaterialWarningEntry[] = [];

  for (const candidate of candidates) {
    const blockingReasons: string[] = [];
    const warningReasons: string[] = [];
    const ko = normalizeText(candidate.ko);
    const targetEn = normalizeText(candidate.targetEn);
    const wordCount = countEnglishWords(targetEn);

    if (candidate.grounded !== true) warningReasons.push("not_grounded");
    if (candidate.verifiedInSource !== true) warningReasons.push("not_verified_in_source");
    if (!Number.isFinite(candidate.difficulty) || candidate.difficulty > 2) warningReasons.push("difficulty_gt_2");
    if (wordCount === 0 || wordCount > 10) warningReasons.push("word_count_gt_10");
    if (!hasKoreanSentenceShape(ko)) blockingReasons.push("ko_sentence_invalid");
    if (hasRegisterClash(ko)) blockingReasons.push("ko_register_clash");
    warningReasons.push(...semanticParityReasons(ko, targetEn));

    if ((candidate.tried ?? []).some(isContaminatedTried)) {
      blockingReasons.push("contaminated_tried");
    }

    const uniqueBlockingReasons = Array.from(new Set(blockingReasons));
    const uniqueWarningReasons = Array.from(new Set(warningReasons));
    if (uniqueWarningReasons.length > 0) {
      warnings.push(cloneWarning(candidate, uniqueWarningReasons));
    }

    if (uniqueBlockingReasons.length > 0) {
      quarantine.push(cloneQuarantine(candidate, uniqueBlockingReasons));
    } else {
      accepted.push(cloneAcceptedCard(candidate));
    }
  }

  return { accepted, quarantine, warnings };
}
