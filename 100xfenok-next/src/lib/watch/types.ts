import type { DashboardSnapshot } from "@/lib/dashboard/types";

export type WatchableMetric =
  | "VIX"
  | "FG"
  | "SOFR"
  | "HY"
  | "SPY"
  | "QQQ"
  | "US10Y"
  | "BTC"
  | "CRYPTOFG";

export type MetricDef = {
  k: WatchableMetric;
  label: string;
  unit: string;
  get: (s: DashboardSnapshot) => number | null;
};

export type WatchOp = ">" | ">=" | "<" | "<=" | "=";

export type Watch = {
  id: string;
  metric: WatchableMetric;
  op: WatchOp;
  threshold: number;
  createdAt: string;
  pushEnabled: boolean;
};

export type Pin = {
  id: WatchableMetric;
  addedAt: string;
};

export type Alert = {
  id: string;
  watchId: string;
  metric: WatchableMetric;
  op: WatchOp;
  threshold: number;
  observed: number;
  firedAt: string;
  read: boolean;
};

export type WatchStorage = {
  pins: Pin[];
  watches: Watch[];
  alerts: Alert[];
};
