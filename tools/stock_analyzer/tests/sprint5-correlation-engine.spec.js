/**
 * Sprint 5: CorrelationEngine E2E Tests
 *
 * Purpose: Test CorrelationEngine module functionality (720+ lines, 19 methods)
 * Tests: 16+ comprehensive test cases
 * Coverage: Initialization, correlation matrix, clustering, portfolio optimization
 */

import { test, expect } from '@playwright/test';

test.describe('CorrelationEngine Module - Initialization and Setup', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('CorrelationEngine class should be available globally', async ({ page }) => {
    const correlationEngineExists = await page.evaluate(() => {
      return typeof window.correlationEngine !== 'undefined';
    });

    expect(correlationEngineExists).toBeTruthy();
  });

  test('CorrelationEngine should initialize with dataManager', async ({ page }) => {
    const hasDataManager = await page.evaluate(() => {
      return window.correlationEngine && window.correlationEngine.dataManager !== null;
    });

    expect(hasDataManager).toBeTruthy();
  });

  test('CorrelationEngine initialization should load T_Correlation data', async ({ page }) => {
    const initResult = await page.evaluate(async () => {
      if (!window.correlationEngine) return null;

      if (!window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }

      return {
        initialized: window.correlationEngine.initialized,
        hasData: window.correlationEngine.correlationData !== null,
        dataCount: window.correlationEngine.correlationData?.length || 0
      };
    });

    expect(initResult.initialized).toBeTruthy();
    expect(initResult.hasData).toBeTruthy();
    expect(initResult.dataCount).toBeGreaterThan(1200);
    expect(initResult.dataCount).toBeLessThanOrEqual(1300); // ~1,249 companies
  });

  test('CorrelationEngine initialization should complete within performance threshold', async ({ page }) => {
    const startTime = Date.now();

    await page.evaluate(async () => {
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(2000); // 2 seconds for matrix building
  });
});

test.describe('CorrelationEngine Module - Correlation Matrix', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
    });
  });

  test('Correlation matrix should be built on initialization', async ({ page }) => {
    const hasMatrix = await page.evaluate(() => {
      return window.correlationEngine.correlationMatrix !== null &&
             Object.keys(window.correlationEngine.correlationMatrix).length > 0;
    });

    expect(hasMatrix).toBeTruthy();
  });

  test('getCorrelationMatrix() should return symmetric matrix', async ({ page }) => {
    const isSymmetric = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 10).map(c => c.Ticker);
      const matrix = window.correlationEngine.getCorrelationMatrix(tickers);

      // Check symmetry: corr(A,B) should equal corr(B,A)
      for (let i = 0; i < tickers.length; i++) {
        for (let j = i + 1; j < tickers.length; j++) {
          const tickerA = tickers[i];
          const tickerB = tickers[j];
          const corrAB = matrix[tickerA]?.[tickerB];
          const corrBA = matrix[tickerB]?.[tickerA];

          if (Math.abs(corrAB - corrBA) > 0.0001) {
            return false;
          }
        }
      }
      return true;
    });

    expect(isSymmetric).toBeTruthy();
  });

  test('Correlation matrix diagonal should be 1.0 (self-correlation)', async ({ page }) => {
    const diagonalIsOne = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 10).map(c => c.Ticker);
      const matrix = window.correlationEngine.getCorrelationMatrix(tickers);

      // Check diagonal: corr(A,A) = 1.0
      for (const ticker of tickers) {
        const selfCorr = matrix[ticker]?.[ticker];
        if (Math.abs(selfCorr - 1.0) > 0.0001) {
          return false;
        }
      }
      return true;
    });

    expect(diagonalIsOne).toBeTruthy();
  });

  test('Correlation values should be in -1.0 to 1.0 range', async ({ page }) => {
    const valuesInRange = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 20).map(c => c.Ticker);
      const matrix = window.correlationEngine.getCorrelationMatrix(tickers);

      for (const tickerA of tickers) {
        for (const tickerB of tickers) {
          const corr = matrix[tickerA]?.[tickerB];
          if (corr !== null && (corr < -1.0 || corr > 1.0)) {
            return false;
          }
        }
      }
      return true;
    });

    expect(valuesInRange).toBeTruthy();
  });
});

test.describe('CorrelationEngine Module - Diversified Portfolio', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
    });
  });

  test('findLowCorrelationPairs() should return pairs within correlation range', async ({ page }) => {
    const pairs = await page.evaluate(() => {
      return window.correlationEngine.findLowCorrelationPairs(-0.3, 0.3);
    });

    expect(Array.isArray(pairs)).toBeTruthy();
    expect(pairs.length).toBeGreaterThan(0);

    // Verify all pairs meet the correlation criteria
    pairs.forEach(pair => {
      expect(pair).toHaveProperty('tickerA');
      expect(pair).toHaveProperty('tickerB');
      expect(pair).toHaveProperty('correlation');
      expect(pair.correlation).toBeGreaterThanOrEqual(-0.3);
      expect(pair.correlation).toBeLessThanOrEqual(0.3);
    });
  });

  test('buildDiversifiedPortfolio() should select stocks with low average correlation', async ({ page }) => {
    const portfolio = await page.evaluate(() => {
      const allTickers = window.correlationEngine.correlationData.slice(0, 50).map(c => c.Ticker);
      return window.correlationEngine.buildDiversifiedPortfolio(allTickers, 10);
    });

    expect(Array.isArray(portfolio)).toBeTruthy();
    expect(portfolio.length).toBeLessThanOrEqual(10);
    expect(portfolio.length).toBeGreaterThan(0);

    // Verify each portfolio item has required properties
    portfolio.forEach(item => {
      expect(item).toHaveProperty('ticker');
      expect(item).toHaveProperty('avgCorrelation');
    });

    // Verify portfolio has lower average correlation than random selection
    const avgCorr = portfolio.reduce((sum, item) => sum + item.avgCorrelation, 0) / portfolio.length;
    expect(avgCorr).toBeLessThan(0.5); // Diversified portfolio should have low correlation
  });
});

test.describe('CorrelationEngine Module - Clustering Analysis', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
    });
  });

  test('clusterByCorrelation() should create specified number of clusters', async ({ page }) => {
    const clusterResult = await page.evaluate(() => {
      return window.correlationEngine.clusterByCorrelation(5);
    });

    expect(clusterResult).toHaveProperty('clusters');
    expect(clusterResult).toHaveProperty('centroids');
    expect(clusterResult.clusters.length).toBe(5);

    // Verify each cluster has members
    clusterResult.clusters.forEach((cluster, idx) => {
      expect(Array.isArray(cluster)).toBeTruthy();
      expect(cluster.length).toBeGreaterThan(0);
      console.log(`Cluster ${idx + 1}: ${cluster.length} members`);
    });
  });

  test('Cluster intra-correlation should be higher than inter-correlation', async ({ page }) => {
    const correlationAnalysis = await page.evaluate(() => {
      const clusterResult = window.correlationEngine.clusterByCorrelation(5);
      const matrix = window.correlationEngine.correlationMatrix;

      // Calculate average intra-cluster correlation
      let intraCorrelations = [];
      clusterResult.clusters.forEach(cluster => {
        let clusterCorrs = [];
        for (let i = 0; i < cluster.length; i++) {
          for (let j = i + 1; j < cluster.length; j++) {
            const corr = matrix[cluster[i]]?.[cluster[j]];
            if (corr !== null) clusterCorrs.push(Math.abs(corr));
          }
        }
        if (clusterCorrs.length > 0) {
          intraCorrelations.push(clusterCorrs.reduce((a, b) => a + b, 0) / clusterCorrs.length);
        }
      });

      // Calculate average inter-cluster correlation (between cluster 0 and 1)
      let interCorrelations = [];
      if (clusterResult.clusters.length >= 2) {
        const cluster0 = clusterResult.clusters[0];
        const cluster1 = clusterResult.clusters[1];
        for (const tickerA of cluster0) {
          for (const tickerB of cluster1) {
            const corr = matrix[tickerA]?.[tickerB];
            if (corr !== null) interCorrelations.push(Math.abs(corr));
          }
        }
      }

      return {
        avgIntra: intraCorrelations.reduce((a, b) => a + b, 0) / intraCorrelations.length,
        avgInter: interCorrelations.length > 0
          ? interCorrelations.reduce((a, b) => a + b, 0) / interCorrelations.length
          : 0
      };
    });

    expect(correlationAnalysis.avgIntra).toBeGreaterThan(correlationAnalysis.avgInter);
  });

  test('getClusterScatterData() should return scatter plot data with clusters', async ({ page }) => {
    const scatterData = await page.evaluate(() => {
      return window.correlationEngine.getClusterScatterData(5);
    });

    expect(scatterData).toHaveProperty('clusters');
    expect(Array.isArray(scatterData.clusters)).toBeTruthy();
    expect(scatterData.clusters.length).toBe(5);

    // Verify each cluster has points with x, y coordinates
    scatterData.clusters.forEach(cluster => {
      expect(cluster).toHaveProperty('points');
      expect(Array.isArray(cluster.points)).toBeTruthy();
      cluster.points.forEach(point => {
        expect(point).toHaveProperty('x');
        expect(point).toHaveProperty('y');
        expect(point).toHaveProperty('ticker');
      });
    });
  });
});

test.describe('CorrelationEngine Module - Portfolio Optimization', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
    });
  });

  test('optimizePortfolio() should return weights that sum to 1.0', async ({ page }) => {
    const optimization = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 10).map(c => c.Ticker);
      return window.correlationEngine.optimizePortfolio(tickers, 'moderate');
    });

    expect(optimization).toHaveProperty('weights');
    expect(optimization).toHaveProperty('expectedReturn');
    expect(optimization).toHaveProperty('expectedRisk');

    // Verify weights sum to 1.0
    const weightSum = Object.values(optimization.weights).reduce((sum, w) => sum + w, 0);
    expect(Math.abs(weightSum - 1.0)).toBeLessThan(0.01); // Allow small rounding error
  });

  test('Conservative portfolio should have lower risk than aggressive', async ({ page }) => {
    const comparison = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 10).map(c => c.Ticker);
      const conservative = window.correlationEngine.optimizePortfolio(tickers, 'conservative');
      const aggressive = window.correlationEngine.optimizePortfolio(tickers, 'aggressive');

      return {
        conservativeRisk: conservative.expectedRisk,
        aggressiveRisk: aggressive.expectedRisk,
        conservativeReturn: conservative.expectedReturn,
        aggressiveReturn: aggressive.expectedReturn
      };
    });

    // Conservative should have lower risk
    expect(comparison.conservativeRisk).toBeLessThan(comparison.aggressiveRisk);
  });
});

test.describe('CorrelationEngine Module - Chart Data Generation', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
    });
  });

  test('getCorrelationHeatmapData() should generate heatmap format', async ({ page }) => {
    const heatmapData = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 30).map(c => c.Ticker);
      return window.correlationEngine.getCorrelationHeatmapData(tickers, 30);
    });

    expect(heatmapData).toHaveProperty('labels');
    expect(heatmapData).toHaveProperty('avgCorrelations');
    expect(Array.isArray(heatmapData.labels)).toBeTruthy();
    expect(heatmapData.labels.length).toBeGreaterThan(0);
    expect(heatmapData.labels.length).toBeLessThanOrEqual(30);

    // Verify data length matches labels
    expect(heatmapData.avgCorrelations.length).toBe(heatmapData.labels.length);
  });

  test('getSectorCorrelation() should return sector-level correlation analysis', async ({ page }) => {
    const sectorCorr = await page.evaluate(() => {
      return window.correlationEngine.getSectorCorrelation();
    });

    expect(Array.isArray(sectorCorr)).toBeTruthy();
    expect(sectorCorr.length).toBeGreaterThan(0);

    // Verify sector data structure
    sectorCorr.forEach(sector => {
      expect(sector).toHaveProperty('sector');
      expect(sector).toHaveProperty('intraCorrelation');
      expect(sector).toHaveProperty('interCorrelation');
      expect(sector).toHaveProperty('count');
    });
  });
});

test.describe('CorrelationEngine Module - Edge Cases and Error Handling', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('Methods should handle uninitialized state gracefully', async ({ page }) => {
    const results = await page.evaluate(() => {
      const uninitializedCorr = new CorrelationEngine({});

      return {
        getCorrelationMatrix: Object.keys(uninitializedCorr.getCorrelationMatrix([]) || {}).length,
        findLowCorrelationPairs: uninitializedCorr.findLowCorrelationPairs(-0.3, 0.3).length,
        buildDiversifiedPortfolio: uninitializedCorr.buildDiversifiedPortfolio([], 10).length
      };
    });

    expect(results.getCorrelationMatrix).toBe(0);
    expect(results.findLowCorrelationPairs).toBe(0);
    expect(results.buildDiversifiedPortfolio).toBe(0);
  });

  test('clusterByCorrelation() should handle edge case of k=1', async ({ page }) => {
    await page.evaluate(async () => {
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
    });

    const singleCluster = await page.evaluate(() => {
      return window.correlationEngine.clusterByCorrelation(1);
    });

    expect(singleCluster.clusters.length).toBe(1);
    expect(singleCluster.clusters[0].length).toBeGreaterThan(0);
  });
});
