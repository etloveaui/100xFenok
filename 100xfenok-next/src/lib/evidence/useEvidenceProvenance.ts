"use client";
import * as React from "react";
import { PROVENANCE_URLS, fetchProvenanceJson } from "./provenance";

export function useEvidenceProvenance(): {
  kpi: unknown;
  laneProjection: unknown;
} {
  const [kpi, setKpi] = React.useState<unknown>(null);
  const [laneProjection, setLaneProjection] = React.useState<unknown>(null);
  React.useEffect(() => {
    let cancelled = false;
    fetchProvenanceJson<unknown>(PROVENANCE_URLS.kpi).then((doc) => {
      if (!cancelled && doc) setKpi(doc);
    });
    fetchProvenanceJson<unknown>(PROVENANCE_URLS.lanes).then((doc) => {
      if (!cancelled && doc) setLaneProjection(doc);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { kpi, laneProjection };
}
