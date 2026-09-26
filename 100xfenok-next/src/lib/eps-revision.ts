import { formatMoney } from "./format";

/**
 * One weekly FY+1 EPS consensus revision as the revision-movers feed carries it.
 *
 * `change_1w` is (now - prior) / |prior|, so its sign always follows the
 * direction of the revision. When the estimate crosses zero the ratio stops
 * describing the size of the move (281 -> -2,454 is "-973%"), so readers show
 * the turn itself and the two estimates instead of the ratio.
 */

export type EpsSignFlip = "to-loss" | "to-profit";

export const EPS_SIGN_FLIP_LABEL: Record<EpsSignFlip, string> = {
  "to-loss": "적자 전환",
  "to-profit": "흑자 전환",
};

export type EpsRevision = {
  before: number | null;
  after: number | null;
  flip: EpsSignFlip | null;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function epsSignFlip(before: number | null, after: number | null): EpsSignFlip | null {
  if (before === null || after === null) return null;
  if (before > 0 && after < 0) return "to-loss";
  if (before < 0 && after > 0) return "to-profit";
  return null;
}

/** Reads `eps_fy1` / `eps_fy1_prev` off one feed row; feeds built before the prior week was published carry no `eps_fy1_prev`. */
export function readEpsRevision(row: Record<string, unknown>): EpsRevision {
  const after = finite(row.eps_fy1);
  const before = finite(row.eps_fy1_prev);
  return { before, after, flip: epsSignFlip(before, after) };
}

/** Signed 1w change for display: the turn itself when the estimate crossed zero. */
export function formatEpsRevisionChange(change: number, flip: EpsSignFlip | null): string {
  if (flip) return EPS_SIGN_FLIP_LABEL[flip];
  const prefix = change > 0 ? "+" : change < 0 ? "-" : "";
  return `${prefix}${Math.abs(change * 100).toFixed(1)}%`;
}

/**
 * Yahoo listing suffix -> ISO currency, decided by listing market. The feed's
 * universe today spans .KS/.KQ, .T, .SS/.SZ, .HK, .TW, .DE and .PA besides US
 * names; the other markets are here so a new listing does not print as "$".
 * A bare ticker or a US share class (BRK.B) is a US listing.
 */
const LISTING_CURRENCY: Record<string, string> = {
  KS: "KRW",
  KQ: "KRW",
  T: "JPY",
  SS: "CNY",
  SZ: "CNY",
  HK: "HKD",
  TW: "TWD",
  TWO: "TWD",
  L: "GBP",
  DE: "EUR",
  F: "EUR",
  PA: "EUR",
  AS: "EUR",
  MI: "EUR",
  MC: "EUR",
  BR: "EUR",
  LS: "EUR",
  HE: "EUR",
  VI: "EUR",
  IR: "EUR",
  SW: "CHF",
  ST: "SEK",
  CO: "DKK",
  OL: "NOK",
  TO: "CAD",
  AX: "AUD",
  SI: "SGD",
  NS: "INR",
  BO: "INR",
};

export function listingCurrency(ticker: string): string {
  const suffix = /\.([A-Z]{1,3})$/.exec(ticker.toUpperCase())?.[1];
  return (suffix && LISTING_CURRENCY[suffix]) || "USD";
}

export function formatEps(value: number | null, ticker: string): string {
  return value === null ? "—" : formatMoney(value, listingCurrency(ticker));
}
