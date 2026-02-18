/**
 * Portfolio - 포트폴리오 상태 관리 및 집계 전담 클래스
 *
 * - 보유 종목(holdings)은 ticker를 key로 하여 Map 형태로 저장
 * - 각 항목은 { company, weight, capital } 구조를 유지
 * - 입력 데이터에 따라 자동으로 기본 weight(동일 비중) 배분
 */
class Portfolio {
    constructor(initialCapital = 1000000) {
        this.capital = initialCapital;
        this.holdings = new Map();
    }

    /**
     * 종목 추가 (이미 존재 시 weight만 업데이트)
     */
    upsertHolding(company, weight = null) {
        if (!company) return;
        const ticker = company.Ticker || company.ticker;
        if (!ticker) return;

        const targetWeight = weight ?? this.getSuggestedWeight();
        const clampedWeight = this.clampWeight(targetWeight);

        const existing = this.holdings.get(ticker);
        if (existing) {
            existing.weight = clampedWeight;
        } else {
            this.holdings.set(ticker, {
                company,
                weight: clampedWeight
            });
        }

        this.normalizeWeights();
    }

    /**
     * Weight 직접 수정
     */
    updateWeight(ticker, weight) {
        if (!this.holdings.has(ticker)) return;
        const holding = this.holdings.get(ticker);
        holding.weight = this.clampWeight(weight);
        this.normalizeWeights();
    }

    /**
     * 종목 제거
     */
    removeHolding(ticker) {
        if (this.holdings.delete(ticker)) {
            this.normalizeWeights();
        }
    }

    /**
     * 전체 제거
     */
    clear() {
        this.holdings.clear();
    }

    getHoldings() {
        return Array.from(this.holdings.entries()).map(([ticker, entry]) => ({
            ticker,
            company: entry.company,
            weight: entry.weight
        }));
    }

    /**
     * 포트폴리오 전체를 균등 가중치로 리밸런싱
     */
    rebalanceEqual() {
        const count = this.holdings.size;
        if (!count) return;
        const weight = 1 / count;
        this.holdings.forEach(entry => {
            entry.weight = weight;
        });
    }

    /**
     * 특정 지표의 가중평균치를 계산
     */
    getWeightedMetric(key, fallback = null) {
        if (!this.holdings.size) return fallback;
        let total = 0;
        let weightSum = 0;

        this.holdings.forEach(({ company, weight }) => {
            const value = this.parseNumeric(company[key]);
            if (Number.isFinite(value)) {
                total += value * weight;
                weightSum += weight;
            }
        });

        if (!weightSum) return fallback;
        return total / weightSum;
    }

    /**
     * 포트폴리오 메트릭 요약 반환
     */
    summarize() {
        const expectedReturn = this.getWeightedMetric('Return (Y)', 0);
        const salesGrowth = this.getWeightedMetric('Sales (3)', 0);
        const dividendYield = this.getWeightedMetric('DY (FY+1)', 0);
        const roe = this.getWeightedMetric('ROE (Fwd)', 0);
        const per = this.getWeightedMetric('PER (Oct-25)', null);
        const marketCap = this.getWeightedMetric('(USD mn)', null);

        return {
            expectedReturn,
            salesGrowth,
            dividendYield,
            roe,
            per,
            marketCap
        };
    }

    /**
     * 추천 weight (동일 비중 기준)
     */
    getSuggestedWeight() {
        const count = Math.max(this.holdings.size + 1, 1);
        return 1 / count;
    }

    clampWeight(weight) {
        if (!Number.isFinite(weight)) return 0;
        return Math.min(Math.max(weight, 0), 1);
    }

    normalizeWeights() {
        let total = 0;
        this.holdings.forEach(entry => {
            if (Number.isFinite(entry.weight)) {
                total += entry.weight;
            }
        });

        if (!total || total === 1) return;

        this.holdings.forEach(entry => {
            entry.weight = total ? entry.weight / total : 0;
        });
    }

    parseNumeric(value) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const cleaned = value.replace(/[^0-9.+-]/g, '');
            if (cleaned === '') return NaN;
            return Number(cleaned);
        }
        return NaN;
    }
}

window.PortfolioCore = Portfolio;

console.log('✅ PortfolioCore 로드 완료 - 포트폴리오 상태 관리자');
