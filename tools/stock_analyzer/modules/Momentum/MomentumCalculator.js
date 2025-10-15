/**
 * MomentumCalculator - Momentum calculation engine
 * Calculates various momentum metrics for companies
 *
 * @module Momentum/MomentumCalculator
 * @version 1.0.0
 */

class MomentumCalculator {
    constructor(periods = {}) {
        this.periods = {
            short: periods.short || [1, 5, 20],
            medium: periods.medium || [60, 120],
            long: periods.long || [252, 504, 756]
        };

        // Momentum calculation methods
        this.calculators = {
            price: this.calculatePriceMomentum.bind(this),
            earnings: this.calculateEarningsMomentum.bind(this),
            volume: this.calculateVolumeMomentum.bind(this),
            fundamental: this.calculateFundamentalMomentum.bind(this),
            technical: this.calculateTechnicalMomentum.bind(this),
            relative: this.calculateRelativeMomentum.bind(this)
        };

        // Weight configurations for different market conditions
        this.marketWeights = {
            bull: {
                price: 0.35,
                earnings: 0.20,
                volume: 0.20,
                fundamental: 0.15,
                technical: 0.10
            },
            bear: {
                price: 0.20,
                earnings: 0.30,
                volume: 0.15,
                fundamental: 0.25,
                technical: 0.10
            },
            neutral: {
                price: 0.25,
                earnings: 0.25,
                volume: 0.15,
                fundamental: 0.20,
                technical: 0.15
            }
        };

        console.log('✅ MomentumCalculator initialized');
    }

    /**
     * Calculate all momentum metrics for a company
     * @param {Object} company - Company data
     * @returns {Object} Momentum metrics
     */
    calculate(company) {
        if (!company) {
            return this.getEmptyMomentum();
        }

        const momentum = {
            timestamp: Date.now(),
            ticker: company.Ticker,

            // Individual momentum types
            price: this.calculatePriceMomentum(company),
            earnings: this.calculateEarningsMomentum(company),
            volume: this.calculateVolumeMomentum(company),
            fundamental: this.calculateFundamentalMomentum(company),
            technical: this.calculateTechnicalMomentum(company),
            relative: this.calculateRelativeMomentum(company),

            // Time-based momentum
            shortTerm: this.calculateShortTermMomentum(company),
            mediumTerm: this.calculateMediumTermMomentum(company),
            longTerm: this.calculateLongTermMomentum(company),

            // Composite scores
            composite: 0,
            rank: 0,
            percentile: 0,

            // Momentum characteristics
            strength: 'neutral',
            trend: 'sideways',
            volatility: 'normal',
            consistency: 0
        };

        // Calculate composite score
        momentum.composite = this.calculateCompositeScore(momentum);

        // Determine momentum characteristics
        momentum.strength = this.determineMomentumStrength(momentum);
        momentum.trend = this.determineTrend(momentum);
        momentum.volatility = this.calculateVolatility(company);
        momentum.consistency = this.calculateConsistency(momentum);

        return momentum;
    }

    /**
     * Calculate price momentum
     * @private
     */
    calculatePriceMomentum(company) {
        const momentum = {
            score: 0,
            signals: [],
            metrics: {}
        };

        // Return-based momentum
        const returns = {
            daily: company.returnDaily || 0,
            weekly: company.returnWeekly || 0,
            monthly: company.return1M || 0,
            quarterly: company.return3M || 0,
            halfYear: company.return6M || 0,
            yearly: company.return1Y || 0,
            ytd: company.returnYTD || 0
        };

        // Calculate weighted return momentum
        const weightedReturn =
            returns.monthly * 0.30 +
            returns.quarterly * 0.25 +
            returns.halfYear * 0.20 +
            returns.yearly * 0.15 +
            returns.ytd * 0.10;

        momentum.metrics.weightedReturn = weightedReturn;

        // Calculate rate of change (ROC)
        momentum.metrics.roc1M = returns.monthly;
        momentum.metrics.roc3M = returns.quarterly;
        momentum.metrics.roc6M = returns.halfYear;

        // Price position relative to 52-week range
        if (company.high52Week && company.low52Week && company.currentPrice) {
            const range = company.high52Week - company.low52Week;
            const position = (company.currentPrice - company.low52Week) / range;
            momentum.metrics.relativePosition = position;

            // Add signal based on position
            if (position > 0.8) {
                momentum.signals.push({ type: 'bullish', strength: 'strong', reason: 'Near 52W high' });
            } else if (position < 0.2) {
                momentum.signals.push({ type: 'bearish', strength: 'strong', reason: 'Near 52W low' });
            }
        }

        // Moving average signals (if available)
        if (company.ma20 && company.ma50 && company.ma200) {
            const price = company.currentPrice;

            if (price > company.ma20 && company.ma20 > company.ma50 && company.ma50 > company.ma200) {
                momentum.signals.push({ type: 'bullish', strength: 'strong', reason: 'Perfect MA alignment' });
                momentum.metrics.maScore = 1.0;
            } else if (price < company.ma20 && company.ma20 < company.ma50 && company.ma50 < company.ma200) {
                momentum.signals.push({ type: 'bearish', strength: 'strong', reason: 'Negative MA alignment' });
                momentum.metrics.maScore = -1.0;
            } else {
                momentum.metrics.maScore = 0;
            }
        }

        // Calculate final score (normalize to 0-100)
        momentum.score = this.normalizeScore(weightedReturn, -50, 50) * 100;

        return momentum;
    }

    /**
     * Calculate earnings momentum
     * @private
     */
    calculateEarningsMomentum(company) {
        const momentum = {
            score: 0,
            signals: [],
            metrics: {}
        };

        // Earnings growth rates
        const epsGrowth = company.epsGrowthYoY || 0;
        const salesGrowth = company.salesGrowthYoY || 0;
        const ebitGrowth = company.ebitGrowthYoY || 0;

        // Calculate weighted earnings momentum
        momentum.metrics.epsGrowth = epsGrowth;
        momentum.metrics.salesGrowth = salesGrowth;
        momentum.metrics.ebitGrowth = ebitGrowth;

        const weightedGrowth =
            epsGrowth * 0.40 +
            salesGrowth * 0.35 +
            ebitGrowth * 0.25;

        momentum.metrics.weightedGrowth = weightedGrowth;

        // Earnings surprise (if available)
        if (company.earningsSurprise) {
            momentum.metrics.surprise = company.earningsSurprise;

            if (company.earningsSurprise > 5) {
                momentum.signals.push({ type: 'bullish', strength: 'strong', reason: 'Positive earnings surprise' });
            } else if (company.earningsSurprise < -5) {
                momentum.signals.push({ type: 'bearish', strength: 'strong', reason: 'Negative earnings surprise' });
            }
        }

        // Earnings revision momentum
        if (company.earningsRevisionUp && company.earningsRevisionDown) {
            const revisionRatio = company.earningsRevisionUp / (company.earningsRevisionDown + 1);
            momentum.metrics.revisionRatio = revisionRatio;

            if (revisionRatio > 2) {
                momentum.signals.push({ type: 'bullish', strength: 'medium', reason: 'Positive revisions' });
            } else if (revisionRatio < 0.5) {
                momentum.signals.push({ type: 'bearish', strength: 'medium', reason: 'Negative revisions' });
            }
        }

        // Calculate acceleration
        if (company.epsGrowthPrevious) {
            const acceleration = epsGrowth - company.epsGrowthPrevious;
            momentum.metrics.acceleration = acceleration;

            if (acceleration > 10) {
                momentum.signals.push({ type: 'bullish', strength: 'strong', reason: 'Earnings acceleration' });
            } else if (acceleration < -10) {
                momentum.signals.push({ type: 'bearish', strength: 'strong', reason: 'Earnings deceleration' });
            }
        }

        // Calculate final score
        momentum.score = this.normalizeScore(weightedGrowth, -20, 30) * 100;

        return momentum;
    }

    /**
     * Calculate volume momentum
     * @private
     */
    calculateVolumeMomentum(company) {
        const momentum = {
            score: 0,
            signals: [],
            metrics: {}
        };

        // Volume indicators
        const volumeRatio = company.volumeRatio || 1.0;
        const avgVolume = company.avgVolume || 0;
        const currentVolume = company.volume || 0;

        momentum.metrics.volumeRatio = volumeRatio;
        momentum.metrics.avgVolume = avgVolume;

        // Volume trend
        if (avgVolume > 0) {
            const volumeTrend = (currentVolume - avgVolume) / avgVolume;
            momentum.metrics.volumeTrend = volumeTrend;

            if (volumeTrend > 0.5 && company.returnDaily > 0) {
                momentum.signals.push({ type: 'bullish', strength: 'medium', reason: 'Volume surge on up day' });
            } else if (volumeTrend > 0.5 && company.returnDaily < 0) {
                momentum.signals.push({ type: 'bearish', strength: 'medium', reason: 'Volume surge on down day' });
            }
        }

        // On-Balance Volume trend (if available)
        if (company.obv && company.obvMA) {
            const obvTrend = (company.obv - company.obvMA) / company.obvMA;
            momentum.metrics.obvTrend = obvTrend;

            if (obvTrend > 0.1) {
                momentum.signals.push({ type: 'bullish', strength: 'medium', reason: 'Positive OBV trend' });
            } else if (obvTrend < -0.1) {
                momentum.signals.push({ type: 'bearish', strength: 'medium', reason: 'Negative OBV trend' });
            }
        }

        // Money Flow (if available)
        if (company.moneyFlow) {
            momentum.metrics.moneyFlow = company.moneyFlow;

            if (company.moneyFlow > 70) {
                momentum.signals.push({ type: 'bullish', strength: 'strong', reason: 'Strong money inflow' });
            } else if (company.moneyFlow < 30) {
                momentum.signals.push({ type: 'bearish', strength: 'strong', reason: 'Strong money outflow' });
            }
        }

        // Calculate final score
        const baseScore = volumeRatio > 1.5 ? 70 : volumeRatio < 0.5 ? 30 : 50;
        momentum.score = baseScore + (momentum.metrics.obvTrend || 0) * 20;

        return momentum;
    }

    /**
     * Calculate fundamental momentum
     * @private
     */
    calculateFundamentalMomentum(company) {
        const momentum = {
            score: 0,
            signals: [],
            metrics: {}
        };

        // ROE trend
        const roe = company.roeFwd || company.roe || 0;
        const roePrevious = company.roePrevious || roe;
        const roeTrend = roe - roePrevious;

        momentum.metrics.roe = roe;
        momentum.metrics.roeTrend = roeTrend;

        if (roeTrend > 2) {
            momentum.signals.push({ type: 'bullish', strength: 'medium', reason: 'Improving ROE' });
        } else if (roeTrend < -2) {
            momentum.signals.push({ type: 'bearish', strength: 'medium', reason: 'Declining ROE' });
        }

        // Margin trends
        const opm = company.opmFwd || company.opm || 0;
        const npm = company.npmFwd || company.npm || 0;

        momentum.metrics.operatingMargin = opm;
        momentum.metrics.netMargin = npm;

        // Valuation momentum
        const per = company.perCurrent || 0;
        const pbr = company.pbrCurrent || 0;
        const peg = company.pegCurrent || 0;

        momentum.metrics.per = per;
        momentum.metrics.pbr = pbr;
        momentum.metrics.peg = peg;

        // PEG-based signal
        if (peg > 0 && peg < 1) {
            momentum.signals.push({ type: 'bullish', strength: 'medium', reason: 'Attractive PEG ratio' });
        } else if (peg > 2) {
            momentum.signals.push({ type: 'bearish', strength: 'medium', reason: 'High PEG ratio' });
        }

        // Free Cash Flow trend
        if (company.fcfGrowth) {
            momentum.metrics.fcfGrowth = company.fcfGrowth;

            if (company.fcfGrowth > 20) {
                momentum.signals.push({ type: 'bullish', strength: 'strong', reason: 'Strong FCF growth' });
            } else if (company.fcfGrowth < -20) {
                momentum.signals.push({ type: 'bearish', strength: 'strong', reason: 'Declining FCF' });
            }
        }

        // Quality score
        const qualityScore = this.calculateQualityScore(company);
        momentum.metrics.qualityScore = qualityScore;

        // Calculate final score
        const fundamentalScore =
            (roe > 15 ? 20 : 10) +
            (roeTrend > 0 ? 15 : 5) +
            (opm > 15 ? 15 : 5) +
            (peg > 0 && peg < 1.5 ? 20 : 10) +
            qualityScore * 30;

        momentum.score = Math.min(100, Math.max(0, fundamentalScore));

        return momentum;
    }

    /**
     * Calculate technical momentum
     * @private
     */
    calculateTechnicalMomentum(company) {
        const momentum = {
            score: 0,
            signals: [],
            metrics: {}
        };

        // RSI (Relative Strength Index)
        if (company.rsi) {
            momentum.metrics.rsi = company.rsi;

            if (company.rsi > 70) {
                momentum.signals.push({ type: 'bearish', strength: 'medium', reason: 'Overbought (RSI > 70)' });
            } else if (company.rsi < 30) {
                momentum.signals.push({ type: 'bullish', strength: 'medium', reason: 'Oversold (RSI < 30)' });
            }
        }

        // MACD
        if (company.macd && company.macdSignal) {
            const macdDiff = company.macd - company.macdSignal;
            momentum.metrics.macdDiff = macdDiff;

            if (macdDiff > 0 && company.macdPrevious < 0) {
                momentum.signals.push({ type: 'bullish', strength: 'strong', reason: 'MACD bullish crossover' });
            } else if (macdDiff < 0 && company.macdPrevious > 0) {
                momentum.signals.push({ type: 'bearish', strength: 'strong', reason: 'MACD bearish crossover' });
            }
        }

        // Bollinger Bands
        if (company.bollingerUpper && company.bollingerLower && company.currentPrice) {
            const bbWidth = company.bollingerUpper - company.bollingerLower;
            const bbPosition = (company.currentPrice - company.bollingerLower) / bbWidth;

            momentum.metrics.bollingerPosition = bbPosition;

            if (bbPosition > 0.95) {
                momentum.signals.push({ type: 'bearish', strength: 'medium', reason: 'At upper Bollinger Band' });
            } else if (bbPosition < 0.05) {
                momentum.signals.push({ type: 'bullish', strength: 'medium', reason: 'At lower Bollinger Band' });
            }
        }

        // Stochastic
        if (company.stochK && company.stochD) {
            momentum.metrics.stochK = company.stochK;
            momentum.metrics.stochD = company.stochD;

            if (company.stochK > 80 && company.stochD > 80) {
                momentum.signals.push({ type: 'bearish', strength: 'medium', reason: 'Stochastic overbought' });
            } else if (company.stochK < 20 && company.stochD < 20) {
                momentum.signals.push({ type: 'bullish', strength: 'medium', reason: 'Stochastic oversold' });
            }
        }

        // ADX (trend strength)
        if (company.adx) {
            momentum.metrics.adx = company.adx;

            if (company.adx > 25) {
                momentum.signals.push({ type: 'neutral', strength: 'strong', reason: 'Strong trend (ADX > 25)' });
            } else {
                momentum.signals.push({ type: 'neutral', strength: 'weak', reason: 'Weak trend (ADX < 25)' });
            }
        }

        // Calculate composite technical score
        let technicalScore = 50; // Neutral baseline

        // Adjust based on indicators
        if (momentum.metrics.rsi) {
            if (momentum.metrics.rsi > 50 && momentum.metrics.rsi < 70) {
                technicalScore += 10;
            } else if (momentum.metrics.rsi > 30 && momentum.metrics.rsi < 50) {
                technicalScore -= 10;
            }
        }

        if (momentum.metrics.macdDiff) {
            technicalScore += momentum.metrics.macdDiff > 0 ? 15 : -15;
        }

        if (momentum.metrics.bollingerPosition) {
            technicalScore += (momentum.metrics.bollingerPosition - 0.5) * 20;
        }

        momentum.score = Math.min(100, Math.max(0, technicalScore));

        return momentum;
    }

    /**
     * Calculate relative momentum (vs market/sector)
     * @private
     */
    calculateRelativeMomentum(company) {
        const momentum = {
            score: 0,
            signals: [],
            metrics: {}
        };

        // Relative strength vs market
        const marketReturn = company.marketReturn || 10; // Default market return
        const relativeReturn = (company.returnYTD || 0) - marketReturn;

        momentum.metrics.relativeReturn = relativeReturn;
        momentum.metrics.alpha = relativeReturn;

        if (relativeReturn > 10) {
            momentum.signals.push({ type: 'bullish', strength: 'strong', reason: 'Outperforming market' });
        } else if (relativeReturn < -10) {
            momentum.signals.push({ type: 'bearish', strength: 'strong', reason: 'Underperforming market' });
        }

        // Relative strength vs sector
        if (company.sectorReturn) {
            const sectorRelative = (company.returnYTD || 0) - company.sectorReturn;
            momentum.metrics.sectorRelative = sectorRelative;

            if (sectorRelative > 5) {
                momentum.signals.push({ type: 'bullish', strength: 'medium', reason: 'Sector outperformer' });
            } else if (sectorRelative < -5) {
                momentum.signals.push({ type: 'bearish', strength: 'medium', reason: 'Sector laggard' });
            }
        }

        // Beta-adjusted return
        const beta = company.beta || 1.0;
        const betaAdjustedReturn = (company.returnYTD || 0) / beta;
        momentum.metrics.betaAdjustedReturn = betaAdjustedReturn;

        // Percentile ranking (if available)
        if (company.returnPercentile) {
            momentum.metrics.percentile = company.returnPercentile;

            if (company.returnPercentile > 80) {
                momentum.signals.push({ type: 'bullish', strength: 'strong', reason: 'Top 20% performer' });
            } else if (company.returnPercentile < 20) {
                momentum.signals.push({ type: 'bearish', strength: 'strong', reason: 'Bottom 20% performer' });
            }
        }

        // Calculate final score
        momentum.score = this.normalizeScore(relativeReturn, -30, 30) * 100;

        return momentum;
    }

    /**
     * Calculate short-term momentum (1-20 days)
     * @private
     */
    calculateShortTermMomentum(company) {
        const returns = [
            company.return1D || 0,
            company.return1W || 0,
            company.return1M || 0
        ];

        const weights = [0.2, 0.3, 0.5];
        let weightedReturn = 0;

        for (let i = 0; i < returns.length; i++) {
            weightedReturn += returns[i] * weights[i];
        }

        return {
            score: this.normalizeScore(weightedReturn, -10, 10) * 100,
            trend: this.determineTrendFromReturns(returns),
            consistency: this.calculateConsistencyFromReturns(returns)
        };
    }

    /**
     * Calculate medium-term momentum (2-6 months)
     * @private
     */
    calculateMediumTermMomentum(company) {
        const returns = [
            company.return3M || 0,
            company.return6M || 0
        ];

        const weights = [0.4, 0.6];
        let weightedReturn = 0;

        for (let i = 0; i < returns.length; i++) {
            weightedReturn += returns[i] * weights[i];
        }

        return {
            score: this.normalizeScore(weightedReturn, -30, 30) * 100,
            trend: this.determineTrendFromReturns(returns),
            consistency: this.calculateConsistencyFromReturns(returns)
        };
    }

    /**
     * Calculate long-term momentum (1-3 years)
     * @private
     */
    calculateLongTermMomentum(company) {
        const returns = [
            company.return1Y || 0,
            company.return2Y || 0,
            company.return3Y || 0
        ];

        const weights = [0.5, 0.3, 0.2];
        let weightedReturn = 0;

        for (let i = 0; i < returns.length; i++) {
            if (returns[i]) {
                weightedReturn += returns[i] * weights[i];
            }
        }

        return {
            score: this.normalizeScore(weightedReturn, -50, 100) * 100,
            trend: this.determineTrendFromReturns(returns),
            consistency: this.calculateConsistencyFromReturns(returns)
        };
    }

    /**
     * Calculate composite momentum score
     * @private
     */
    calculateCompositeScore(momentum, marketCondition = 'neutral') {
        const weights = this.marketWeights[marketCondition];

        let compositeScore = 0;
        let totalWeight = 0;

        for (const [type, weight] of Object.entries(weights)) {
            if (momentum[type] && momentum[type].score !== undefined) {
                compositeScore += momentum[type].score * weight;
                totalWeight += weight;
            }
        }

        return totalWeight > 0 ? compositeScore / totalWeight : 0;
    }

    /**
     * Calculate quality score
     * @private
     */
    calculateQualityScore(company) {
        let score = 0;
        let factors = 0;

        // ROE quality
        if (company.roeFwd > 15) {
            score += 1;
            factors++;
        }

        // Debt quality
        if (company.debtEquityRatio !== undefined && company.debtEquityRatio < 0.5) {
            score += 1;
            factors++;
        }

        // Margin quality
        if (company.opmFwd > 15) {
            score += 1;
            factors++;
        }

        // Cash flow quality
        if (company.fcfYield > 5) {
            score += 1;
            factors++;
        }

        // Growth quality
        if (company.salesCagr3 > 10) {
            score += 1;
            factors++;
        }

        return factors > 0 ? score / factors : 0.5;
    }

    /**
     * Determine momentum strength
     * @private
     */
    determineMomentumStrength(momentum) {
        const score = momentum.composite;

        if (score >= 70) return 'very strong';
        if (score >= 55) return 'strong';
        if (score >= 45) return 'neutral';
        if (score >= 30) return 'weak';
        return 'very weak';
    }

    /**
     * Determine trend direction
     * @private
     */
    determineTrend(momentum) {
        // Count bullish vs bearish signals
        let bullish = 0;
        let bearish = 0;

        const allSignals = [
            ...(momentum.price?.signals || []),
            ...(momentum.earnings?.signals || []),
            ...(momentum.volume?.signals || []),
            ...(momentum.fundamental?.signals || []),
            ...(momentum.technical?.signals || [])
        ];

        for (const signal of allSignals) {
            if (signal.type === 'bullish') bullish++;
            if (signal.type === 'bearish') bearish++;
        }

        if (bullish > bearish * 2) return 'strong uptrend';
        if (bullish > bearish) return 'uptrend';
        if (bearish > bullish * 2) return 'strong downtrend';
        if (bearish > bullish) return 'downtrend';
        return 'sideways';
    }

    /**
     * Determine trend from returns array
     * @private
     */
    determineTrendFromReturns(returns) {
        const validReturns = returns.filter(r => r !== null && r !== undefined);

        if (validReturns.length === 0) return 'unknown';

        // Check if returns are consistently positive or negative
        const allPositive = validReturns.every(r => r > 0);
        const allNegative = validReturns.every(r => r < 0);

        if (allPositive) return 'uptrend';
        if (allNegative) return 'downtrend';

        // Check if trending up or down
        let increasing = true;
        let decreasing = true;

        for (let i = 1; i < validReturns.length; i++) {
            if (validReturns[i] <= validReturns[i - 1]) increasing = false;
            if (validReturns[i] >= validReturns[i - 1]) decreasing = false;
        }

        if (increasing) return 'accelerating';
        if (decreasing) return 'decelerating';
        return 'mixed';
    }

    /**
     * Calculate volatility
     * @private
     */
    calculateVolatility(company) {
        // Use various volatility measures
        const beta = company.beta || 1.0;
        const stdDev = company.standardDeviation || 20;

        if (beta > 1.5 || stdDev > 40) return 'high';
        if (beta < 0.8 || stdDev < 15) return 'low';
        return 'normal';
    }

    /**
     * Calculate consistency from returns
     * @private
     */
    calculateConsistencyFromReturns(returns) {
        const validReturns = returns.filter(r => r !== null && r !== undefined);

        if (validReturns.length < 2) return 0;

        // Calculate standard deviation
        const mean = validReturns.reduce((a, b) => a + b, 0) / validReturns.length;
        const squaredDiffs = validReturns.map(r => Math.pow(r - mean, 2));
        const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / validReturns.length;
        const stdDev = Math.sqrt(avgSquaredDiff);

        // Lower std dev = higher consistency
        const consistency = Math.max(0, 1 - (stdDev / Math.abs(mean || 1)));

        return consistency;
    }

    /**
     * Calculate consistency score
     * @private
     */
    calculateConsistency(momentum) {
        const scores = [
            momentum.price?.score || 50,
            momentum.earnings?.score || 50,
            momentum.volume?.score || 50,
            momentum.fundamental?.score || 50,
            momentum.technical?.score || 50
        ];

        // Calculate coefficient of variation
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const squaredDiffs = scores.map(s => Math.pow(s - mean, 2));
        const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / scores.length;
        const stdDev = Math.sqrt(avgSquaredDiff);

        // Lower variation = higher consistency
        const consistency = Math.max(0, 1 - (stdDev / (mean || 1)));

        return consistency;
    }

    /**
     * Normalize score to 0-1 range
     * @private
     */
    normalizeScore(value, min, max) {
        if (value <= min) return 0;
        if (value >= max) return 1;
        return (value - min) / (max - min);
    }

    /**
     * Get empty momentum object
     * @private
     */
    getEmptyMomentum() {
        return {
            timestamp: Date.now(),
            ticker: null,
            price: { score: 0, signals: [], metrics: {} },
            earnings: { score: 0, signals: [], metrics: {} },
            volume: { score: 0, signals: [], metrics: {} },
            fundamental: { score: 0, signals: [], metrics: {} },
            technical: { score: 0, signals: [], metrics: {} },
            relative: { score: 0, signals: [], metrics: {} },
            shortTerm: { score: 0, trend: 'unknown', consistency: 0 },
            mediumTerm: { score: 0, trend: 'unknown', consistency: 0 },
            longTerm: { score: 0, trend: 'unknown', consistency: 0 },
            composite: 0,
            rank: 0,
            percentile: 0,
            strength: 'neutral',
            trend: 'sideways',
            volatility: 'normal',
            consistency: 0
        };
    }

    /**
     * Destroy calculator
     */
    destroy() {
        // Clean up if needed
        console.log('✅ MomentumCalculator destroyed');
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.MomentumCalculator = MomentumCalculator;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MomentumCalculator;
}