/**
 * RankingAnalytics.js
 * Sprint 4: Ranking 변화 추적 모듈
 *
 * 기능:
 * - T_Rank (1,252개) 순위 데이터 활용
 * - 기업별 순위 변화 추적
 * - 순위 상승/하락 기업 식별
 * - 업종별 순위 분포 분석
 * - 인터랙티브 차트 시각화
 */

class RankingAnalytics {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.rankData = null;
        this.initialized = false;
    }

    /**
     * 초기화: Rank 데이터 로딩
     */
    async initialize() {
        console.log('[RankingAnalytics] 초기화 시작...');

        try {
            const integratedData = await this.loadIntegratedData();

            if (!integratedData?.data?.technical?.T_Rank) {
                console.warn('[RankingAnalytics] T_Rank 데이터 없음');
                return false;
            }

            this.rankData = integratedData.data.technical.T_Rank;

            // 데이터와 기존 company 데이터 매칭
            this.enrichRankData();

            this.initialized = true;
            console.log(`[RankingAnalytics] 초기화 완료: ${this.rankData.length}개 기업`);
            return true;

        } catch (error) {
            console.error('[RankingAnalytics] 초기화 실패:', error);
            return false;
        }
    }

    /**
     * Integrated JSON 로딩
     */
    async loadIntegratedData() {
        const response = await fetch('./data/global_scouter_integrated.json');
        if (!response.ok) {
            throw new Error(`Failed to load integrated data: ${response.status}`);
        }
        return await response.json();
    }

    /**
     * Rank 데이터에 기존 company 데이터 연결
     */
    enrichRankData() {
        if (!this.dataManager?.companies) {
            console.warn('[RankingAnalytics] DataManager companies 없음');
            return;
        }

        // Ticker로 매칭
        const companyMap = new Map(
            this.dataManager.companies.map(c => [c.Ticker, c])
        );

        this.rankData = this.rankData.map(rank => {
            const company = companyMap.get(rank.Ticker);
            return {
                ...rank,
                corpName: company?.corpName || rank.Corp,
                price: company?.Price || rank['주가변화'],
                marketCap: company?.['(USD mn)'] || rank['(USD mn)']
            };
        });
    }

    /**
     * 기업별 순위 정보 조회
     * @param {string} ticker - 종목 코드
     * @returns {Object} 순위 데이터
     */
    getCompanyRanking(ticker) {
        if (!this.initialized || !this.rankData) {
            return null;
        }

        const rank = this.rankData.find(r => r.Ticker === ticker);
        if (!rank) {
            return null;
        }

        return {
            ticker: rank.Ticker,
            corp: rank.Corp,
            exchange: rank.Exchange,
            sector: rank.WI26,

            // 순위 데이터 (주요 컬럼들)
            quality_rank: this.parseRank(rank['Quality']),
            value_rank: this.parseRank(rank['Value']),
            momentum_rank: this.parseRank(rank['Momentum']),

            // 개별 지표 순위들
            roe_rank: this.parseRank(rank['ROE']),
            eps_growth_rank: this.parseRank(rank['EPS 성장성']),
            sales_growth_rank: this.parseRank(rank['매출 성장성']),
            profit_margin_rank: this.parseRank(rank['수익성']),

            // 가치 평가 순위
            per_rank: this.parseRank(rank['PER']),
            pbr_rank: this.parseRank(rank['PBR']),
            psr_rank: this.parseRank(rank['PSR']),

            // 모멘텀 지표 순위
            price_momentum_rank: this.parseRank(rank['주가 모멘텀']),
            volume_rank: this.parseRank(rank['거래량']),

            marketCap: rank['(USD mn)']
        };
    }

    /**
     * 순위 파싱 (문자열 → 숫자)
     */
    parseRank(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const num = parseInt(value);
        if (isNaN(num)) {
            return null;
        }
        return num;
    }

    /**
     * 상위 순위 기업 필터링
     * @param {string} rankType - 순위 타입 (quality, value, momentum)
     * @param {number} topN - 상위 N개
     * @returns {Array} 상위 순위 기업 리스트
     */
    getTopRankedCompanies(rankType = 'quality', topN = 50) {
        if (!this.initialized || !this.rankData) {
            return [];
        }

        const rankKey = this.getRankKey(rankType);

        return this.rankData
            .filter(rank => {
                const value = this.parseRank(rank[rankKey]);
                return value !== null && value <= topN;
            })
            .map(rank => ({
                ticker: rank.Ticker,
                corp: rank.Corp,
                sector: rank.WI26,
                rank: this.parseRank(rank[rankKey]),
                marketCap: rank['(USD mn)']
            }))
            .sort((a, b) => a.rank - b.rank);
    }

    /**
     * 순위 타입 → 컬럼 키 매핑
     */
    getRankKey(rankType) {
        const keyMap = {
            'quality': 'Quality',
            'value': 'Value',
            'momentum': 'Momentum',
            'roe': 'ROE',
            'eps_growth': 'EPS 성장성',
            'sales_growth': '매출 성장성',
            'profit_margin': '수익성',
            'per': 'PER',
            'pbr': 'PBR',
            'psr': 'PSR',
            'price_momentum': '주가 모멘텀',
            'volume': '거래량'
        };

        return keyMap[rankType] || 'Quality';
    }

    /**
     * 업종별 순위 분포
     * @param {string} rankType - 순위 타입
     * @returns {Array} 업종별 평균 순위
     */
    getSectorRankDistribution(rankType = 'quality') {
        if (!this.initialized || !this.rankData) {
            return [];
        }

        const rankKey = this.getRankKey(rankType);
        const sectorMap = new Map();

        this.rankData.forEach(rank => {
            const sector = rank.WI26 || 'Unknown';
            const rankValue = this.parseRank(rank[rankKey]);

            if (!sectorMap.has(sector)) {
                sectorMap.set(sector, {
                    sector,
                    count: 0,
                    ranks: []
                });
            }

            const data = sectorMap.get(sector);
            data.count++;

            if (rankValue !== null) {
                data.ranks.push(rankValue);
            }
        });

        // 평균 순위 계산
        const results = [];
        sectorMap.forEach((data, sector) => {
            results.push({
                sector,
                count: data.count,
                averageRank: this.average(data.ranks),
                medianRank: this.median(data.ranks),
                topCount: data.ranks.filter(r => r <= 100).length
            });
        });

        // 평균 순위 좋은 순으로 정렬
        return results
            .filter(r => r.averageRank !== null)
            .sort((a, b) => a.averageRank - b.averageRank);
    }

    /**
     * 평균 계산
     */
    average(arr) {
        if (!arr || arr.length === 0) return null;
        const sum = arr.reduce((acc, val) => acc + val, 0);
        return sum / arr.length;
    }

    /**
     * 중앙값 계산
     */
    median(arr) {
        if (!arr || arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    /**
     * 순위 차트 데이터 생성 (Chart.js 형식)
     * @param {string} ticker - 종목 코드
     * @returns {Object} Chart.js 데이터 객체
     */
    getRankingChartData(ticker) {
        const ranking = this.getCompanyRanking(ticker);
        if (!ranking) {
            return null;
        }

        const ranks = [
            ranking.quality_rank,
            ranking.value_rank,
            ranking.momentum_rank,
            ranking.roe_rank,
            ranking.eps_growth_rank,
            ranking.profit_margin_rank
        ];

        // 순위는 낮을수록 좋으므로 역순으로 표시
        const maxRank = Math.max(...ranks.filter(r => r !== null));

        return {
            labels: ['Quality', 'Value', 'Momentum', 'ROE', 'EPS Growth', 'Profit Margin'],
            datasets: [{
                label: `${ranking.corp} Rankings`,
                data: ranks,
                backgroundColor: [
                    'rgba(255, 99, 132, 0.6)',
                    'rgba(54, 162, 235, 0.6)',
                    'rgba(255, 206, 86, 0.6)',
                    'rgba(75, 192, 192, 0.6)',
                    'rgba(153, 102, 255, 0.6)',
                    'rgba(255, 159, 64, 0.6)'
                ],
                borderColor: [
                    'rgba(255, 99, 132, 1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(153, 102, 255, 1)',
                    'rgba(255, 159, 64, 1)'
                ],
                borderWidth: 2
            }]
        };
    }

    /**
     * 업종별 순위 분포 차트 데이터
     * @param {string} rankType - 순위 타입
     * @param {number} topN - 상위 N개 업종
     * @returns {Object} Chart.js 데이터 객체
     */
    getSectorRankChartData(rankType = 'quality', topN = 10) {
        const sectors = this.getSectorRankDistribution(rankType).slice(0, topN);

        return {
            labels: sectors.map(s => s.sector),
            datasets: [
                {
                    label: 'Average Rank',
                    data: sectors.map(s => s.averageRank),
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 2
                },
                {
                    label: 'Top 100 Count',
                    data: sectors.map(s => s.topCount),
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 2,
                    yAxisID: 'y2'
                }
            ]
        };
    }

    /**
     * Ranking Summary 생성 (DeepCompare 패널용)
     * @param {string} ticker - 종목 코드
     * @returns {string} HTML 형식 순위 요약
     */
    getRankingSummaryHTML(ticker) {
        const ranking = this.getCompanyRanking(ticker);
        if (!ranking) {
            return '<p class="text-muted">Ranking data not available</p>';
        }

        const formatRank = (value) => {
            if (value === null) return 'N/A';
            return `#${value}`;
        };

        const getRankBadge = (value) => {
            if (value === null) return '';
            if (value <= 50) return '<span class="badge bg-success">Top 50</span>';
            if (value <= 100) return '<span class="badge bg-info">Top 100</span>';
            if (value <= 300) return '<span class="badge bg-warning">Top 300</span>';
            return '<span class="badge bg-secondary">Other</span>';
        };

        return `
            <div class="ranking-summary">
                <h6 class="mb-2">🏆 Rankings - ${ranking.corp}</h6>
                <div class="row">
                    <div class="col-md-4">
                        <strong>Overall Rankings</strong>
                        <p>Quality: ${formatRank(ranking.quality_rank)} ${getRankBadge(ranking.quality_rank)}</p>
                        <p>Value: ${formatRank(ranking.value_rank)} ${getRankBadge(ranking.value_rank)}</p>
                        <p>Momentum: ${formatRank(ranking.momentum_rank)} ${getRankBadge(ranking.momentum_rank)}</p>
                    </div>
                    <div class="col-md-4">
                        <strong>Growth Rankings</strong>
                        <p>EPS Growth: ${formatRank(ranking.eps_growth_rank)}</p>
                        <p>Sales Growth: ${formatRank(ranking.sales_growth_rank)}</p>
                        <p>ROE: ${formatRank(ranking.roe_rank)}</p>
                    </div>
                    <div class="col-md-4">
                        <strong>Valuation Rankings</strong>
                        <p>PER: ${formatRank(ranking.per_rank)}</p>
                        <p>PBR: ${formatRank(ranking.pbr_rank)}</p>
                        <p>PSR: ${formatRank(ranking.psr_rank)}</p>
                    </div>
                </div>
                <div class="mt-2">
                    <small><strong>Price Momentum:</strong> ${formatRank(ranking.price_momentum_rank)} |
                    <strong>Volume:</strong> ${formatRank(ranking.volume_rank)}</small>
                </div>
            </div>
        `;
    }

    /**
     * 순위 비교 (여러 기업)
     * @param {Array<string>} tickers - 종목 코드 배열
     * @param {string} rankType - 순위 타입
     * @returns {Array} 비교 결과
     */
    compareRankings(tickers, rankType = 'quality') {
        if (!this.initialized || !this.rankData) {
            return [];
        }

        const rankKey = this.getRankKey(rankType);

        return tickers
            .map(ticker => {
                const rank = this.rankData.find(r => r.Ticker === ticker);
                if (!rank) return null;

                return {
                    ticker: rank.Ticker,
                    corp: rank.Corp,
                    rank: this.parseRank(rank[rankKey]),
                    sector: rank.WI26
                };
            })
            .filter(r => r !== null && r.rank !== null)
            .sort((a, b) => a.rank - b.rank);
    }

    /**
     * 순위 개선 기업 찾기 (특정 기준)
     * @param {string} rankType - 순위 타입
     * @param {number} threshold - 순위 임계값
     * @returns {Array} 기준 충족 기업 리스트
     */
    findRankingImprovers(rankType = 'quality', threshold = 100) {
        return this.getTopRankedCompanies(rankType, threshold);
    }
}

// Export for use in stock_analyzer_enhanced.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RankingAnalytics;
}
