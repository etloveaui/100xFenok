/**
 * RankingAnalytics.js - 순위 변화 분석 모듈
 * Sprint 4 Integration
 */

class RankingAnalytics {
    constructor() {
        this.data = [];
        this.filteredData = [];
        this.currentIndustry = 'all';
        this.rankings = {
            current: [],
            previous: []
        };
    }

    /**
     * 초기화
     */
    initialize(data) {
        this.data = data || this.generateSampleData();
        this.filteredData = [...this.data];
        this.calculateRankings();
        return this;
    }

    /**
     * 샘플 데이터 생성
     */
    generateSampleData() {
        const companies = [
            { name: '삼성전자', industry: 'tech' },
            { name: 'SK하이닉스', industry: 'tech' },
            { name: '네이버', industry: 'tech' },
            { name: '카카오', industry: 'tech' },
            { name: '현대차', industry: 'manufacturing' },
            { name: 'KB금융', industry: 'finance' },
            { name: '신한지주', industry: 'finance' },
            { name: '삼성바이오', industry: 'healthcare' },
            { name: 'SK이노베이션', industry: 'energy' },
            { name: 'LG에너지솔루션', industry: 'energy' },
            { name: 'LG화학', industry: 'tech' },
            { name: 'POSCO홀딩스', industry: 'manufacturing' }
        ];

        return companies.map(company => ({
            ...company,
            currentScore: Math.floor(Math.random() * 100) + 1,
            previousScore: Math.floor(Math.random() * 100) + 1,
            marketCap: Math.floor(Math.random() * 500000) + 50000,
            volume: Math.floor(Math.random() * 10000000) + 100000
        }));
    }

    /**
     * 업종 필터 적용
     */
    filterByIndustry(industry) {
        this.currentIndustry = industry;
        if (industry === 'all') {
            this.filteredData = [...this.data];
        } else {
            this.filteredData = this.data.filter(item => item.industry === industry);
        }
        this.calculateRankings();
        return this;
    }

    /**
     * 순위 계산
     */
    calculateRankings() {
        // 현재 순위
        this.rankings.current = [...this.filteredData]
            .sort((a, b) => b.currentScore - a.currentScore)
            .map((company, index) => ({
                ...company,
                rank: index + 1
            }));

        // 이전 순위
        this.rankings.previous = [...this.filteredData]
            .sort((a, b) => b.previousScore - a.previousScore)
            .map((company, index) => ({
                ...company,
                prevRank: index + 1
            }));

        // 순위 변화 통합
        this.rankings.current = this.rankings.current.map(current => {
            const prev = this.rankings.previous.find(p => p.name === current.name);
            return {
                ...current,
                prevRank: prev ? prev.prevRank : current.rank,
                rankChange: prev ? prev.prevRank - current.rank : 0
            };
        });
    }

    /**
     * Top 10 기업 수
     */
    getTop10Count() {
        return Math.min(10, this.rankings.current.length);
    }

    /**
     * 순위 변화 통계
     */
    getRankingStats() {
        const changes = this.rankings.current.map(c => c.rankChange);

        return {
            avgChange: parseFloat((changes.reduce((a, b) => a + Math.abs(b), 0) / changes.length).toFixed(2)),
            maxUp: Math.max(...changes),
            maxDown: Math.min(...changes),
            stable: changes.filter(c => c === 0).length
        };
    }

    /**
     * 최대 상승 기업
     */
    getTopRisers(limit = 5) {
        return this.rankings.current
            .filter(c => c.rankChange > 0)
            .sort((a, b) => b.rankChange - a.rankChange)
            .slice(0, limit);
    }

    /**
     * 최대 하락 기업
     */
    getTopFallers(limit = 5) {
        return this.rankings.current
            .filter(c => c.rankChange < 0)
            .sort((a, b) => a.rankChange - b.rankChange)
            .slice(0, limit);
    }

    /**
     * Chart.js용 데이터 생성 (순위 변화)
     */
    getChartData() {
        const top10 = this.rankings.current.slice(0, 10);

        return {
            type: 'line',
            data: {
                labels: top10.map(c => c.name),
                datasets: [
                    {
                        label: '이전 순위',
                        data: top10.map(c => c.prevRank),
                        borderColor: 'rgba(156, 163, 175, 0.8)',
                        backgroundColor: 'rgba(156, 163, 175, 0.2)',
                        borderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    },
                    {
                        label: '현재 순위',
                        data: top10.map(c => c.rank),
                        borderColor: 'rgba(59, 130, 246, 0.8)',
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        borderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y + '위';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        reverse: true,
                        beginAtZero: false,
                        title: {
                            display: true,
                            text: '순위'
                        },
                        ticks: {
                            stepSize: 1
                        }
                    }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const company = top10[index];
                        this.onCompanyClick(company);
                    }
                }
            }
        };
    }

    /**
     * 순위 변화 히트맵 데이터
     */
    getRankChangeHeatmap() {
        return this.rankings.current.map(company => ({
            name: company.name,
            change: company.rankChange,
            color: company.rankChange > 0 ? 'green' :
                   company.rankChange < 0 ? 'red' : 'gray'
        }));
    }

    /**
     * 기업 클릭 이벤트 핸들러
     */
    onCompanyClick(company) {
        if (window.dashboardManager) {
            window.dashboardManager.showCompanyDetail(company, 'ranking');
        }
    }

    /**
     * CSV 내보내기용 데이터
     */
    exportToCSV() {
        const headers = ['순위', '기업명', '업종', '현재 점수', '이전 순위', '순위 변화'];
        const rows = this.rankings.current.map(company => [
            company.rank,
            company.name,
            company.industry,
            company.currentScore,
            company.prevRank,
            company.rankChange > 0 ? `+${company.rankChange}` :
            company.rankChange < 0 ? `${company.rankChange}` : '-'
        ]);

        return [headers, ...rows]
            .map(row => row.join(','))
            .join('\n');
    }

    /**
     * 상세 정보 HTML 생성
     */
    renderDetails() {
        const top10 = this.rankings.current.slice(0, 10);
        const topRisers = this.getTopRisers(5);
        const topFallers = this.getTopFallers(5);
        const stats = this.getRankingStats();

        return `
            <div class="space-y-6">
                <!-- Stats Cards -->
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="bg-blue-50 rounded-lg p-4">
                        <p class="text-sm text-blue-600 font-medium">평균 순위 변동</p>
                        <p class="text-2xl font-bold text-blue-900 mt-2">${stats.avgChange}</p>
                    </div>
                    <div class="bg-green-50 rounded-lg p-4">
                        <p class="text-sm text-green-600 font-medium">최대 상승</p>
                        <p class="text-2xl font-bold text-green-900 mt-2">+${stats.maxUp}</p>
                    </div>
                    <div class="bg-red-50 rounded-lg p-4">
                        <p class="text-sm text-red-600 font-medium">최대 하락</p>
                        <p class="text-2xl font-bold text-red-900 mt-2">${stats.maxDown}</p>
                    </div>
                    <div class="bg-gray-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 font-medium">순위 유지</p>
                        <p class="text-2xl font-bold text-gray-900 mt-2">${stats.stable}개</p>
                    </div>
                </div>

                <!-- Top 10 Table -->
                <div>
                    <h3 class="text-lg font-semibold mb-4">Top 10 기업</h3>
                    <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">현재 순위</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">기업명</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">업종</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">이전 순위</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">변화</th>
                                </tr>
                            </thead>
                            <tbody class="bg-white divide-y divide-gray-200">
                                ${top10.map(company => `
                                    <tr class="hover:bg-gray-50 cursor-pointer" onclick="window.dashboardManager.showCompanyDetail(${JSON.stringify(company)}, 'ranking')">
                                        <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">${company.rank}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${company.name}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${company.industry}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">${company.prevRank}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-right">
                                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                                                ${company.rankChange > 0 ? 'bg-green-100 text-green-800' :
                                                  company.rankChange < 0 ? 'bg-red-100 text-red-800' :
                                                  'bg-gray-100 text-gray-800'}">
                                                ${company.rankChange > 0 ? `↑ ${company.rankChange}` :
                                                  company.rankChange < 0 ? `↓ ${Math.abs(company.rankChange)}` : '-'}
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Risers and Fallers -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h3 class="text-lg font-semibold mb-4 text-green-700">상승 기업</h3>
                        <div class="space-y-2">
                            ${topRisers.map(company => `
                                <div class="bg-green-50 rounded-lg p-3 flex justify-between items-center">
                                    <span class="font-medium text-green-900">${company.name}</span>
                                    <span class="text-green-700 font-bold">↑ ${company.rankChange}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div>
                        <h3 class="text-lg font-semibold mb-4 text-red-700">하락 기업</h3>
                        <div class="space-y-2">
                            ${topFallers.map(company => `
                                <div class="bg-red-50 rounded-lg p-3 flex justify-between items-center">
                                    <span class="font-medium text-red-900">${company.name}</span>
                                    <span class="text-red-700 font-bold">↓ ${Math.abs(company.rankChange)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RankingAnalytics;
}
