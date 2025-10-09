/**
 * PortfolioOptimizer - 간소화된 AI 기반 포트폴리오 최적화 엔진
 *
 * 접근 방식:
 * - 기대수익률(Return (Y))과 모멘텀(3M/6M), 리스크 프록시(절대값) 사용
 * - Sharpe 유사 스코어 = 기대수익률 / (리스크 + 베타)
 * - 제약조건: 최대 비중, 최소 비중, 목표수익률 충족 여부
 */
class PortfolioOptimizer {
    constructor() {
        this.config = {
            defaultMaxWeight: 0.25,
            defaultMinWeight: 0.02,
            baselineRisk: 0.05
        };
    }

    optimize({ holdings = [], constraints = {} }) {
        if (!holdings.length) {
            return {
                holdings: [],
                notes: ['선택된 종목이 없어 최적화를 수행하지 않았습니다.'],
                expectedReturn: 0,
                estimatedRisk: 0
            };
        }

        const maxWeight = constraints.maxWeight ?? this.config.defaultMaxWeight;
        const minWeight = constraints.minWeight ?? this.config.defaultMinWeight;
        const targetReturn = constraints.targetReturn ?? null;

        const scored = holdings.map(item => {
            const { company } = item;
            const expectedReturn = this.parseNumber(company['Return (Y)']);
            const momentum3M = this.parseNumber(company['3 M']);
            const momentum6M = this.parseNumber(company['6 M']);
            const riskProxy = this.computeRiskProxy(company);

            const aggregatedReturn = this.safeAverage([
                expectedReturn,
                momentum3M,
                momentum6M
            ]);

            const score = this.computeScore(aggregatedReturn, riskProxy);

            return {
                ticker: item.ticker,
                company,
                expectedReturn: aggregatedReturn,
                riskProxy,
                score
            };
        });

        scored.sort((a, b) => (b.score || 0) - (a.score || 0));

        let remaining = 1;
        const optimizedHoldings = [];
        scored.forEach(entry => {
            if (remaining <= 0) return;
            const allocation = Math.min(maxWeight, Math.max(minWeight, entry.score));
            const weight = Math.min(allocation, remaining);
            remaining -= weight;

            optimizedHoldings.push({
                ticker: entry.ticker,
                weight,
                company: entry.company,
                expectedReturn: entry.expectedReturn,
                riskProxy: entry.riskProxy
            });
        });

        if (remaining > 0 && optimizedHoldings.length) {
            const spread = remaining / optimizedHoldings.length;
            optimizedHoldings.forEach(entry => {
                entry.weight += spread;
            });
        }

        const totalWeight = optimizedHoldings.reduce((sum, item) => sum + item.weight, 0) || 1;
        optimizedHoldings.forEach(item => item.weight = item.weight / totalWeight);

        const portfolioReturn = this.safeAverage(
            optimizedHoldings.map(item => item.expectedReturn * (item.weight || 0))
        ) || 0;

        const portfolioRisk = this.safeAverage(
            optimizedHoldings.map(item => item.riskProxy * (item.weight || 0))
        ) || this.config.baselineRisk;

        const meetsTarget = targetReturn ? portfolioReturn >= targetReturn : true;

        const notes = [];
        if (!meetsTarget) {
            notes.push(`최적화 결과 목표 수익률(${(targetReturn * 100).toFixed(1)}%) 미충족 → ${(portfolioReturn * 100).toFixed(1)}%`);
        } else {
            notes.push('최적화 결과 제약 조건 내에서 균형 잡힌 비중을 생성했습니다.');
        }

        return {
            holdings: optimizedHoldings,
            expectedReturn: portfolioReturn,
            estimatedRisk: portfolioRisk,
            sharpe: portfolioRisk ? portfolioReturn / portfolioRisk : null,
            meetsTarget,
            notes
        };
    }

    computeScore(expectedReturn, riskProxy) {
        if (!Number.isFinite(expectedReturn)) return 0;
        const risk = Number.isFinite(riskProxy) ? riskProxy : this.config.baselineRisk;
        const adjustedRisk = Math.max(risk, 0.01);
        const sharpeLike = expectedReturn / adjustedRisk;
        return Math.max(sharpeLike, 0.01);
    }

    computeRiskProxy(company) {
        const volatilityCandidates = [
            this.parseNumber(company['3 M']),
            this.parseNumber(company['6 M']),
            this.parseNumber(company['12 M'])
        ].filter(Number.isFinite).map(Math.abs);

        if (volatilityCandidates.length) {
            return this.safeAverage(volatilityCandidates);
        }

        const per = this.parseNumber(company['PER (Oct-25)']);
        if (Number.isFinite(per) && per > 0) {
            return Math.min(0.4, per / 100);
        }

        return this.config.baselineRisk;
    }

    parseNumber(value) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const cleaned = value.replace(/[^0-9.+-]/g, '');
            if (cleaned === '') return NaN;
            return Number(cleaned);
        }
        return NaN;
    }

    safeAverage(values) {
        const filtered = values.filter(Number.isFinite);
        if (!filtered.length) return null;
        const sum = filtered.reduce((acc, cur) => acc + cur, 0);
        return sum / filtered.length;
    }
}

window.PortfolioOptimizerCore = PortfolioOptimizer;

console.log('✅ PortfolioOptimizerCore 로드 완료 - 포트폴리오 최적화 엔진');
