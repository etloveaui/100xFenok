"use client";

import { useEffect, useState } from "react";
import IbNav from "./IbNav";
import ProfileSheet from "./ProfileSheet";
import StrategyCard from "./StrategyCard";
import EmptySlot from "./EmptySlot";
import ZeroState from "./ZeroState";
import OrderPlanCard from "./OrderPlanCard";
import CashCard from "./CashCard";
import FootNav from "./FootNav";
import {
  PROFILES,
  STRAT,
  type AlertState,
  type Profile,
  type StrategyData,
} from "./mockData";

/**
 * IB Helper V2 composer — responsive (mobile-first + desktop grid).
 * Mock data; wire to real /ib strategy hook when ready (BACKLOG).
 *
 * Production state mapping per V2 handoff README:
 * - alertState ← cash hook margin status (default: 'none' until wired)
 * - strategyCount ← profile.tickers.length
 * - skeleton ← isLoading from hook (default false until wired)
 */
export default function IbHelperV2() {
  const [profile, setProfile] = useState<Profile>(PROFILES[0]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 960);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Mock data defaults — real hook wiring deferred
  const alertState: AlertState = "none";
  const skeleton = false;
  const tickers = profile.tickers;
  const sCount = tickers.length;
  const strategyForSym = (sym: string): StrategyData | null => STRAT[sym] ?? null;

  return (
    <div className="ib-v2-shell">
      <IbNav profile={profile} onOpenPicker={() => setSheetOpen(true)} />
      <div className={`ib-scroll${isDesktop ? " ib-scroll--desk" : ""}`}>
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
                  <OrderPlanCard key={sym} t={data} skeleton={skeleton} />
                ) : null;
              })}
            </div>
            <CashCard alertState={alertState} skeleton={skeleton} profile={profile} />
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
                <OrderPlanCard key={sym} t={data} skeleton={skeleton} />
              ) : null;
            })}
            <CashCard alertState={alertState} skeleton={skeleton} profile={profile} />
          </>
        )}
      </div>
      {!isDesktop ? <FootNav active="strategy" /> : null}
      <ProfileSheet
        open={sheetOpen}
        current={profile}
        onPick={setProfile}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
