/**
 * Unit Tests for GrowthAnalytics Module
 * Sprint 4 - Growth & Ranking Analytics
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock GrowthAnalytics class
class GrowthAnalytics {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.growthData = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      const integratedData = await this.loadIntegratedData();

      if (!integratedData?.data?.technical?.T_Growth_C) {
        console.warn('[GrowthAnalytics] T_Growth_C data not found');
        return false;
      }

      this.growthData = integratedData.data.technical.T_Growth_C;
      this.enrichGrowthData();
      this.initialized = true;

      return true;
    } catch (error) {
      console.error('[GrowthAnalytics] Initialization failed:', error);
      return false;
    }
  }

  async loadIntegratedData() {
    const response = await fetch('./data/global_scouter_integrated.json');
    if (!response.ok) {
      throw new Error(`Failed to load: ${response.status}`);
    }
    return await response.json();
  }

  enrichGrowthData() {
    if (!this.dataManager?.companies) return;

    const companyMap = new Map(
      this.dataManager.companies.map(c => [c.Ticker, c])
    );

    this.growthData = this.growthData.map(growth => {
      const company = companyMap.get(growth.Ticker);
      return {
        ...growth,
        corpName: company?.corpName || growth.Corp,
        price: company?.Price || growth['주가변화'],
        marketCap: company?.['(USD mn)'] || growth['(USD mn)']
      };
    });
  }

  parseGrowth(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const num = parseFloat(value);
    if (isNaN(num)) {
      return null;
    }
    // Convert 0-1 range to percentage
    if (Math.abs(num) <= 1) {
      return num * 100;
    }
    return num;
  }

  getCompanyGrowth(ticker) {
    if (!this.initialized || !this.growthData) {
      return null;
    }

    const growth = this.growthData.find(g => g.Ticker === ticker);
    if (!growth) {
      return null;
    }

    return {
      ticker: growth.Ticker,
      corp: growth.Corp,
      exchange: growth.Exchange,
      sector: growth.WI26,
      sales_7y: this.parseGrowth(growth['Sales (7)']),
      sales_3y: this.parseGrowth(growth['Sales (3)']),
      op_7y: this.parseGrowth(growth['OP (7)']),
      op_3y: this.parseGrowth(growth['OP (3)']),
      eps_7y: this.parseGrowth(growth['EPS (7)']),
      eps_3y: this.parseGrowth(growth['EPS (3)']),
      roe_fwd: this.parseGrowth(growth['ROE (Fwd)']),
      opm_fwd: this.parseGrowth(growth['OPM (Fwd)'])
    };
  }

  average(arr) {
    if (!arr || arr.length === 0) return null;
    const sum = arr.reduce((acc, val) => acc + val, 0);
    return sum / arr.length;
  }

  getHighGrowthCompanies(threshold = 20, metric = 'sales', period = '7y') {
    if (!this.initialized || !this.growthData) {
      return [];
    }

    const metricKey = `${metric.toUpperCase()} (${period === '7y' ? '7' : '3'})`;

    return this.growthData
      .filter(growth => {
        const value = this.parseGrowth(growth[metricKey]);
        return value !== null && value >= threshold;
      })
      .map(growth => ({
        ticker: growth.Ticker,
        corp: growth.Corp,
        sector: growth.WI26,
        growthRate: this.parseGrowth(growth[metricKey]),
        marketCap: growth['(USD mn)']
      }))
      .sort((a, b) => b.growthRate - a.growthRate);
  }
}

describe('GrowthAnalytics', () => {
  let growthAnalytics;
  let mockDataManager;

  beforeEach(() => {
    mockDataManager = {
      companies: [
        { Ticker: 'AAPL', corpName: 'Apple Inc.', Price: 150.25, '(USD mn)': 2500000 },
        { Ticker: 'MSFT', corpName: 'Microsoft Corp.', Price: 320.50, '(USD mn)': 2300000 }
      ]
    };

    growthAnalytics = new GrowthAnalytics(mockDataManager);
  });

  describe('Initialization', () => {
    test('initialize() loads T_Growth_C data successfully', async () => {
      // Mock successful fetch
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            technical: {
              T_Growth_C: [
                { Ticker: 'AAPL', Corp: 'Apple', 'Sales (7)': 0.15, 'Sales (3)': 0.12 },
                { Ticker: 'MSFT', Corp: 'Microsoft', 'Sales (7)': 0.18, 'Sales (3)': 0.14 }
              ]
            }
          }
        })
      });

      const result = await growthAnalytics.initialize();

      expect(result).toBe(true);
      expect(growthAnalytics.initialized).toBe(true);
      expect(growthAnalytics.growthData).toHaveLength(2);
    });

    test('initialize() handles missing T_Growth_C gracefully', async () => {
      // Mock data without T_Growth_C
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            technical: {}
          }
        })
      });

      const result = await growthAnalytics.initialize();

      expect(result).toBe(false);
      expect(growthAnalytics.initialized).toBe(false);
    });

    test('initialize() handles fetch errors', async () => {
      // Mock fetch error
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await growthAnalytics.initialize();

      expect(result).toBe(false);
      expect(growthAnalytics.initialized).toBe(false);
    });
  });

  describe('Data Parsing', () => {
    test('parseGrowth() converts decimal to percentage correctly', () => {
      expect(growthAnalytics.parseGrowth(0.15)).toBe(15);
      expect(growthAnalytics.parseGrowth(0.5)).toBe(50);
      expect(growthAnalytics.parseGrowth(1.0)).toBe(100);
    });

    test('parseGrowth() handles values > 1 as-is', () => {
      expect(growthAnalytics.parseGrowth(25)).toBe(25);
      expect(growthAnalytics.parseGrowth(100)).toBe(100);
    });

    test('parseGrowth() handles negative values', () => {
      expect(growthAnalytics.parseGrowth(-0.1)).toBe(-10);
      expect(growthAnalytics.parseGrowth(-25)).toBe(-25);
    });

    test('parseGrowth() handles null values', () => {
      expect(growthAnalytics.parseGrowth(null)).toBe(null);
      expect(growthAnalytics.parseGrowth(undefined)).toBe(null);
      expect(growthAnalytics.parseGrowth('')).toBe(null);
    });

    test('parseGrowth() handles invalid strings', () => {
      expect(growthAnalytics.parseGrowth('N/A')).toBe(null);
      expect(growthAnalytics.parseGrowth('invalid')).toBe(null);
    });

    test('parseGrowth() handles extreme values', () => {
      expect(growthAnalytics.parseGrowth(Infinity)).toBe(Infinity);
      expect(growthAnalytics.parseGrowth(-Infinity)).toBe(-Infinity);
    });
  });

  describe('Business Logic', () => {
    beforeEach(async () => {
      // Setup initialized state
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            technical: {
              T_Growth_C: [
                {
                  Ticker: 'AAPL',
                  Corp: 'Apple',
                  Exchange: 'NASDAQ',
                  WI26: 'Technology',
                  'Sales (7)': 0.15,
                  'Sales (3)': 0.12,
                  'OP (7)': 0.18,
                  'OP (3)': 0.14,
                  'EPS (7)': 0.20,
                  'EPS (3)': 0.16,
                  'ROE (Fwd)': 0.25,
                  'OPM (Fwd)': 0.22
                },
                {
                  Ticker: 'MSFT',
                  Corp: 'Microsoft',
                  Exchange: 'NASDAQ',
                  WI26: 'Technology',
                  'Sales (7)': 0.25,
                  'Sales (3)': 0.20,
                  'OP (7)': 0.28,
                  'OP (3)': 0.22,
                  'EPS (7)': 0.30,
                  'EPS (3)': 0.24,
                  'ROE (Fwd)': 0.35,
                  'OPM (Fwd)': 0.30
                }
              ]
            }
          }
        })
      });

      await growthAnalytics.initialize();
    });

    test('getCompanyGrowth() retrieves correct growth data', () => {
      const appleGrowth = growthAnalytics.getCompanyGrowth('AAPL');

      expect(appleGrowth).not.toBe(null);
      expect(appleGrowth.ticker).toBe('AAPL');
      expect(appleGrowth.corp).toBe('Apple');
      expect(appleGrowth.sales_7y).toBe(15); // 0.15 * 100
      expect(appleGrowth.sales_3y).toBe(12);
      expect(appleGrowth.op_7y).toBe(18);
      expect(appleGrowth.eps_7y).toBe(20);
    });

    test('getCompanyGrowth() returns null for non-existent ticker', () => {
      const result = growthAnalytics.getCompanyGrowth('INVALID');
      expect(result).toBe(null);
    });

    test('getCompanyGrowth() returns null when not initialized', () => {
      const uninitializedAnalytics = new GrowthAnalytics(mockDataManager);
      const result = uninitializedAnalytics.getCompanyGrowth('AAPL');
      expect(result).toBe(null);
    });

    test('getHighGrowthCompanies() filters by threshold', () => {
      const highGrowth = growthAnalytics.getHighGrowthCompanies(20, 'sales', '7y');

      expect(highGrowth).toHaveLength(1); // Only MSFT has 25% growth
      expect(highGrowth[0].ticker).toBe('MSFT');
      expect(highGrowth[0].growthRate).toBe(25);
    });

    test('getHighGrowthCompanies() returns empty array for high threshold', () => {
      const highGrowth = growthAnalytics.getHighGrowthCompanies(100, 'sales', '7y');
      expect(highGrowth).toHaveLength(0);
    });

    test('getHighGrowthCompanies() sorts by growth rate descending', () => {
      const highGrowth = growthAnalytics.getHighGrowthCompanies(10, 'sales', '7y');

      expect(highGrowth).toHaveLength(2);
      expect(highGrowth[0].growthRate).toBeGreaterThan(highGrowth[1].growthRate);
    });
  });

  describe('Utility Functions', () => {
    test('average() calculates correct average', () => {
      expect(growthAnalytics.average([10, 20, 30])).toBe(20);
      expect(growthAnalytics.average([5, 15, 25, 35])).toBe(20);
    });

    test('average() handles single element', () => {
      expect(growthAnalytics.average([42])).toBe(42);
    });

    test('average() handles empty array', () => {
      expect(growthAnalytics.average([])).toBe(null);
    });

    test('average() handles null input', () => {
      expect(growthAnalytics.average(null)).toBe(null);
      expect(growthAnalytics.average(undefined)).toBe(null);
    });
  });

  describe('Edge Cases', () => {
    test('handles empty dataset gracefully', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            technical: {
              T_Growth_C: []
            }
          }
        })
      });

      await growthAnalytics.initialize();

      const result = growthAnalytics.getCompanyGrowth('AAPL');
      expect(result).toBe(null);
    });

    test('handles all-null growth values', () => {
      growthAnalytics.growthData = [
        {
          Ticker: 'TEST',
          Corp: 'Test Corp',
          'Sales (7)': null,
          'Sales (3)': null,
          'OP (7)': null,
          'OP (3)': null,
          'EPS (7)': null,
          'EPS (3)': null
        }
      ];
      growthAnalytics.initialized = true;

      const growth = growthAnalytics.getCompanyGrowth('TEST');

      expect(growth).not.toBe(null);
      expect(growth.sales_7y).toBe(null);
      expect(growth.op_7y).toBe(null);
      expect(growth.eps_7y).toBe(null);
    });

    test('enrichGrowthData() handles missing dataManager', () => {
      const analyticsWithoutManager = new GrowthAnalytics(null);
      analyticsWithoutManager.growthData = [{ Ticker: 'AAPL' }];

      // Should not throw error
      expect(() => analyticsWithoutManager.enrichGrowthData()).not.toThrow();
    });
  });
});
