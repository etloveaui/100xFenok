import { DataFetchError, fetchJsonShared, invalidateData } from "../client/data-fetch";

export interface SurfaceDoc<T = Record<string, unknown>> {
  surface?: string;
  fetched_at?: string | null;
  source_as_of?: string | null;
  source_as_of_reason?: string | null;
  counts?: Record<string, number | null | undefined> | null;
  records?: T[];
  tables?: Array<{ records?: T[] }>;
  load_failed?: boolean;
  status_code?: number;
}

const isRow = (row: unknown): row is Record<string, unknown> =>
  row !== null && typeof row === "object" && !Array.isArray(row);

function hasValidRows(data: SurfaceDoc): boolean {
  if (data.records !== undefined && (!Array.isArray(data.records) || !data.records.every(isRow))) return false;
  if (data.tables !== undefined && (!Array.isArray(data.tables)
    || !data.tables.every((table) => isRow(table) && Array.isArray(table.records) && table.records.every(isRow)))) return false;
  return Array.isArray(data.records) || Array.isArray(data.tables);
}

/** Cache each public feed independently, never the board's partial-failure state. */
export async function loadEventSurface(name: string, force = false): Promise<SurfaceDoc> {
  const url = `/api/data/stockanalysis/surfaces/${encodeURIComponent(name)}`;
  try {
    const { data } = await fetchJsonShared<SurfaceDoc>(url, { force, init: { cache: "no-store" } });
    if (!data || typeof data !== "object" || Array.isArray(data)
      || !hasValidRows(data) || (data.surface !== undefined && data.surface !== name)) {
      invalidateData(url);
      return { surface: name, load_failed: true };
    }
    // Some API paths report an unavailable surface with HTTP 200.
    if (data.load_failed) invalidateData(url);
    return { ...data, surface: data.surface ?? name };
  } catch (error) {
    return {
      surface: name,
      load_failed: true,
      ...(error instanceof DataFetchError && error.status !== null ? { status_code: error.status } : {}),
    };
  }
}
