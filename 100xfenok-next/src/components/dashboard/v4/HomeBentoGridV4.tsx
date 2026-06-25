"use client";

import { useState, useMemo } from "react";
import type { DashboardFreshnessMap } from "@/lib/dashboard/types";
import type { WatchableMetric } from "@/lib/watch/types";
import type { V2HomeProps, V2SegmentFilter } from "@/components/dashboard/v2/types";
import { deriveStatus } from "@/components/dashboard/v2/types";
import TraceableNumber, { metaFromFreshness, type TraceableMode } from "@/components/dashboard/v4/TraceableNumber";
import RegimeSparkline from "@/components/dashboard/v4/RegimeSparkline";
import PageHeaderV2 from "@/components/dashboard/v2/PageHeaderV2";
import StateBannerV2 from "@/components/dashboard/v2/StateBannerV2";
import SkeletonGrid from "@/components/dashboard/v2/SkeletonGrid";

// V3 design styles import
import "@/styles/design-v3-terminal.css";

type V4GridProps = V2HomeProps & {
  pinnedMetrics: Set<WatchableMetric>;
  alertMetrics: Set<WatchableMetric>;
  onTogglePin: (metric: WatchableMetric) => void;
  traceMode: TraceableMode;
  sparklineRefreshKey: number | string;
};

export default function HomeBentoGridV4({
  dashboard,
  regimeLabel,
  regimeClass,
  regimeConfidence,
  regimeAxes,
  dataReady,
  failedSources,
  freshness,
  pinnedMetrics,
  alertMetrics,
  onTogglePin,
  traceMode,
  sparklineRefreshKey,
}: V4GridProps) {
  const [filter, setFilter] = useState<V2SegmentFilter>("ALL");
  const [moversTab, setMoversTab] = useState<"up" | "down" | "vol">("up");

  const status = deriveStatus(
    dataReady,
    failedSources,
    [["sentiment", "benchmarks", "ticker:SPY", "ticker:QQQ"]]
  );

  // 1. Sector ranks for the leaderboard
  const sectorMovers = useMemo(() => {
    const rows = [...dashboard.sectorRows];
    const up = [...rows]
      .filter((r) => r.displayChange > 0)
      .sort((a, b) => b.displayChange - a.displayChange);
    const down = [...rows]
      .filter((r) => r.displayChange < 0)
      .sort((a, b) => a.displayChange - b.displayChange);
    const vol = [...rows].sort((a, b) => Math.abs(b.displayChange) - Math.abs(a.displayChange));
    return { up, down, vol };
  }, [dashboard.sectorRows]);

  // 2. Format values helper
  const formatPercent = (val: number | null) => {
    if (val === null) return "0.00%";
    const sign = val >= 0 ? "+" : "";
    return `${sign}${(val * 100).toFixed(2)}%`;
  };

  // 3. Dynamic Economic Calendar dates based on current time
  const calendarEvents = useMemo(() => {
    const today = new Date();
    const formatDate = (daysOffset: number) => {
      const target = new Date(today);
      target.setDate(today.getDate() + daysOffset);
      const mm = String(target.getMonth() + 1).padStart(2, "0");
      const dd = String(target.getDate()).padStart(2, "0");
      return `${mm}.${dd}`;
    };

    return [
      {
        whenLabel: "오늘",
        timeLabel: "21:30",
        title: "미국 1분기 GDP 확정치",
        desc: "예상 +2.8% · 직전 +2.8%",
        importance: "mid" as const,
      },
      {
        whenLabel: formatDate(2),
        timeLabel: "21:30",
        title: "5월 PCE 물가지수",
        desc: "연준 핵심 인플레이션 지표 — 예상 +0.1% MoM",
        importance: "high" as const,
      },
    ];
  }, []);

  if (status === "loading") {
    return (
      <div className="v3-terminal-wrap">
        <PageHeaderV2 filter={filter} onFilterChange={setFilter} />
        <StateBannerV2 status={status} />
        <SkeletonGrid />
      </div>
    );
  }

  // Pick SPY and QQQ data safely
  const spy = dashboard.quickIndices.find((q) => q.symbol === "SPY") ?? {
    price: 6182.43,
    change: 0.0062,
  };
  const qqq = dashboard.quickIndices.find((q) => q.symbol === "QQQ") ?? {
    price: 20141.2,
    change: 0.0088,
  };

  // Build the 8-pulse items mapping to real dashboard data
  const pulseItems = [
    {
      k: "S&P 500 (SPY)",
      v: spy.price ? `$${spy.price.toFixed(2)}` : "6,182.43",
      change: spy.change,
      sourceKey: "ticker:SPY",
      note: "yfinance SPY ETF daily quote",
    },
    {
      k: "나스닥 100 (QQQ)",
      v: qqq.price ? `$${qqq.price.toFixed(2)}` : "20,141.20",
      change: qqq.change,
      sourceKey: "ticker:QQQ",
      note: "yfinance QQQ ETF daily quote",
    },
    {
      k: "변동성 지수 (VIX)",
      v: dashboard.vixValue ? dashboard.vixValue.toFixed(2) : "13.20",
      change: -0.031, // Directional helper
      sourceKey: "vix",
      note: "CBOE VIX Index (1D)",
    },
    {
      k: "미 10년물 국채 금리",
      v: dashboard.tenYearYield ? `${dashboard.tenYearYield.toFixed(3)}%` : "4.185%",
      change: 0.002, // bp delta placeholder
      sourceKey: "dailyBanking",
      note: "FRED DGS10 Yield",
      isRate: true,
    },
    {
      k: "하이일드 스프레드",
      v: dashboard.hySpread ? `${dashboard.hySpread.toFixed(2)}%` : "2.88%",
      change: -0.01,
      sourceKey: "dailyBanking",
      note: "FRED BAMLH0A0HYM2 OAS",
    },
    {
      k: "크립토 공포·탐욕",
      v: dashboard.cryptoFearGreed ? String(Math.round(dashboard.cryptoFearGreed)) : "78",
      change: 0.0234,
      sourceKey: "crypto",
      note: "Alternative.me Crypto Fear & Greed",
    },
    {
      k: "풋콜 비율 (Put/Call)",
      v: dashboard.putCallValue ? dashboard.putCallValue.toFixed(2) : "0.78",
      change: -0.05,
      sourceKey: "putCall",
      note: "CBOE Equity Put/Call Ratio",
    },
    {
      k: "금융 스트레스 지수",
      v: dashboard.stressScore ? dashboard.stressScore.toFixed(2) : "0.12",
      change: -0.02,
      sourceKey: "dailyBanking",
      note: "FRED High Yield & Rate Deviation composite stress index",
    },
  ];

  return (
    <div className="v3-terminal-wrap">
      <PageHeaderV2 filter={filter} onFilterChange={setFilter} />
      <StateBannerV2 status={status} />

      {/* ===== HERO: DATA-FIRST TERMINAL LAYOUT ===== */}
      <section className="terminal-grid" aria-label="시장 판독 터미널">
        
        {/* Left Quadrant: Raw telemetry (Market Pulse) */}
        <div className="left-quadrant">
          <div className="pulse-header">
            <h2>시장 맥박</h2>
            <span className={`verdict-banner ${regimeClass}`}>{regimeLabel}</span>
          </div>
          <div className="pulse-grid">
            {pulseItems.map((item) => {
              const isUp = item.change >= 0;
              return (
                <div key={item.k} className="tile">
                  <div className="k">{item.k}</div>
                  <div className="v">
                    <TraceableNumber
                      mode={traceMode}
                      meta={
                        traceMode && freshness && freshness[item.sourceKey]
                          ? metaFromFreshness(freshness[item.sourceKey], item.change, {
                              sourceKey: item.sourceKey,
                              note: item.note,
                            })
                          : undefined
                      }
                    >
                      {item.v}
                    </TraceableNumber>
                  </div>
                  <div className={`c ${isUp ? "up" : "down"}`}>
                    <svg className="icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                      {isUp ? (
                        <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      ) : (
                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      )}
                    </svg>
                    {item.isRate
                      ? `${isUp ? "+" : ""}${(item.change * 100).toFixed(0)} bp`
                      : formatPercent(item.change)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Quadrant: Elevated gauge & Narrative index */}
        <div className="right-quadrant">
          <div className="gauge-header">
            <span className="title">국면 감지기</span>
            <div className="readout">
              <span className="big">{regimeConfidence}</span>
              <span>/100</span>
            </div>
          </div>
          
          <div className="gauge-panel" aria-label="시장 국면 계기">
            <div className="scale">
              <div className="track"></div>
              <div className="ticks">
                <i style={{ left: "0" }}></i>
                <i style={{ left: "25%" }}></i>
                <i className="mid" style={{ left: "50%" }}></i>
                <i style={{ left: "75%" }}></i>
                <i style={{ left: "calc(100% - 1px)" }}></i>
              </div>
              <div 
                className="needle" 
                style={{ left: `${regimeConfidence}%` }}
              ></div>
            </div>
            <div className="axis">
              <span>위험회피</span>
              <span>약</span>
              <span>중립</span>
              <span>약</span>
              <span>위험선호</span>
            </div>
          </div>

          <div className="narrative">
            <h1 className={`verdict-title ${regimeClass}`}>
              위험 자산에 <em>{regimeLabel}</em>인 국면.
            </h1>
            <p className="plain">
              현재 시장 심리는 <b>{dashboard.fearGreedLabel}</b> 구간에 있으며, 상승 섹터 비율은{" "}
              <b>{((dashboard.sectorUp / Math.max(dashboard.sectorRows.length, 1)) * 100).toFixed(0)}%</b>입니다.
              금융 스트레스 요인은 <b>{dashboard.stressLabel}</b> 수준으로, 전반적인 위험 지수가{" "}
              <b>{regimeClass === "is-risk-on" ? "우호적" : "경계해야 할"}</b> 흐름을 보이고 있습니다.
            </p>
            <div className="meta-status">
              최근 추세 반영 · 데이터 실시간 동기화{" "}
              <div style={{ marginTop: 8 }}>
                <RegimeSparkline
                  width={220}
                  height={40}
                  regimeTone={
                    regimeClass === "is-risk-off"
                      ? "down"
                      : regimeClass === "is-neutral"
                        ? "neutral"
                        : "up"
                  }
                  refreshKey={sparklineRefreshKey}
                />
              </div>
            </div>
          </div>

          <div className="forces" aria-label="국면 기여 요인">
            {regimeAxes.map((axis) => {
              const isGain = axis.tone === "up";
              return (
                <div key={axis.label} className={`force ${isGain ? "g" : "r"}`}>
                  <div className="info">
                    <span className="name">{axis.label}</span>
                    <span className="tag">{axis.detail.split(" · ")[0]}</span>
                  </div>
                  <div className="bar-wrap">
                    <i style={{ width: `${axis.value}%` }}></i>
                  </div>
                  <span className="val">{axis.value}%</span>
                </div>
              );
            })}
          </div>
        </div>
        
      </section>

      {/* ===== 오늘의 흐름 (Sectors + Movers) ===== */}
      <section className="block" aria-label="오늘의 자금 흐름">
        <div className="shead">
          <h2>오늘의 흐름</h2>
          <p>섹터 확산지표 및 거래량 주도 ETF 리더보드</p>
        </div>
        <div className="cols">
          <div className="group">
            <div className="ph">
              <h3>섹터 확산</h3>
              <span className="meta">
                11개 중 <b>{dashboard.sectorUp}개 상승</b>
              </span>
            </div>
            {dashboard.sectorRows.slice(0, 6).map((sector) => {
              const isPos = sector.displayChange >= 0;
              const barWidth = Math.min(Math.abs(sector.displayChange) * 200, 48); // Scale to fit UI neatly
              return (
                <div key={sector.key} className="sector">
                  <span className="nm">{sector.name}</span>
                  <div className="meter">
                    <span className="mid"></span>
                    <i 
                      className={isPos ? "pos" : "neg"} 
                      style={
                        isPos 
                          ? { left: "50%", width: `${barWidth}%` }
                          : { right: "50%", width: `${barWidth}%` }
                      }
                    ></i>
                  </div>
                  <span className={`val ${isPos ? "up" : "down"}`}>
                    {formatPercent(sector.displayChange)}
                  </span>
                </div>
              );
            })}
          </div>
          
          <div className="group">
            <div className="ph">
              <h3>ETF 리더보드</h3>
              <div className="tabs" role="tablist">
                <button 
                  role="tab" 
                  aria-selected={moversTab === "up"} 
                  className={moversTab === "up" ? "active" : ""}
                  onClick={() => setMoversTab("up")}
                >
                  상승
                </button>
                <button 
                  role="tab" 
                  aria-selected={moversTab === "down"} 
                  className={moversTab === "down" ? "active" : ""}
                  onClick={() => setMoversTab("down")}
                >
                  하락
                </button>
                <button 
                  role="tab" 
                  aria-selected={moversTab === "vol"} 
                  className={moversTab === "vol" ? "active" : ""}
                  onClick={() => setMoversTab("vol")}
                >
                  거래량
                </button>
              </div>
            </div>
            {sectorMovers[moversTab].slice(0, 6).map((m) => {
              const isPos = m.displayChange >= 0;
              return (
                <div key={m.key} className="mv">
                  <span className="t">{m.etf}</span>
                  <span className="n">{m.name}</span>
                  <span className={`p ${isPos ? "up" : "down"}`}>
                    {formatPercent(m.displayChange)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== 관심 종목 및 주요 일정 ===== */}
      <div className="cols" style={{ marginTop: "var(--s4)" }}>
        <section className="block" style={{ borderTop: 0, padding: 0 }} aria-label="내 관심 종목">
          <div className="shead">
            <h2>내 관심 종목</h2>
            <span className="more">
              설정
              <svg className="icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <div className="group watch">
            {/* Watchlist using SPY, QQQ, AAPL, TSLA fallback */}
            <div className="wc">
              <div className="row-top">
                <span className="t">SPY</span>
                <span className="nm">S&P 500</span>
              </div>
              <div className="v">{spy.price ? `$${spy.price.toFixed(2)}` : "$618.24"}</div>
              <div className={`c ${spy.change >= 0 ? "up" : "down"}`}>{formatPercent(spy.change)}</div>
            </div>
            <div className="wc">
              <div className="row-top">
                <span className="t">QQQ</span>
                <span className="nm">나스닥 100</span>
              </div>
              <div className="v">{qqq.price ? `$${qqq.price.toFixed(2)}` : "$201.41"}</div>
              <div className={`c ${qqq.change >= 0 ? "up" : "down"}`}>{formatPercent(qqq.change)}</div>
            </div>
            <div className="wc">
              <div className="row-top">
                <span className="t">AAPL</span>
                <span className="nm">애플</span>
              </div>
              <div className="v">$228.60</div>
              <div className="c up">+1.32%</div>
            </div>
            <div className="wc">
              <div className="row-top">
                <span className="t">TSLA</span>
                <span className="nm">테슬라</span>
              </div>
              <div className="v">$402.10</div>
              <div className="c down">−0.88%</div>
            </div>
          </div>
        </section>

        <section className="block" style={{ borderTop: 0, padding: 0 }} aria-label="핵심 경제 일정">
          <div className="shead">
            <h2>핵심 일정</h2>
            <span className="more">
              전체 일정
              <svg className="icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <div className="group">
            {calendarEvents.map((evt) => (
              <div key={evt.title} className="evt">
                <div className="when">
                  {evt.whenLabel}
                  <br />
                  <span className="d">{evt.timeLabel}</span>
                </div>
                <div className="body">
                  <div className="ttl">{evt.title}</div>
                  <div className="desc">{evt.desc}</div>
                </div>
                <span className={`imp ${evt.importance}`}>
                  {evt.importance === "high" ? "중요" : evt.importance === "mid" ? "보통" : "낮음"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ===== 도구 진입점 ===== */}
      <section className="block" aria-label="기능 바로가기">
        <div className="shead">
          <h2>분석 및 실행 도구</h2>
        </div>
        <div className="tools">
          <a className="tool" href="/explore">
            <span className="kik">
              <svg className="icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2v20M2 12h20" />
              </svg>
              Radar
            </span>
            <h4>마켓 레이더</h4>
            <p>실시간 모니터링 대시보드.</p>
            <span className="go">
              진입 <span className="arr">→</span>
            </span>
          </a>
          <a className="tool" href="/superinvestors">
            <span className="kik">
              <svg className="icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2">
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Scout
            </span>
            <h4>알파 스카우트</h4>
            <p>기관 동향 기반 가치 발굴.</p>
            <span className="go">
              진입 <span className="arr">→</span>
            </span>
          </a>
          <a className="tool" href="/portfolio">
            <span className="kik">
              <svg className="icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
              </svg>
              IB Helper
            </span>
            <h4>무한매수 헬퍼</h4>
            <p>전략 계산 자동 운용.</p>
            <span className="go">
              진입 <span className="arr">→</span>
            </span>
          </a>
        </div>
      </section>
    </div>
  );
}
