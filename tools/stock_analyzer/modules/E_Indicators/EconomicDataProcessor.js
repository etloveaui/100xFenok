/**
 * EconomicDataProcessor.js
 * Economic data processing and cycle classification logic
 * Phase 3 - T038: E_Indicators Data Logic
 */

class EconomicDataProcessor {
    constructor() {
        // Economic cycle thresholds
        this.thresholds = {
            gdp: {
                expansion: 2.5,
                peak: 3.5,
                contraction: 1.0,
                trough: 0.5
            },
            inflation: {
                low: 1.0,
                target: 2.0,
                elevated: 3.0,
                high: 4.0
            },
            unemployment: {
                full: 4.0,
                normal: 5.0,
                elevated: 6.0,
                high: 7.0
            },
            interestRate: {
                accommodative: 2.0,
                neutral: 3.5,
                restrictive: 5.0
            }
        };

        // Weights for composite index calculation
        this.weights = {
            gdp: 0.35,
            inflation: 0.25,
            unemployment: 0.25,
            interestRate: 0.15
        };

        // Historical data for trend analysis
        this.historicalData = new Map();
    }

    /**
     * Parse time series data for specific indicator and country
     */
    parseTimeSeries(data, indicator, country) {
        if (!data || !data[indicator]) {
            return [];
        }

        return data[indicator]
            .filter(item => item.country === country)
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(item => ({
                date: item.date,
                value: item.value
            }));
    }

    /**
     * Calculate economic cycle phase based on multiple indicators
     */
    classifyCycle(indicators) {
        const { gdpGrowth, unemployment, inflation } = indicators;

        let phase = 'unknown';
        let confidence = 0;
        let signals = [];

        // GDP-based classification
        if (gdpGrowth >= this.thresholds.gdp.peak) {
            signals.push({ indicator: 'gdp', signal: 'peak' });
        } else if (gdpGrowth >= this.thresholds.gdp.expansion) {
            signals.push({ indicator: 'gdp', signal: 'expansion' });
        } else if (gdpGrowth >= this.thresholds.gdp.contraction) {
            signals.push({ indicator: 'gdp', signal: 'contraction' });
        } else {
            signals.push({ indicator: 'gdp', signal: 'trough' });
        }

        // Unemployment-based classification
        if (unemployment <= this.thresholds.unemployment.full) {
            signals.push({ indicator: 'unemployment', signal: 'peak' });
        } else if (unemployment <= this.thresholds.unemployment.normal) {
            signals.push({ indicator: 'unemployment', signal: 'expansion' });
        } else if (unemployment <= this.thresholds.unemployment.elevated) {
            signals.push({ indicator: 'unemployment', signal: 'contraction' });
        } else {
            signals.push({ indicator: 'unemployment', signal: 'trough' });
        }

        // Inflation-based classification
        if (inflation >= this.thresholds.inflation.high) {
            signals.push({ indicator: 'inflation', signal: 'peak' });
        } else if (inflation >= this.thresholds.inflation.elevated) {
            signals.push({ indicator: 'inflation', signal: 'expansion' });
        } else if (inflation >= this.thresholds.inflation.target) {
            signals.push({ indicator: 'inflation', signal: 'expansion' });
        } else {
            signals.push({ indicator: 'inflation', signal: 'contraction' });
        }

        // Determine consensus phase
        const phaseCounts = {};
        signals.forEach(s => {
            phaseCounts[s.signal] = (phaseCounts[s.signal] || 0) + 1;
        });

        // Find dominant phase
        let maxCount = 0;
        for (const [p, count] of Object.entries(phaseCounts)) {
            if (count > maxCount) {
                maxCount = count;
                phase = p;
            }
        }

        // Calculate confidence based on consensus
        confidence = maxCount / signals.length;

        // Adjust confidence based on indicator consistency
        if (confidence === 1.0) {
            confidence = 0.95; // Very high confidence
        } else if (confidence >= 0.66) {
            confidence = 0.75; // Moderate confidence
        } else {
            confidence = 0.55; // Low confidence
        }

        return {
            phase,
            confidence,
            signals,
            summary: this.getCycleSummary(phase)
        };
    }

    /**
     * Get descriptive summary for cycle phase
     */
    getCycleSummary(phase) {
        const summaries = {
            expansion: 'Economic growth is accelerating with improving employment and moderate inflation',
            peak: 'Economy is operating at full capacity with tight labor markets and rising inflation pressures',
            contraction: 'Economic growth is slowing with rising unemployment and declining inflation',
            trough: 'Economy is at its weakest point with high unemployment and low inflation',
            unknown: 'Economic conditions are mixed with no clear directional trend'
        };
        return summaries[phase] || summaries.unknown;
    }

    /**
     * Calculate cycle momentum score
     */
    calculateCycleMomentum(data, country) {
        const gdpSeries = this.parseTimeSeries(data, 'gdp', country);
        const inflationSeries = this.parseTimeSeries(data, 'inflation', country);
        const unemploymentSeries = this.parseTimeSeries(data, 'unemployment', country);

        if (gdpSeries.length < 2) {
            return { score: 0, trend: 'neutral', confidence: 0 };
        }

        // Calculate momentum for each indicator
        const gdpMomentum = this.calculateSeriesMomentum(gdpSeries);
        const inflationMomentum = this.calculateSeriesMomentum(inflationSeries, true); // Inverse for inflation
        const unemploymentMomentum = this.calculateSeriesMomentum(unemploymentSeries, true); // Inverse for unemployment

        // Weighted average momentum
        let score = 0;
        let totalWeight = 0;

        if (gdpMomentum !== null) {
            score += gdpMomentum * 0.4;
            totalWeight += 0.4;
        }
        if (inflationMomentum !== null) {
            score += inflationMomentum * 0.3;
            totalWeight += 0.3;
        }
        if (unemploymentMomentum !== null) {
            score += unemploymentMomentum * 0.3;
            totalWeight += 0.3;
        }

        if (totalWeight > 0) {
            score = score / totalWeight;
        }

        // Determine trend
        let trend = 'neutral';
        if (score > 20) {
            trend = 'bullish';
        } else if (score < -20) {
            trend = 'bearish';
        }

        return {
            score: Math.round(score),
            trend,
            confidence: Math.min(totalWeight, 1.0),
            components: {
                gdp: gdpMomentum,
                inflation: inflationMomentum,
                unemployment: unemploymentMomentum
            }
        };
    }

    /**
     * Calculate momentum for a single time series
     */
    calculateSeriesMomentum(series, inverse = false) {
        if (series.length < 2) {
            return null;
        }

        // Get recent values
        const recent = series.slice(-4);
        if (recent.length < 2) {
            return null;
        }

        // Calculate rate of change
        const firstValue = recent[0].value;
        const lastValue = recent[recent.length - 1].value;

        if (firstValue === 0) {
            return 0;
        }

        let rateOfChange = ((lastValue - firstValue) / firstValue) * 100;

        if (inverse) {
            rateOfChange = -rateOfChange;
        }

        // Calculate trend strength (using linear regression slope)
        const trendStrength = this.calculateTrendStrength(recent);

        // Combine rate of change and trend strength
        const momentum = (rateOfChange * 0.6) + (trendStrength * 0.4);

        // Bound between -100 and 100
        return Math.max(-100, Math.min(100, momentum));
    }

    /**
     * Calculate trend strength using simple linear regression
     */
    calculateTrendStrength(series) {
        if (series.length < 2) {
            return 0;
        }

        // Convert to numeric arrays
        const x = series.map((_, i) => i);
        const y = series.map(item => item.value);

        // Calculate means
        const xMean = x.reduce((a, b) => a + b, 0) / x.length;
        const yMean = y.reduce((a, b) => a + b, 0) / y.length;

        // Calculate slope
        let numerator = 0;
        let denominator = 0;

        for (let i = 0; i < x.length; i++) {
            numerator += (x[i] - xMean) * (y[i] - yMean);
            denominator += Math.pow(x[i] - xMean, 2);
        }

        if (denominator === 0) {
            return 0;
        }

        const slope = numerator / denominator;

        // Normalize slope to -100 to 100 range
        const normalizedSlope = Math.tanh(slope) * 100;

        return normalizedSlope;
    }

    /**
     * Aggregate indicators by country
     */
    aggregateByCountry(data, country) {
        const result = {};
        const indicators = ['gdp', 'inflation', 'unemployment', 'interestRate'];

        indicators.forEach(indicator => {
            const series = this.parseTimeSeries(data, indicator, country);

            if (series.length > 0) {
                const latest = series[series.length - 1].value;
                const previous = series.length > 1 ? series[series.length - 2].value : latest;
                const change = latest - previous;
                const changePercent = previous !== 0 ? (change / previous) * 100 : 0;

                result[indicator] = {
                    latest,
                    previous,
                    change,
                    changePercent,
                    trend: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
                    series: series
                };
            } else {
                result[indicator] = {
                    latest: null,
                    change: null,
                    changePercent: null,
                    trend: 'unknown'
                };
            }
        });

        return result;
    }

    /**
     * Calculate composite economic index
     */
    calculateCompositeIndex(aggregatedData) {
        let index = 0;
        const components = [];

        // GDP component (normalized 0-100)
        if (aggregatedData.gdp && aggregatedData.gdp.latest !== null) {
            const gdpScore = this.normalizeValue(
                aggregatedData.gdp.latest,
                -2, 5, // Expected range
                0, 100
            );
            index += gdpScore * this.weights.gdp;
            components.push({
                name: 'GDP Growth',
                value: aggregatedData.gdp.latest,
                score: gdpScore,
                weight: this.weights.gdp
            });
        }

        // Inflation component (inverted - lower is better within target)
        if (aggregatedData.inflation && aggregatedData.inflation.latest !== null) {
            const inflationScore = this.scoreInflation(aggregatedData.inflation.latest);
            index += inflationScore * this.weights.inflation;
            components.push({
                name: 'Inflation',
                value: aggregatedData.inflation.latest,
                score: inflationScore,
                weight: this.weights.inflation
            });
        }

        // Unemployment component (inverted - lower is better)
        if (aggregatedData.unemployment && aggregatedData.unemployment.latest !== null) {
            const unemploymentScore = this.normalizeValue(
                aggregatedData.unemployment.latest,
                10, 3, // Inverted range (high to low)
                0, 100
            );
            index += unemploymentScore * this.weights.unemployment;
            components.push({
                name: 'Unemployment',
                value: aggregatedData.unemployment.latest,
                score: unemploymentScore,
                weight: this.weights.unemployment
            });
        }

        // Interest rate component (neutral is best)
        if (aggregatedData.interestRate && aggregatedData.interestRate.latest !== null) {
            const interestScore = this.scoreInterestRate(aggregatedData.interestRate.latest);
            index += interestScore * this.weights.interestRate;
            components.push({
                name: 'Interest Rate',
                value: aggregatedData.interestRate.latest,
                score: interestScore,
                weight: this.weights.interestRate
            });
        }

        return {
            value: Math.round(index),
            components,
            strength: this.getIndexStrength(index),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Score inflation (target is best)
     */
    scoreInflation(value) {
        const target = this.thresholds.inflation.target;
        const deviation = Math.abs(value - target);

        if (deviation <= 0.5) {
            return 100; // Perfect
        } else if (deviation <= 1.0) {
            return 80; // Good
        } else if (deviation <= 2.0) {
            return 60; // Acceptable
        } else if (deviation <= 3.0) {
            return 40; // Concerning
        } else {
            return 20; // Poor
        }
    }

    /**
     * Score interest rate (neutral is best)
     */
    scoreInterestRate(value) {
        const neutral = this.thresholds.interestRate.neutral;
        const deviation = Math.abs(value - neutral);

        if (deviation <= 0.5) {
            return 100; // Perfect
        } else if (deviation <= 1.5) {
            return 75; // Good
        } else if (deviation <= 2.5) {
            return 50; // Acceptable
        } else {
            return 25; // Extreme
        }
    }

    /**
     * Get index strength description
     */
    getIndexStrength(value) {
        if (value >= 80) return 'Very Strong';
        if (value >= 60) return 'Strong';
        if (value >= 40) return 'Moderate';
        if (value >= 20) return 'Weak';
        return 'Very Weak';
    }

    /**
     * Normalize value to target range
     */
    normalizeValue(value, minInput, maxInput, minOutput, maxOutput) {
        if (value === null || value === undefined) {
            return (minOutput + maxOutput) / 2;
        }

        const clampedValue = Math.max(minInput, Math.min(maxInput, value));
        const normalized = (clampedValue - minInput) / (maxInput - minInput);
        return minOutput + (normalized * (maxOutput - minOutput));
    }

    /**
     * Detect economic anomalies
     */
    detectAnomalies(data, country) {
        const anomalies = [];
        const aggregated = this.aggregateByCountry(data, country);

        // Check GDP anomalies
        if (aggregated.gdp && aggregated.gdp.latest !== null) {
            if (aggregated.gdp.latest < 0) {
                anomalies.push({
                    indicator: 'GDP',
                    severity: 'high',
                    value: aggregated.gdp.latest,
                    message: 'Negative GDP growth indicates recession',
                    type: 'recession_warning'
                });
            } else if (aggregated.gdp.latest > 5) {
                anomalies.push({
                    indicator: 'GDP',
                    severity: 'medium',
                    value: aggregated.gdp.latest,
                    message: 'Unusually high GDP growth may indicate overheating',
                    type: 'overheating_warning'
                });
            }
        }

        // Check inflation anomalies
        if (aggregated.inflation && aggregated.inflation.latest !== null) {
            if (aggregated.inflation.latest > 5) {
                anomalies.push({
                    indicator: 'Inflation',
                    severity: 'high',
                    value: aggregated.inflation.latest,
                    message: 'High inflation eroding purchasing power',
                    type: 'inflation_warning'
                });
            } else if (aggregated.inflation.latest < 0) {
                anomalies.push({
                    indicator: 'Inflation',
                    severity: 'high',
                    value: aggregated.inflation.latest,
                    message: 'Deflation risk could suppress economic growth',
                    type: 'deflation_warning'
                });
            }
        }

        // Check unemployment anomalies
        if (aggregated.unemployment && aggregated.unemployment.latest !== null) {
            if (aggregated.unemployment.latest > 8) {
                anomalies.push({
                    indicator: 'Unemployment',
                    severity: 'high',
                    value: aggregated.unemployment.latest,
                    message: 'High unemployment indicates economic distress',
                    type: 'unemployment_crisis'
                });
            }
        }

        // Check interest rate anomalies
        if (aggregated.interestRate && aggregated.interestRate.latest !== null) {
            if (aggregated.interestRate.latest < 0) {
                anomalies.push({
                    indicator: 'Interest Rate',
                    severity: 'medium',
                    value: aggregated.interestRate.latest,
                    message: 'Negative interest rates indicate extreme monetary policy',
                    type: 'negative_rates'
                });
            } else if (aggregated.interestRate.latest > 10) {
                anomalies.push({
                    indicator: 'Interest Rate',
                    severity: 'high',
                    value: aggregated.interestRate.latest,
                    message: 'Very high interest rates may choke economic growth',
                    type: 'restrictive_policy'
                });
            }
        }

        return anomalies;
    }

    /**
     * Rank countries by economic strength
     */
    rankCountries(data, countries) {
        const scores = [];

        countries.forEach(country => {
            const aggregated = this.aggregateByCountry(data, country);
            const index = this.calculateCompositeIndex(aggregated);

            scores.push({
                country,
                score: index.value,
                strength: index.strength,
                data: aggregated
            });
        });

        // Sort by score (descending)
        scores.sort((a, b) => b.score - a.score);

        // Add rankings
        return scores.map((item, index) => ({
            ...item,
            rank: index + 1,
            percentile: Math.round((1 - index / scores.length) * 100)
        }));
    }

    /**
     * Forecast next period values using simple trend projection
     */
    forecastNextPeriod(series, periods = 1) {
        if (series.length < 3) {
            return null;
        }

        // Use simple moving average trend
        const recent = series.slice(-3);
        const trend = this.calculateTrendStrength(recent) / 100;
        const lastValue = recent[recent.length - 1].value;

        const forecast = [];
        let currentValue = lastValue;

        for (let i = 1; i <= periods; i++) {
            currentValue = currentValue * (1 + trend * 0.1); // Dampen trend
            forecast.push({
                period: i,
                value: currentValue,
                confidence: Math.max(0.3, 0.9 - (i * 0.1)) // Confidence decreases with horizon
            });
        }

        return forecast;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EconomicDataProcessor;
} else {
    window.EconomicDataProcessor = EconomicDataProcessor;
}