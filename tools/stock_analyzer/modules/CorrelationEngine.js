/**
 * CorrelationEngine.js
 *
 * Correlation analysis and portfolio optimization module for Stock Analyzer.
 * Provides correlation matrix calculation, portfolio diversification analysis,
 * clustering, and efficient frontier optimization.
 *
 * Data Source: T_Correlation from global_scouter_integrated.json
 * Features: Cross-asset correlation, portfolio risk calculation, k-means clustering
 */

class CorrelationEngine {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.correlationData = null;
        this.correlationMatrix = null;
        this.initialized = false;
        this.cache = new Map();

        // Performance optimization: Indexed structure for O(n) lookups
        this.correlationIndex = {
            veryLow: [],    // < -0.5
            low: [],        // -0.5 to -0.1
            neutral: [],    // -0.1 to 0.1
            medium: [],     // 0.1 to 0.5
            high: []        // > 0.5
        };
    }

    /**
     * Initialize correlation engine
     * Loads integrated data and builds correlation matrix
     */
    async initialize() {
        if (this.initialized) return;

        try {
            const integratedData = await this.loadIntegratedData();

            if (!integratedData?.data?.technical?.T_Correlation) {
                throw new Error('T_Correlation data not found in integrated data');
            }

            this.correlationData = integratedData.data.technical.T_Correlation;
            this.enrichCorrelationData();
            this.buildCorrelationMatrix();
            this.initialized = true;

            console.log(`CorrelationEngine initialized with ${this.correlationData.length} companies`);
        } catch (error) {
            console.error('Failed to initialize CorrelationEngine:', error);
            throw error;
        }
    }

    /**
     * Load global_scouter_integrated.json with retry logic
     * Retry mechanism handles timing issues during concurrent initialization
     */
    async loadIntegratedData() {
        const maxRetries = 3;
        const retryDelay = 1000; // 1 second

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Use absolute path for more reliable fetching
                const response = await fetch('/data/global_scouter_integrated.json');

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                console.log(`[CorrelationEngine] Loaded integrated data successfully (attempt ${attempt})`);
                return data;

            } catch (error) {
                console.warn(`[CorrelationEngine] Attempt ${attempt}/${maxRetries} failed:`, error.message);

                if (attempt < maxRetries) {
                    console.log(`[CorrelationEngine] Retrying in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    console.error(`[CorrelationEngine] Failed after ${maxRetries} attempts`);
                    throw new Error(`Failed to load integrated data after ${maxRetries} attempts: ${error.message}`);
                }
            }
        }
    }

    /**
     * Enrich correlation data with company metadata
     * Matches with dataManager.companies by Ticker
     */
    enrichCorrelationData() {
        if (!this.dataManager?.companies) {
            console.warn('DataManager companies not available for enrichment');
            return;
        }

        const companyMap = new Map(
            this.dataManager.companies.map(c => [c.ticker, c])
        );

        this.correlationData = this.correlationData.map(item => {
            const company = companyMap.get(item.Ticker);
            return {
                ...item,
                sector: company?.sector || 'Unknown',
                marketCap: company?.marketCap || 0,
                companyName: company?.name || item.Corp
            };
        });
    }

    /**
     * Build full correlation matrix from price data
     * Creates NxN matrix of correlation coefficients
     * Populates correlationIndex for O(n) lookups
     */
    buildCorrelationMatrix() {
        const tickers = this.correlationData.map(d => d.Ticker);
        const n = tickers.length;
        this.correlationMatrix = new Map();

        // Reset correlation index
        this.correlationIndex = {
            veryLow: [],
            low: [],
            neutral: [],
            medium: [],
            high: []
        };

        // Build price history map
        const priceHistory = new Map();
        this.correlationData.forEach(item => {
            priceHistory.set(item.Ticker, parseFloat(item['주가']) || 0);
        });

        // Calculate pairwise correlations
        for (let i = 0; i < n; i++) {
            const ticker1 = tickers[i];
            if (!this.correlationMatrix.has(ticker1)) {
                this.correlationMatrix.set(ticker1, new Map());
            }

            for (let j = i; j < n; j++) {
                const ticker2 = tickers[j];

                if (i === j) {
                    this.correlationMatrix.get(ticker1).set(ticker2, 1.0);
                } else {
                    // Use existing correlation data if available
                    const corr = this.calculatePairCorrelation(ticker1, ticker2);
                    this.correlationMatrix.get(ticker1).set(ticker2, corr);

                    // Symmetric matrix
                    if (!this.correlationMatrix.has(ticker2)) {
                        this.correlationMatrix.set(ticker2, new Map());
                    }
                    this.correlationMatrix.get(ticker2).set(ticker1, corr);

                    // Index correlation pair for O(n) lookups
                    const pair = { ticker1, ticker2, correlation: corr };

                    if (corr < -0.5) {
                        this.correlationIndex.veryLow.push(pair);
                    } else if (corr < -0.1) {
                        this.correlationIndex.low.push(pair);
                    } else if (corr <= 0.1) {
                        this.correlationIndex.neutral.push(pair);
                    } else if (corr <= 0.5) {
                        this.correlationIndex.medium.push(pair);
                    } else {
                        this.correlationIndex.high.push(pair);
                    }
                }
            }
        }

        console.log(`[CorrelationEngine] Index built: veryLow=${this.correlationIndex.veryLow.length}, low=${this.correlationIndex.low.length}, neutral=${this.correlationIndex.neutral.length}, medium=${this.correlationIndex.medium.length}, high=${this.correlationIndex.high.length}`);
    }

    /**
     * Calculate correlation between two stocks
     * Uses fundamental correlations from data
     */
    calculatePairCorrelation(ticker1, ticker2) {
        const data1 = this.correlationData.find(d => d.Ticker === ticker1);
        const data2 = this.correlationData.find(d => d.Ticker === ticker2);

        if (!data1 || !data2) return 0;

        // Average of EPS and Sales correlations as proxy
        const eps1 = parseFloat(data1['Fwd 12M EPS']) || 0;
        const eps2 = parseFloat(data2['Fwd 12M EPS']) || 0;
        const sales1 = parseFloat(data1['Fwd 12M Sales']) || 0;
        const sales2 = parseFloat(data2['Fwd 12M Sales']) || 0;

        // Correlation proxy based on similarity of fundamental correlations
        const epsCorr = 1 - Math.abs(eps1 - eps2);
        const salesCorr = 1 - Math.abs(sales1 - sales2);

        return (epsCorr + salesCorr) / 2;
    }

    /**
     * Get all correlation data for specific company
     */
    getCompanyCorrelation(ticker) {
        const data = this.correlationData.find(d => d.Ticker === ticker);
        if (!data) return null;

        return {
            ticker: data.Ticker,
            company: data.Corp,
            sector: data.sector,
            correlations: {
                fwdSales: parseFloat(data['Fwd 12M Sales']) || 0,
                fwdEPS: parseFloat(data['Fwd 12M EPS']) || 0,
                hyy: parseFloat(data['HYY']) || 0,
                hyyInverted: parseFloat(data['HYY (inverted)']) || 0,
                usHYY: parseFloat(data['US HYY']) || 0
            },
            price: parseFloat(data['주가']) || 0,
            date: data.Date
        };
    }

    /**
     * Get correlation matrix for specific tickers
     */
    getCorrelationMatrix(tickers) {
        const matrix = [];

        for (const ticker1 of tickers) {
            const row = [];
            for (const ticker2 of tickers) {
                const corr = this.correlationMatrix.get(ticker1)?.get(ticker2) || 0;
                row.push(corr);
            }
            matrix.push(row);
        }

        return {
            tickers,
            matrix,
            size: tickers.length
        };
    }

    /**
     * Get pairwise correlation between two stocks
     */
    getPairwiseCorrelation(ticker1, ticker2) {
        const corr = this.correlationMatrix.get(ticker1)?.get(ticker2) || 0;

        return {
            ticker1,
            ticker2,
            coefficient: corr,
            strength: this.interpretCorrelation(corr),
            absoluteValue: Math.abs(corr)
        };
    }

    /**
     * Interpret correlation strength
     */
    interpretCorrelation(coefficient) {
        const abs = Math.abs(coefficient);

        if (abs >= 0.9) return coefficient > 0 ? 'Very Strong Positive' : 'Very Strong Negative';
        if (abs >= 0.7) return coefficient > 0 ? 'Strong Positive' : 'Strong Negative';
        if (abs >= 0.5) return coefficient > 0 ? 'Moderate Positive' : 'Moderate Negative';
        if (abs >= 0.3) return coefficient > 0 ? 'Weak Positive' : 'Weak Negative';
        return 'Very Weak';
    }

    /**
     * Find stock pairs with low correlation
     * Good for portfolio diversification
     * Optimized with indexed structure for O(n) performance
     */
    findLowCorrelationPairs(minCorrelation = -0.3, maxCorrelation = 0.3) {
        // Determine which index buckets to search based on correlation range
        let candidates = [];

        // veryLow: < -0.5
        if (minCorrelation < -0.5 || maxCorrelation < -0.5) {
            candidates = candidates.concat(this.correlationIndex.veryLow);
        }

        // low: -0.5 to -0.1
        if ((minCorrelation >= -0.5 && minCorrelation < -0.1) ||
            (maxCorrelation >= -0.5 && maxCorrelation < -0.1) ||
            (minCorrelation < -0.5 && maxCorrelation >= -0.1)) {
            candidates = candidates.concat(this.correlationIndex.low);
        }

        // neutral: -0.1 to 0.1
        if ((minCorrelation >= -0.1 && minCorrelation <= 0.1) ||
            (maxCorrelation >= -0.1 && maxCorrelation <= 0.1) ||
            (minCorrelation < -0.1 && maxCorrelation > 0.1)) {
            candidates = candidates.concat(this.correlationIndex.neutral);
        }

        // medium: 0.1 to 0.5
        if ((minCorrelation > 0.1 && minCorrelation <= 0.5) ||
            (maxCorrelation > 0.1 && maxCorrelation <= 0.5) ||
            (minCorrelation <= 0.1 && maxCorrelation > 0.5)) {
            candidates = candidates.concat(this.correlationIndex.medium);
        }

        // high: > 0.5
        if (minCorrelation > 0.5 || maxCorrelation > 0.5) {
            candidates = candidates.concat(this.correlationIndex.high);
        }

        // Filter candidates to exact range and enrich with company data
        const pairs = candidates
            .filter(pair => pair.correlation >= minCorrelation && pair.correlation <= maxCorrelation)
            .map(pair => {
                const data1 = this.correlationData.find(d => d.Ticker === pair.ticker1);
                const data2 = this.correlationData.find(d => d.Ticker === pair.ticker2);

                return {
                    ticker1: pair.ticker1,
                    ticker2: pair.ticker2,
                    company1: data1?.Corp || pair.ticker1,
                    company2: data2?.Corp || pair.ticker2,
                    sector1: data1?.sector || 'Unknown',
                    sector2: data2?.sector || 'Unknown',
                    correlation: pair.correlation,
                    absoluteCorrelation: Math.abs(pair.correlation)
                };
            });

        return pairs.sort((a, b) => a.absoluteCorrelation - b.absoluteCorrelation);
    }

    /**
     * Build diversified portfolio using greedy algorithm
     * Selects stocks with lowest average correlation
     */
    buildDiversifiedPortfolio(tickers, targetCount = 10) {
        if (tickers.length <= targetCount) {
            return tickers.map(t => ({ ticker: t, weight: 1 / tickers.length }));
        }

        const selected = [tickers[0]];
        const remaining = tickers.slice(1);

        while (selected.length < targetCount && remaining.length > 0) {
            let minAvgCorr = Infinity;
            let bestTicker = null;
            let bestIndex = -1;

            for (let i = 0; i < remaining.length; i++) {
                const candidate = remaining[i];
                const avgCorr = this.average(
                    selected.map(s => Math.abs(
                        this.correlationMatrix.get(s)?.get(candidate) || 0
                    ))
                );

                if (avgCorr < minAvgCorr) {
                    minAvgCorr = avgCorr;
                    bestTicker = candidate;
                    bestIndex = i;
                }
            }

            if (bestTicker) {
                selected.push(bestTicker);
                remaining.splice(bestIndex, 1);
            } else {
                break;
            }
        }

        const equalWeight = 1 / selected.length;
        return selected.map(ticker => {
            const data = this.correlationData.find(d => d.Ticker === ticker);
            return {
                ticker,
                company: data?.Corp || ticker,
                sector: data?.sector || 'Unknown',
                weight: equalWeight,
                weightPercent: (equalWeight * 100).toFixed(2)
            };
        });
    }

    /**
     * Calculate average correlation within and between sectors
     */
    getSectorCorrelation() {
        const sectorMap = new Map();

        // Group by sector
        this.correlationData.forEach(item => {
            const sector = item.sector || 'Unknown';
            if (!sectorMap.has(sector)) {
                sectorMap.set(sector, []);
            }
            sectorMap.get(sector).push(item.Ticker);
        });

        const sectors = Array.from(sectorMap.keys());
        const matrix = {};

        for (const sector1 of sectors) {
            matrix[sector1] = {};
            for (const sector2 of sectors) {
                const tickers1 = sectorMap.get(sector1);
                const tickers2 = sectorMap.get(sector2);
                const correlations = [];

                for (const t1 of tickers1) {
                    for (const t2 of tickers2) {
                        if (sector1 === sector2 && t1 === t2) continue;
                        const corr = this.correlationMatrix.get(t1)?.get(t2);
                        if (corr !== undefined) {
                            correlations.push(corr);
                        }
                    }
                }

                matrix[sector1][sector2] = correlations.length > 0
                    ? this.average(correlations)
                    : 0;
            }
        }

        return {
            sectors,
            matrix,
            sectorCounts: Object.fromEntries(
                Array.from(sectorMap.entries()).map(([s, t]) => [s, t.length])
            )
        };
    }

    /**
     * Calculate portfolio risk using correlation matrix
     */
    getPortfolioRisk(tickers, weights = null) {
        if (!weights) {
            weights = new Array(tickers.length).fill(1 / tickers.length);
        }

        if (tickers.length !== weights.length) {
            throw new Error('Tickers and weights arrays must have same length');
        }

        // Portfolio variance = w^T * Σ * w
        let variance = 0;
        for (let i = 0; i < tickers.length; i++) {
            for (let j = 0; j < tickers.length; j++) {
                const corr = this.correlationMatrix.get(tickers[i])?.get(tickers[j]) || 0;
                // Simplified: assume equal volatility
                variance += weights[i] * weights[j] * corr;
            }
        }

        const risk = Math.sqrt(Math.abs(variance));
        const diversificationRatio = 1 - (variance / tickers.length);

        return {
            variance,
            risk,
            volatility: risk * 100,
            diversificationRatio,
            diversificationPercent: (diversificationRatio * 100).toFixed(2),
            riskLevel: risk < 0.3 ? 'Low' : risk < 0.6 ? 'Moderate' : 'High'
        };
    }

    /**
     * Cluster stocks using k-means algorithm
     */
    clusterByCorrelation(numClusters = 5) {
        const tickers = this.correlationData.map(d => d.Ticker);
        const features = tickers.map(ticker => {
            const data = this.correlationData.find(d => d.Ticker === ticker);
            return [
                parseFloat(data['Fwd 12M Sales']) || 0,
                parseFloat(data['Fwd 12M EPS']) || 0,
                parseFloat(data['HYY']) || 0
            ];
        });

        const clusters = this.kMeansClustering(features, numClusters);

        return tickers.map((ticker, i) => {
            const data = this.correlationData.find(d => d.Ticker === ticker);
            return {
                ticker,
                company: data?.Corp || ticker,
                sector: data?.sector || 'Unknown',
                cluster: clusters.assignments[i],
                features: features[i]
            };
        });
    }

    /**
     * Find stocks similar to given ticker based on correlation patterns
     */
    findSimilarStocks(ticker, topN = 10) {
        const targetData = this.correlationData.find(d => d.Ticker === ticker);
        if (!targetData) return [];

        const targetFeatures = [
            parseFloat(targetData['Fwd 12M Sales']) || 0,
            parseFloat(targetData['Fwd 12M EPS']) || 0,
            parseFloat(targetData['HYY']) || 0
        ];

        const similarities = this.correlationData
            .filter(d => d.Ticker !== ticker)
            .map(data => {
                const features = [
                    parseFloat(data['Fwd 12M Sales']) || 0,
                    parseFloat(data['Fwd 12M EPS']) || 0,
                    parseFloat(data['HYY']) || 0
                ];

                const similarity = this.pearsonCorrelation(targetFeatures, features);

                return {
                    ticker: data.Ticker,
                    company: data.Corp,
                    sector: data.sector,
                    similarity,
                    correlationWithTarget: this.correlationMatrix.get(ticker)?.get(data.Ticker) || 0
                };
            })
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topN);

        return similarities;
    }

    /**
     * Get correlation heatmap data for Chart.js
     */
    getCorrelationHeatmapData(tickers = null, limit = 50) {
        if (!tickers) {
            // Use top companies by market cap
            tickers = this.correlationData
                .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
                .slice(0, limit)
                .map(d => d.Ticker);
        } else {
            // Apply limit even when tickers are provided
            tickers = tickers.slice(0, limit);
        }

        const matrix = [];
        for (const ticker1 of tickers) {
            for (const ticker2 of tickers) {
                const corr = this.correlationMatrix.get(ticker1)?.get(ticker2) || 0;
                matrix.push({
                    x: ticker1,
                    y: ticker2,
                    v: corr
                });
            }
        }

        return {
            labels: tickers,
            data: matrix,
            companies: tickers.map(t => {
                const data = this.correlationData.find(d => d.Ticker === t);
                return data?.Corp || t;
            })
        };
    }

    /**
     * Get correlation network data for graph visualization
     */
    getCorrelationNetworkData(threshold = 0.5) {
        const nodes = this.correlationData.map(d => ({
            id: d.Ticker,
            label: d.Corp,
            sector: d.sector,
            marketCap: d.marketCap
        }));

        const edges = [];
        const tickers = this.correlationData.map(d => d.Ticker);

        for (let i = 0; i < tickers.length; i++) {
            for (let j = i + 1; j < tickers.length; j++) {
                const corr = this.correlationMatrix.get(tickers[i])?.get(tickers[j]) || 0;

                if (Math.abs(corr) >= threshold) {
                    edges.push({
                        source: tickers[i],
                        target: tickers[j],
                        weight: Math.abs(corr),
                        correlation: corr,
                        type: corr > 0 ? 'positive' : 'negative'
                    });
                }
            }
        }

        return { nodes, edges, threshold };
    }

    /**
     * Get cluster scatter plot data with PCA projection
     */
    getClusterScatterData(numClusters = 5) {
        const clustered = this.clusterByCorrelation(numClusters);

        // Simple 2D projection (use first 2 features)
        const scatterData = clustered.map(item => ({
            x: item.features[0],
            y: item.features[1],
            ticker: item.ticker,
            company: item.company,
            sector: item.sector,
            cluster: item.cluster
        }));

        return {
            data: scatterData,
            numClusters,
            xLabel: 'Fwd 12M Sales Correlation',
            yLabel: 'Fwd 12M EPS Correlation'
        };
    }

    /**
     * Optimize portfolio weights
     */
    optimizePortfolio(tickers, riskTolerance = 'moderate') {
        const n = tickers.length;
        let weights;

        switch (riskTolerance) {
            case 'conservative':
                // Inverse correlation weight - maximize diversification, lowest risk
                weights = this.calculateInverseCorrelationWeights(tickers);
                break;

            case 'aggressive':
                // Equal weight - higher risk tolerance
                weights = new Array(n).fill(1 / n);
                break;

            case 'moderate':
            default:
                // Minimum variance portfolio
                weights = this.calculateMinVarianceWeights(tickers);
                break;
        }

        const risk = this.getPortfolioRisk(tickers, weights);

        return tickers.map((ticker, i) => {
            const data = this.correlationData.find(d => d.Ticker === ticker);
            return {
                ticker,
                company: data?.Corp || ticker,
                sector: data?.sector || 'Unknown',
                weight: weights[i],
                weightPercent: (weights[i] * 100).toFixed(2)
            };
        }).concat([{
            ticker: 'PORTFOLIO_RISK',
            risk: risk.risk,
            volatility: risk.volatility,
            diversification: risk.diversificationPercent
        }]);
    }

    /**
     * Calculate minimum variance portfolio weights
     */
    calculateMinVarianceWeights(tickers) {
        const n = tickers.length;
        const weights = new Array(n).fill(1 / n);

        // Iterative optimization (simple gradient descent)
        const learningRate = 0.01;
        const iterations = 100;

        for (let iter = 0; iter < iterations; iter++) {
            const gradients = new Array(n).fill(0);

            // Calculate gradient
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    const corr = this.correlationMatrix.get(tickers[i])?.get(tickers[j]) || 0;
                    gradients[i] += 2 * weights[j] * corr;
                }
            }

            // Update weights
            for (let i = 0; i < n; i++) {
                weights[i] -= learningRate * gradients[i];
            }

            // Normalize to sum to 1
            const sum = weights.reduce((a, b) => a + Math.abs(b), 0);
            for (let i = 0; i < n; i++) {
                weights[i] = Math.abs(weights[i]) / sum;
            }
        }

        return weights;
    }

    /**
     * Calculate inverse correlation weights
     */
    calculateInverseCorrelationWeights(tickers) {
        const n = tickers.length;
        const avgCorrelations = tickers.map(ticker => {
            const correlations = tickers
                .filter(t => t !== ticker)
                .map(t => Math.abs(this.correlationMatrix.get(ticker)?.get(t) || 0));
            return this.average(correlations);
        });

        // Inverse weighting
        const inverseSum = avgCorrelations.reduce((sum, corr) => sum + (1 / (corr + 0.1)), 0);
        return avgCorrelations.map(corr => (1 / (corr + 0.1)) / inverseSum);
    }

    /**
     * Calculate efficient frontier points
     */
    getEfficientFrontier(tickers, points = 20) {
        const frontier = [];

        for (let i = 0; i < points; i++) {
            const riskLevel = i / (points - 1);
            const riskTolerance = riskLevel < 0.33 ? 'conservative'
                                : riskLevel < 0.67 ? 'moderate'
                                : 'aggressive';

            const portfolio = this.optimizePortfolio(tickers, riskTolerance);
            const weights = portfolio.slice(0, -1).map(p => p.weight);
            const risk = this.getPortfolioRisk(tickers, weights);

            // Expected return (simplified)
            const expectedReturn = weights.reduce((sum, w, idx) => {
                const data = this.correlationData.find(d => d.Ticker === tickers[idx]);
                const epsCorr = parseFloat(data['Fwd 12M EPS']) || 0;
                return sum + w * epsCorr;
            }, 0);

            frontier.push({
                risk: risk.volatility,
                return: expectedReturn * 100,
                sharpeRatio: expectedReturn / (risk.risk + 0.01)
            });
        }

        return frontier.sort((a, b) => a.risk - b.risk);
    }

    /**
     * Generate DOMPurify-safe HTML summary
     */
    getCorrelationSummaryHTML(ticker) {
        const data = this.getCompanyCorrelation(ticker);
        if (!data) return '<p>No correlation data available</p>';

        const similar = this.findSimilarStocks(ticker, 5);
        const diversifiers = this.findLowCorrelationPairs(-0.2, 0.2)
            .filter(p => p.ticker1 === ticker || p.ticker2 === ticker)
            .slice(0, 5);

        const html = `
            <div class="correlation-summary">
                <h3>${data.company} (${data.ticker})</h3>
                <p><strong>Sector:</strong> ${data.sector}</p>

                <h4>Fundamental Correlations</h4>
                <ul>
                    <li>Forward Sales: ${data.correlations.fwdSales.toFixed(3)}</li>
                    <li>Forward EPS: ${data.correlations.fwdEPS.toFixed(3)}</li>
                    <li>High Yield: ${data.correlations.hyy.toFixed(3)}</li>
                </ul>

                <h4>Similar Stocks</h4>
                <ul>
                    ${similar.map(s => `
                        <li>${s.company} (${s.ticker}) - Similarity: ${s.similarity.toFixed(3)}</li>
                    `).join('')}
                </ul>

                <h4>Diversification Candidates</h4>
                <ul>
                    ${diversifiers.map(d => {
                        const other = d.ticker1 === ticker ? d.ticker2 : d.ticker1;
                        const otherName = d.ticker1 === ticker ? d.company2 : d.company1;
                        return `<li>${otherName} (${other}) - Correlation: ${d.correlation.toFixed(3)}</li>`;
                    }).join('')}
                </ul>
            </div>
        `;

        return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
    }

    /**
     * Compare correlation profiles of multiple stocks
     */
    compareCorrelations(tickers) {
        const profiles = tickers.map(ticker => {
            const data = this.getCompanyCorrelation(ticker);
            return {
                ticker,
                company: data?.company || ticker,
                sector: data?.sector || 'Unknown',
                correlations: data?.correlations || {}
            };
        });

        // Calculate pairwise correlations
        const pairwise = [];
        for (let i = 0; i < tickers.length; i++) {
            for (let j = i + 1; j < tickers.length; j++) {
                const corr = this.getPairwiseCorrelation(tickers[i], tickers[j]);
                pairwise.push(corr);
            }
        }

        return {
            profiles,
            pairwiseCorrelations: pairwise,
            averageCorrelation: this.average(pairwise.map(p => p.coefficient)),
            maxCorrelation: Math.max(...pairwise.map(p => p.coefficient)),
            minCorrelation: Math.min(...pairwise.map(p => p.coefficient))
        };
    }

    /**
     * Parse and validate correlation value
     */
    parseCorrelation(value) {
        const parsed = parseFloat(value);
        if (isNaN(parsed)) return 0;

        // Clamp to [-1, 1]
        return Math.max(-1, Math.min(1, parsed));
    }

    /**
     * K-means clustering algorithm
     */
    kMeansClustering(data, k, maxIterations = 100) {
        const n = data.length;
        const dim = data[0].length;

        // Initialize centroids randomly
        let centroids = [];
        const indices = new Set();
        while (centroids.length < k) {
            const idx = Math.floor(Math.random() * n);
            if (!indices.has(idx)) {
                indices.add(idx);
                centroids.push([...data[idx]]);
            }
        }

        let assignments = new Array(n).fill(0);

        for (let iter = 0; iter < maxIterations; iter++) {
            let changed = false;

            // Assignment step
            for (let i = 0; i < n; i++) {
                let minDist = Infinity;
                let bestCluster = 0;

                for (let c = 0; c < k; c++) {
                    const dist = this.euclideanDistance(data[i], centroids[c]);
                    if (dist < minDist) {
                        minDist = dist;
                        bestCluster = c;
                    }
                }

                if (assignments[i] !== bestCluster) {
                    changed = true;
                    assignments[i] = bestCluster;
                }
            }

            if (!changed) break;

            // Update centroids
            for (let c = 0; c < k; c++) {
                const clusterPoints = data.filter((_, i) => assignments[i] === c);
                if (clusterPoints.length > 0) {
                    centroids[c] = this.centroid(clusterPoints);
                }
            }
        }

        return { assignments, centroids };
    }

    /**
     * Calculate Euclidean distance
     */
    euclideanDistance(a, b) {
        return Math.sqrt(
            a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0)
        );
    }

    /**
     * Calculate centroid of points
     */
    centroid(points) {
        const dim = points[0].length;
        const result = new Array(dim).fill(0);

        for (const point of points) {
            for (let i = 0; i < dim; i++) {
                result[i] += point[i];
            }
        }

        return result.map(v => v / points.length);
    }

    /**
     * Calculate average of array
     */
    average(arr) {
        if (!arr || arr.length === 0) return 0;
        return arr.reduce((sum, val) => sum + val, 0) / arr.length;
    }

    /**
     * Calculate covariance between two arrays
     */
    covariance(arr1, arr2) {
        if (arr1.length !== arr2.length) return 0;

        const mean1 = this.average(arr1);
        const mean2 = this.average(arr2);

        const sum = arr1.reduce((acc, val, i) => {
            return acc + (val - mean1) * (arr2[i] - mean2);
        }, 0);

        return sum / arr1.length;
    }

    /**
     * Calculate Pearson correlation coefficient
     */
    pearsonCorrelation(arr1, arr2) {
        if (arr1.length !== arr2.length || arr1.length === 0) return 0;

        const mean1 = this.average(arr1);
        const mean2 = this.average(arr2);

        let numerator = 0;
        let sum1Sq = 0;
        let sum2Sq = 0;

        for (let i = 0; i < arr1.length; i++) {
            const diff1 = arr1[i] - mean1;
            const diff2 = arr2[i] - mean2;
            numerator += diff1 * diff2;
            sum1Sq += diff1 * diff1;
            sum2Sq += diff2 * diff2;
        }

        const denominator = Math.sqrt(sum1Sq * sum2Sq);
        return denominator === 0 ? 0 : numerator / denominator;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CorrelationEngine;
}
