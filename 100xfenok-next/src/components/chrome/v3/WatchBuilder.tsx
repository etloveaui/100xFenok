"use client";

import { useEffect, useState } from "react";
import { METRIC_DEFS, PRESET_WATCHES } from "@/lib/watch/metrics";
import type { Watch, WatchOp, WatchableMetric } from "@/lib/watch/types";

type Props = {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
  onCreate: (watch: Watch) => void;
};

const OPS: WatchOp[] = [">", ">=", "<", "<=", "="];

export default function WatchBuilder({
  open,
  initialQuery,
  onClose,
  onCreate,
}: Props) {
  const [metric, setMetric] = useState<WatchableMetric>("VIX");
  const [op, setOp] = useState<WatchOp>(">");
  const [threshold, setThreshold] = useState<string>("25");
  const [pushEnabled, setPushEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!initialQuery) return;
    // initialQuery is intentionally a hint — keep current builder state
    // unless the parser pre-resolved it. The parent (NavbarV3 Cmd+K) is
    // responsible for calling onCreate directly when the query parses.
  }, [initialQuery]);

  if (!open) return null;

  const numericThreshold = Number(threshold);
  const valid = !Number.isNaN(numericThreshold) && Number.isFinite(numericThreshold);

  const submit = () => {
    if (!valid) return;
    const watch: Watch = {
      id: `${metric}-${op}-${numericThreshold}-${Date.now()}`,
      metric,
      op,
      threshold: numericThreshold,
      createdAt: new Date().toISOString(),
      pushEnabled,
    };
    onCreate(watch);
    onClose();
  };

  return (
    <div className="hp-watchbuilder-backdrop" onClick={onClose} role="presentation">
      <div
        className="hp-watchbuilder"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Watch 만들기"
      >
        <div className="hp-watchbuilder__head">
          <span className="hp-watchbuilder__title">+ 새 Watch 만들기</span>
          <button
            type="button"
            className="hp-watchbuilder__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="hp-watchbuilder__section">
          <div className="hp-watchbuilder__label">PRESETS</div>
          <div>
            {PRESET_WATCHES.map((preset) => (
              <button
                key={`${preset.metric}-${preset.op}-${preset.threshold}`}
                type="button"
                className="hp-watchbuilder__preset"
                onClick={() => {
                  setMetric(preset.metric);
                  setOp(preset.op);
                  setThreshold(String(preset.threshold));
                }}
              >
                {preset.hint}
              </button>
            ))}
          </div>
        </div>

        <div className="hp-watchbuilder__section">
          <div className="hp-watchbuilder__label">CONDITION</div>
          <div className="hp-watchbuilder__row">
            <select
              value={metric}
              onChange={(event) => setMetric(event.target.value as WatchableMetric)}
              aria-label="지표"
            >
              {METRIC_DEFS.map((def) => (
                <option key={def.k} value={def.k}>
                  {def.label}
                </option>
              ))}
            </select>
            <select
              value={op}
              onChange={(event) => setOp(event.target.value as WatchOp)}
              aria-label="연산자"
            >
              {OPS.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              aria-label="임계치"
            />
          </div>
        </div>

        <div className="hp-watchbuilder__section">
          <div className="hp-watchbuilder__label">CHANNEL</div>
          <label
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
          >
            <input
              type="checkbox"
              checked={pushEnabled}
              onChange={(event) => setPushEnabled(event.target.checked)}
            />
            브라우저 푸시 (지원 시) + Alert Inbox
          </label>
        </div>

        <div className="hp-watchbuilder__section" style={{ textAlign: "right" }}>
          <button
            type="button"
            className="hp-watchbuilder__submit"
            onClick={submit}
            disabled={!valid}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
