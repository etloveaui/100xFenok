import { create } from "zustand";

import type {
  StockAnalyzerDashboardState,
  StockAnalyzerFilterState,
  StockAnalyzerRecord,
  StockAnalyzerTab,
} from "@/lib/stock-analyzer/types";

import {
  createDefaultFilterState,
  createEmptyDashboardState,
  DashboardManager,
} from "@/features/stock-analyzer/dashboard/dashboard-manager";

interface StockAnalyzerStore {
  manager: DashboardManager | null;
  dashboard: StockAnalyzerDashboardState<StockAnalyzerRecord>;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  setTab: (tab: StockAnalyzerTab) => void;
  updateFilters: (partial: Partial<StockAnalyzerFilterState>) => void;
  resetFilters: () => void;
  selectSymbol: (symbol: string) => void;
}

function applyManagerState(
  manager: DashboardManager,
): Pick<StockAnalyzerStore, "manager" | "dashboard"> {
  return {
    manager,
    dashboard: manager.getState(),
  };
}

export const useStockAnalyzerStore = create<StockAnalyzerStore>((set, get) => ({
  manager: null,
  dashboard: createEmptyDashboardState(),

  async initialize() {
    const manager = get().manager ?? new DashboardManager();

    await manager.initialize();
    set(applyManagerState(manager));
  },

  async refresh() {
    const manager = get().manager;
    if (!manager) {
      await get().initialize();
      return;
    }

    await manager.initialize();
    set(applyManagerState(manager));
  },

  setTab(tab) {
    const manager = get().manager;
    if (!manager) return;

    manager.setTab(tab);
    set(applyManagerState(manager));
  },

  updateFilters(partial) {
    const manager = get().manager;
    if (!manager) return;

    const current = manager.getState().filters;
    manager.setFilters({
      ...current,
      ...partial,
      sectors: partial.sectors ?? current.sectors,
      industries: partial.industries ?? current.industries,
    });

    set(applyManagerState(manager));
  },

  resetFilters() {
    const manager = get().manager;
    if (!manager) return;

    manager.setFilters(createDefaultFilterState());
    set(applyManagerState(manager));
  },

  selectSymbol(symbol) {
    const manager = get().manager;
    if (!manager) return;

    manager.selectSymbol(symbol);
    set(applyManagerState(manager));
  },
}));
