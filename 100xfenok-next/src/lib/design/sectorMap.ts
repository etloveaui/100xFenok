/**
 * Sector mapping SSOT — typed wrapper over sector-map.json.
 *
 * Canonical = 11 GICS-ish groups + "Other".
 * Consumable by both the TS app (import assertion) and plain-node build scripts (JSON parse).
 */
import sectorMapData from "./sector-map.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CanonicalSector = (typeof sectorMapData.canonical)[number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CANONICAL_SECTORS: readonly CanonicalSector[] =
  sectorMapData.canonical as readonly CanonicalSector[];

const gicsMap: Record<string, CanonicalSector> =
  sectorMapData.gicsToCanonical as Record<string, CanonicalSector>;

const scouterMap: Record<string, CanonicalSector> =
  sectorMapData.scouterToCanonical as Record<string, CanonicalSector>;

const colorMap: Record<CanonicalSector, string> =
  sectorMapData.colors as Record<CanonicalSector, string>;

const labelKoMap: Record<CanonicalSector, string> =
  sectorMapData.labelsKo as Record<CanonicalSector, string>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a Korean WICS-style raw sector label to a canonical GICS-ish group. */
export function mapScouterSector(
  raw: string | null | undefined,
): CanonicalSector {
  if (raw == null) return "Other";
  const trimmed = raw.trim();
  return scouterMap[trimmed] ?? "Other";
}

/** Return the CSS color for a canonical sector. */
export function sectorColor(c: CanonicalSector): string {
  return colorMap[c];
}

/** Return the Korean display label for a canonical sector. */
export function sectorLabelKo(c: CanonicalSector): string {
  return labelKoMap[c];
}

/**
 * Resolve a canonical sector from GICS and/or scouter raw labels.
 * Tries gicsToCanonical first (13F enrichment), then scouterToCanonical
 * (Korean WICS), falls back to "Other".
 */
export function resolveSector(
  gicsRaw?: string | null,
  scouterRaw?: string | null,
): CanonicalSector {
  if (gicsRaw != null) {
    const gics = gicsRaw.trim();
    if (gicsMap[gics] != null) return gicsMap[gics];
  }
  if (scouterRaw != null) {
    const scouter = scouterRaw.trim();
    if (scouterMap[scouter] != null) return scouterMap[scouter];
  }
  return "Other";
}
