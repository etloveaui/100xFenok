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
import { useIbHelperV2LiveData } from "./useIbHelperV2LiveData";

/**
 * IB Helper V2 composer — responsive (mobile-first + desktop grid).
 */
export default function IbHelperV2() {
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
      {!isDesktop ? <FootNav active="strategy" /> : null}
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
