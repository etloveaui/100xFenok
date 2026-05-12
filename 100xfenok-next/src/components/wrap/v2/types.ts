export type WrapTone = "up" | "down" | "warn" | "flat";

export type MicroAxis = {
  label: string;
  value: number;
  tone: WrapTone;
  meta: string;
};

export type WrapChapter = {
  kicker: string;
  title: string;
  paragraphs: string[];
};

export type WrapAnchor = {
  id: number;
  kicker: string;
  sym: string;
  value: string;
  delta: string;
  tone: WrapTone;
  meta: string;
  spark: number[];
};

export type WrapKpi = { k: string; v: string; tone?: WrapTone };

export type WrapSection = {
  id: string;
  kicker: string;
  title: string;
  kpis: WrapKpi[];
  summary: string;
};

export type DailyWrap = {
  todayLabel: string;
  yesterdayLabel: string;
  regime: { label: string; tone: WrapTone; confidence: number };
  thesis: { headline: string; sub: string; tags: string[] };
  yesterdayLine: string;
  todayLine: string;
  microAxes: MicroAxis[];
  chapters: WrapChapter[];
  anchors: WrapAnchor[];
  sections: WrapSection[];
};

export type ArchiveEntry = {
  date: string;
  title: string;
  tags: string[];
  dayDelta: number;
};
