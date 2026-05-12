export type ScoutTone = "up" | "down" | "warn" | "flat";
export type CoverTone = "navy" | "blue" | "gold";
export type CoverPattern = "data" | "gradient" | "minimal";
export type PickKind = "value" | "momentum" | "institution";

export type Pick = {
  kind: PickKind;
  ticker: string;
  name: string;
  note: string;
};

export type IssueCover = {
  tone: CoverTone;
  accent: string;
  pattern: CoverPattern;
  spark: number[];
};

export type Issue = {
  id: number;
  slug: string;
  date: string;
  dateLabel: string;
  monthKey: string;
  monthLabel: string;
  tag?: string;
  kicker: string;
  headline: string;
  dek: string;
  readMin: number;
  tags: string[];
  picks: Pick[];
  cover: IssueCover;
};

export type ScoutChapter = {
  id: string;
  kicker: string;
  title: string;
  paragraphs: string[];
};

export type ScoutAnchor = {
  id: number;
  kicker: string;
  sym: string;
  value: string;
  delta: string;
  tone: ScoutTone;
  meta: string;
  spark: number[];
};

export type Article = Issue & {
  issueLabel: string;
  chapters: ScoutChapter[];
  anchors: ScoutAnchor[];
  related: number[];
};
