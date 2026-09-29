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

/** Cache each public feed independently, never the board's partial-failure state. */
export async function loadEventSurface(name: string, force = false): Promise<SurfaceDoc> {
  const url = `/api/data/stockanalysis/surfaces/${encodeURIComponent(name)}`;
  try {
    const { data } = await fetchJsonShared<SurfaceDoc>(url, { force, init: { cache: "no-store" } });
    if (!data || typeof data !== "object" || Array.isArray(data)
      || (!Array.isArray(data.records) && !Array.isArray(data.tables))) {
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
