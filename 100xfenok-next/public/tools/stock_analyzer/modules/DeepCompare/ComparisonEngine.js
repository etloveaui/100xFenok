/**
 * ComparisonEngine - 데이터 정규화와 비교 분석 계산을 전담하는 모듈
 *
 * 이 엔진은 DeepCompare 모듈에서 사용하는 모든 수치 계산을 담당합니다.
 * - 4차원 버블 차트용 데이터 변환
 * - 레이더/히트맵 시각화를 위한 값 정규화
 * - 업종/거래소 단위의 집계 지원
 * - 요약 인사이트 생성에 필요한 지표 산출
 *
 * 의존성: 없음 (Chart.js 등 시각화 라이브러리와 직접 결합하지 않습니다)
 */
class ComparisonEngine {
    constructor() {
        this.dimensionConfig = {
            profitability: { key: 'ROE (Fwd)', label: 'ROE (Fwd)', min: -0.2, max: 0.5 },
            growth: { key: 'Sales (3)', label: 'Sales Growth 3Y', min: -0.5, max: 0.4 },
            valuation: { key: 'PER (Oct-25)', label: 'PER (Oct-25)', min: 0, max: 80, reverse: true },
            dividend: { key: 'DY (FY+1)', label: 'DY (FY+1)', min: 0, max: 0.1 },
            momentum: { key: 'Return (Y)', label: 'Return (1Y)', min: -0.6, max: 1.0 },
            size: { key: '(USD mn)', label: 'Market Cap (USD mn)', min: 0, max: 6000000 },
            price: { key: '현재가', label: 'Price', min: 0, max: 5000 }
        };
    }

    /**
     * 데이터에서 비교 대상 후보를 추출합니다.
     * @param {Array} data - 원본 데이터 (window.allData)
     * @param {string} mode - companies | sectors | countries
     * @returns {Array}
     */
    getCandidates(data = [], mode = 'companies') {
        if (!Array.isArray(data)) return [];

        if (mode === 'sectors') {
            return this.aggregateByGrouping(data, 'industry');
        }

        if (mode === 'countries') {
            // 데이터에 국가 정보가 없을 수 있으므로 거래소 기준으로 대체
            const groupingKey = data[0] && ('country' in data[0] ? 'country' : 'exchange');
            return this.aggregateByGrouping(data, groupingKey);
        }

        // 기본: 기업 단위
        return data.map(item => ({
            type: 'company',
            id: item.Ticker || item.ticker || item.corpName,
            name: `${item.Ticker || item.ticker || ''} ${item.corpName || ''}`.trim(),
            raw: item,
            metrics: this.buildMetricSnapshot(item)
        }));
    }

    /**
     * 기업 단위 스냅샷을 생성합니다.
     * @param {Object} company
     * @returns {Object}
     */
    buildMetricSnapshot(company = {}) {
        const metrics = {};

        for (const [alias, config] of Object.entries(this.dimensionConfig)) {
            const value = this.parseNumeric(company[config.key]);
            metrics[alias] = {
                raw: value,
                normalized: this.normalize(value, config)
            };
        }

        metrics.score = this.computeCompositeScore(metrics);
        metrics.volatility = this.estimateVolatility(company);
        metrics.returnStreak = this.buildMomentumSnapshot(company);

        return metrics;
    }

    /**
     * 업종/국가 등 그룹 단위 집계
     */
    aggregateByGrouping(data, key) {
        if (!key) return [];

        const groups = new Map();

        data.forEach(item => {
            const groupId = item[key] || '기타';
            if (!groups.has(groupId)) {
                groups.set(groupId, []);
            }
            groups.get(groupId).push(item);
        });

        return Array.from(groups.entries()).map(([groupId, items]) => {
            const aggregate = this.aggregateCompanies(items);
            return {
                type: 'group',
                id: groupId,
                name: groupId,
                constituents: items,
                metrics: aggregate
            };
        });
    }

    /**
     * 다수 기업을 평균화하여 그룹 메트릭을 생성합니다.
     */
    aggregateCompanies(companies) {
        if (!companies.length) {
            return this.emptyMetricSet();
        }

        const metricKeys = Object.keys(this.dimensionConfig);
        const sums = {};
        metricKeys.forEach(key => sums[key] = 0);

        companies.forEach(company => {
            const snapshot = this.buildMetricSnapshot(company);
            metricKeys.forEach(key => {
                sums[key] += snapshot[key].raw ?? 0;
            });
        });

        const aggregated = {};
        metricKeys.forEach(key => {
            const average = sums[key] / companies.length;
            const config = this.dimensionConfig[key];
            aggregated[key] = {
                raw: average,
                normalized: this.normalize(average, config)
            };
        });

        aggregated.score = this.computeCompositeScore(aggregated);
        aggregated.volatility = this.average(
            companies.map(company => this.estimateVolatility(company))
        );
        aggregated.returnStreak = this.averageMomentum(companies);

        return aggregated;
    }

    /**
     * 4차원 버블 차트 데이터 생성
     */
    buildBubbleDataset(entities = []) {
        return entities.map(entity => {
            const metrics = entity.metrics || this.buildMetricSnapshot(entity.raw || {});
            const roe = metrics.profitability?.raw ?? 0;
            const growth = metrics.growth?.raw ?? 0;
            const marketCap = entity.raw ? this.parseNumeric(entity.raw['(USD mn)']) : 0;
            const per = metrics.valuation?.raw ?? 0;

            return {
                x: roe,
                y: growth,
                r: this.getBubbleRadius(marketCap),
                backgroundColor: this.colorByValuation(per),
                label: entity.name,
                meta: {
                    id: entity.id,
                    type: entity.type,
                    marketCap,
                    per,
                    momentum: metrics.momentum?.raw ?? 0,
                    dividend: metrics.dividend?.raw ?? 0,
                    score: metrics.score
                }
            };
        });
    }

    /**
     * 레이더 차트 데이터 구성
     */
    buildRadarDataset(entities = []) {
        const labels = [
            this.dimensionConfig.profitability.label,
            this.dimensionConfig.growth.label,
            this.dimensionConfig.momentum.label,
            this.dimensionConfig.valuation.label,
            this.dimensionConfig.dividend.label
        ];

        const datasets = entities.map((entity, index) => {
            const metrics = entity.metrics || this.buildMetricSnapshot(entity.raw || {});
            return {
                label: entity.name,
                data: [
                    (metrics.profitability?.normalized ?? 0) * 100,
                    (metrics.growth?.normalized ?? 0) * 100,
                    (metrics.momentum?.normalized ?? 0) * 100,
                    (metrics.valuation?.normalized ?? 0) * 100,
                    (metrics.dividend?.normalized ?? 0) * 100
                ],
                borderWidth: 2,
                fill: true,
                borderColor: this.palette(index),
                backgroundColor: this.palette(index, 0.2),
                pointBackgroundColor: this.palette(index)
            };
        });

        return { labels, datasets };
    }

    /**
     * 비교 테이블 데이터 생성
     */
    buildComparisonTable(entities = []) {
        return entities.map(entity => {
            const metrics = entity.metrics || this.buildMetricSnapshot(entity.raw || {});

            return {
                id: entity.id,
                name: entity.name,
                profitability: this.toDisplay(metrics.profitability?.raw, true),
                growth: this.toDisplay(metrics.growth?.raw, true),
                momentum: this.toDisplay(metrics.momentum?.raw, true),
                valuation: this.toDisplay(metrics.valuation?.raw, false),
                dividend: this.toDisplay(metrics.dividend?.raw, true),
                score: metrics.score.toFixed(2),
                risk: metrics.volatility !== null ? `${(metrics.volatility * 100).toFixed(1)}%` : 'N/A'
            };
        });
    }

    /**
     * 텍스트 인사이트 생성
     */
    buildInsights(entities = []) {
        if (!entities.length) {
            return [];
        }

        const bestScore = [...entities].sort((a, b) => (b.metrics?.score || 0) - (a.metrics?.score || 0))[0];
        const bestGrowth = [...entities].sort((a, b) => (b.metrics?.growth?.raw || 0) - (a.metrics?.growth?.raw || 0))[0];
        const bestValue = [...entities].sort((a, b) => (a.metrics?.valuation?.raw || Infinity) - (b.metrics?.valuation?.raw || Infinity))[0];

        const insights = [];

        if (bestScore) {
            insights.push(`종합 점수가 가장 높은 대상은 ${bestScore.name}입니다. (Score ${bestScore.metrics.score.toFixed(2)})`);
        }
        if (bestGrowth) {
            insights.push(`${bestGrowth.name}이(가) 가장 높은 성장률을 기록하고 있습니다.`);
        }
        if (bestValue) {
            insights.push(`${bestValue.name}은(는) 밸류에이션 매력이 가장 높습니다 (PER ${this.toDisplay(bestValue.metrics.valuation?.raw, false)}).`);
        }

        return insights;
    }

    /**
     * 보조 메서드들
     */
    parseNumeric(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number') return value;
        const sanitized = String(value).replace(/[^0-9.+-]/g, '');
        if (sanitized === '') return null;
        const parsed = Number(sanitized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    normalize(value, config) {
        if (value === null || value === undefined || !config) return 0;
        const { min, max, reverse } = config;
        const clamped = Math.min(Math.max(value, min), max);
        const ratio = (clamped - min) / (max - min || 1);
        const normalized = reverse ? 1 - ratio : ratio;
        return Number.isFinite(normalized) ? normalized : 0;
    }

    computeCompositeScore(metrics) {
        const weights = {
            profitability: 0.25,
            growth: 0.2,
            momentum: 0.2,
            valuation: 0.2,
            dividend: 0.15
        };

        let score = 0;
        let totalWeight = 0;

        for (const [key, weight] of Object.entries(weights)) {
            const normalized = metrics[key]?.normalized;
            if (typeof normalized === 'number') {
                score += normalized * weight;
                totalWeight += weight;
            }
        }

        return totalWeight > 0 ? (score / totalWeight) * 5 : 0;
    }

    getBubbleRadius(marketCap) {
        if (!Number.isFinite(marketCap) || marketCap <= 0) return 6;
        const scaled = Math.sqrt(marketCap) / 100;
        return Math.min(Math.max(scaled, 6), 40);
    }

    colorByValuation(per) {
        if (!Number.isFinite(per)) return 'rgba(100, 116, 139, 0.8)'; // gray
        if (per < 10) return 'rgba(22, 163, 74, 0.8)';               // green
        if (per < 25) return 'rgba(59, 130, 246, 0.8)';              // blue
        if (per < 45) return 'rgba(234, 179, 8, 0.8)';               // amber
        return 'rgba(239, 68, 68, 0.8)';                             // red
    }

    palette(index, alpha = 0.7) {
        const colors = [
            [59, 130, 246],   // blue
            [16, 185, 129],   // emerald
            [251, 146, 60],   // orange
            [139, 92, 246],   // violet
            [236, 72, 153],   // pink
            [96, 165, 250]    // light blue
        ];
        const [r, g, b] = colors[index % colors.length];
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    toDisplay(value, toPercent = false) {
        if (!Number.isFinite(value)) return 'N/A';
        if (toPercent) {
            return `${(value * 100).toFixed(1)}%`;
        }
        if (Math.abs(value) >= 1000) {
            return value.toFixed(1);
        }
        return value.toFixed(2);
    }

    estimateVolatility(company) {
        const daily = this.parseNumeric(company?.['1 M']);
        const threeMonth = this.parseNumeric(company?.['3 M']);
        const sixMonth = this.parseNumeric(company?.['6 M']);

        const values = [daily, threeMonth, sixMonth].filter(v => Number.isFinite(v));
        if (!values.length) return null;

        const avg = this.average(values);
        const variance = this.average(values.map(v => Math.pow(v - avg, 2)));
        return Math.sqrt(Math.abs(variance));
    }

    buildMomentumSnapshot(company) {
        const streakKeys = ['1 M', '3 M', '6 M', '12 M'];
        return streakKeys
            .map(key => this.parseNumeric(company?.[key]))
            .filter(value => Number.isFinite(value));
    }

    averageMomentum(companies) {
        const combined = [];
        companies.forEach(company => {
            combined.push(...this.buildMomentumSnapshot(company));
        });

        if (!combined.length) return [];
        const avg = this.average(combined);
        return [avg];
    }

    average(values) {
        const numeric = values.filter(Number.isFinite);
        if (!numeric.length) return null;
        const sum = numeric.reduce((acc, value) => acc + value, 0);
        return sum / numeric.length;
    }

    emptyMetricSet() {
        const result = {};
        for (const key of Object.keys(this.dimensionConfig)) {
            result[key] = { raw: null, normalized: 0 };
        }
        result.score = 0;
        result.volatility = null;
        result.returnStreak = [];
        return result;
    }
}

window.DeepCompareComparisonEngine = ComparisonEngine;

console.log('✅ DeepCompare ComparisonEngine 로드 완료');
