// Types for freshness-policy.mjs (DEC-417). The module stays plain .mjs so
// Node scripts can import it; TypeScript reads these declarations instead of
// inferring plain `string` for the verdict and rail states.

export type FreshnessCadence = "daily" | "weekly" | "monthly" | "quarterly" | "annual";
export type FreshnessSupplier = "owner" | "automated";
export type FreshnessCalendar = "us_trading" | "kr_trading" | "calendar";
export type FreshnessState = "fresh" | "delayed" | "stopped" | "unknown";

export type FreshnessClass = {
  readonly cycleDays: number;
  readonly graceDays: number;
  readonly tradingDays: boolean;
};

export type FamilyPolicy = {
  readonly cadence: FreshnessCadence;
  readonly releaseLagDays: number;
  readonly supplier: FreshnessSupplier;
  readonly calendar: FreshnessCalendar;
  readonly label?: string;
};

export type FreshnessVerdict = {
  state: FreshnessState;
  ageDays: number | null;
  supplier: FreshnessSupplier | null;
  cadence: FreshnessCadence | null;
};

/** Any verdict-shaped value; only `state` is required (tests pass partial literals). */
export type FreshnessVerdictLike = Pick<FreshnessVerdict, "state"> & Partial<Omit<FreshnessVerdict, "state">>;

/** EvidenceRail-compatible state plus the verdict's own wording. */
export type FreshnessRail = {
  freshness: "fresh" | "stale" | "error";
  label: string | null;
};

export declare const FRESHNESS_CLASSES: Readonly<Record<FreshnessCadence, FreshnessClass>>;
export declare const FAMILY_POLICY: Readonly<Record<string, FamilyPolicy>>;

export declare function todayKST(now?: Date): string;
export declare function dateOnly(value: unknown): string | null;
export declare function ageInDays(asOf: string, today: string): number;
export declare function ageInTradingDays(asOf: string, today: string): number;
export declare function resolveFamilyPolicy(family: string | FamilyPolicy | null | undefined): FamilyPolicy | null;
export declare function freshnessVerdict(
  asOf: string | null | undefined,
  family: string | FamilyPolicy | null | undefined,
  today?: string,
): FreshnessVerdict;
export declare function freshnessMessage(verdict: FreshnessVerdictLike | null | undefined): string | null;
export declare function freshnessRailState(verdict: FreshnessVerdictLike | null | undefined): FreshnessRail | null;
export declare function freshnessAgeOverride(verdict: FreshnessVerdictLike | null | undefined): FreshnessRail | null;
