"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import "@/styles/ib-guide.css";
const IbGuideTab = dynamic(() => import("./IbGuideTab"));
import IbNav from "./IbNav";
import ProfileSheet from "./ProfileSheet";
import StrategyCard from "./StrategyCard";
import EmptySlot from "./EmptySlot";
import ZeroState from "./ZeroState";
import OrderPlanCard from "./OrderPlanCard";
import CashCard from "./CashCard";
import FootNav from "./FootNav";
import { useIbHelperV2LiveData } from "./useIbHelperV2LiveData";

/**
 * IB Helper V2 composer — responsive (mobile-first + desktop grid).
 */
export default function IbHelperV2() {
  const [tab, setTab] = useState<"strategy" | "guide">("strategy");
  const [guideOpened, setGuideOpened] = useState(false);
  const chooseTab = (next: "strategy" | "guide") => {
    setTab(next); if (next === "guide") setGuideOpened(true);
    window.history.replaceState(window.history.state, "", next === "guide" ? "#guide" : "#strategy");
  };
  useEffect(() => {
    const sync = () => { const guide = window.location.hash === "#guide"; setTab(guide ? "guide" : "strategy"); if (guide) setGuideOpened(true); };
    sync(); window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const {
    profiles,
    activeProfile: profile,
    strategies,
    cash,
    alertState,
    isLoading,
    errors,
    refresh,
  } = useIbHelperV2LiveData(selectedProfileId);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 960);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const tickers = profile.tickers;
  const sCount = tickers.length;
  const skeleton = isLoading;
  const strategyForSym = (sym: string) => strategies[sym] ?? null;

  return (
    <div className="ib-v2-shell">
      <IbNav
        profile={profile}
        onOpenPicker={() => setSheetOpen(true)}
        onRefresh={refresh}
        isRefreshing={isLoading}
      />
      <div className="ib-section-tabs" role="tablist" aria-label="IB Helper 화면">
        <button type="button" role="tab" aria-selected={tab === "strategy"} aria-controls="ib-strategy-panel" onClick={() => chooseTab("strategy")}>내 전략</button>
        <button type="button" role="tab" aria-selected={tab === "guide"} aria-controls="ib-guide-panel" onClick={() => chooseTab("guide")}>가이드 · 계산기</button>
      </div>
      <div className={`ib-scroll${isDesktop ? " ib-scroll--desk" : ""}`}>
        <div id="ib-strategy-panel" hidden={tab !== "strategy"}>
        {sCount === 0 ? (
          <ZeroState />
        ) : isDesktop ? (
          <div className={`ib-desk-grid${sCount === 1 ? " ib-desk-grid--single" : ""}`}>
            {tickers.map((sym) => {
              const data = strategyForSym(sym);
              return data ? (
                <StrategyCard key={sym} t={data} skeleton={skeleton} />
              ) : null;
            })}
            {sCount === 1 ? <EmptySlot /> : null}
            <div className="ib-desk-grid__plans">
              {tickers.map((sym) => {
                const data = strategyForSym(sym);
                return data ? (
                  <OrderPlanCard key={sym} t={data} skeleton={skeleton} error={errors[sym]} />
                ) : null;
              })}
            </div>
            <CashCard alertState={alertState} skeleton={skeleton} profile={profile} cash={cash} />
          </div>
        ) : (
          <>
            {tickers.map((sym) => {
              const data = strategyForSym(sym);
              return data ? (
                <StrategyCard key={sym} t={data} skeleton={skeleton} />
              ) : null;
            })}
            {sCount === 1 && !skeleton ? <EmptySlot /> : null}
            {tickers.map((sym) => {
              const data = strategyForSym(sym);
              return data ? (
                <OrderPlanCard key={sym} t={data} skeleton={skeleton} error={errors[sym]} />
              ) : null;
            })}
            <CashCard alertState={alertState} skeleton={skeleton} profile={profile} cash={cash} />
          </>
        )}
        </div>
        <div id="ib-guide-panel" hidden={tab !== "guide"}>{guideOpened ? <IbGuideTab /> : null}</div>
      </div>
      {!isDesktop ? <FootNav active={tab} onGuide={() => chooseTab("guide")} onStrategy={() => chooseTab("strategy")} /> : null}
      <ProfileSheet
        open={sheetOpen}
        profiles={profiles}
        current={profile}
        onPick={(next) => setSelectedProfileId(next.id)}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
