import {
  DEFAULT_LESSON_CONFIG,
  buildMonaCoachDynamicBlock,
  buildMonaCoachDynamicBlockV2,
  isLessonV2Enabled,
  pickLessonItemsV2,
  prepareMonaStudySnapshot,
} from "../src/lib/server/mona-study-tools.ts";

const STUDY_DATE = "2026-06-12";
const FRIDAY_ADVANCED_PLAN = {
  weekday: "금요일",
  theme: "회사·업무 심화",
  corner: "프리토킹",
};
const HARD_TRIO = new Set([
  "I'm way ahead of you.",
  "Not in the traditional sense.",
  "I'm finding it more demanding than I expected",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wordCount(value) {
  const cleaned = String(value).replace(/[^\w\s']/g, " ").trim();
  return cleaned ? cleaned.split(/\s+/).length : 0;
}

function signature(items) {
  return items.map((item) => `${item.theme}:${item.en}`).join("|");
}

const snapshot = await prepareMonaStudySnapshot(STUDY_DATE);
const first = pickLessonItemsV2(snapshot, STUDY_DATE, FRIDAY_ADVANCED_PLAN, DEFAULT_LESSON_CONFIG);
const second = pickLessonItemsV2(snapshot, STUDY_DATE, FRIDAY_ADVANCED_PLAN, DEFAULT_LESSON_CONFIG);

assert(first.length === 2, `expected 2 default items, got ${first.length}`);
assert(signature(first) === signature(second), "default picker is not deterministic");
assert(first.every((item) => wordCount(item.en) <= DEFAULT_LESSON_CONFIG.difficultyCap), "default picker exceeded word cap");
assert(first.every((item) => item.theme !== "work-advanced"), "default picker allowed work-advanced theme");
assert(first.every((item) => !HARD_TRIO.has(item.en)), "default picker included hard-trio item");

const advanced = pickLessonItemsV2(snapshot, STUDY_DATE, FRIDAY_ADVANCED_PLAN, {
  ...DEFAULT_LESSON_CONFIG,
  advancedDay: true,
});
assert(advanced.some((item) => item.theme === "work-advanced"), "advancedDay=true did not make work-advanced eligible");

const v2Block = await buildMonaCoachDynamicBlockV2(STUDY_DATE, snapshot);
assert(v2Block.includes("[7분 수업"), "v2 block missing lesson header");
assert(v2Block.includes("[CONTROL 규칙]"), "v2 block missing CONTROL rules");
assert(!v2Block.includes("R1 도입"), "v2 block still contains legacy R1 text");
assert(!v2Block.includes("오늘의 5문장"), "v2 block still contains legacy 5-sentence wording");
assert(!v2Block.includes("BEST3를 골라"), "v2 block still contains legacy BEST3 selection wording");

const previousFlag = process.env.MONA_LESSON_V2;
process.env.MONA_LESSON_V2 = "off";
assert(isLessonV2Enabled() === false, "MONA_LESSON_V2=off did not disable v2");
const legacyBlock = await buildMonaCoachDynamicBlock(STUDY_DATE, snapshot);
assert(legacyBlock.includes("[세션 구조"), "legacy block missing session structure");
if (previousFlag === undefined) {
  delete process.env.MONA_LESSON_V2;
} else {
  process.env.MONA_LESSON_V2 = previousFlag;
}

console.log(JSON.stringify({
  ok: true,
  studyDate: STUDY_DATE,
  defaultItems: first.map((item) => ({ theme: item.theme, en: item.en, words: wordCount(item.en) })),
  advancedItems: advanced.map((item) => ({ theme: item.theme, en: item.en, words: wordCount(item.en) })),
}, null, 2));
