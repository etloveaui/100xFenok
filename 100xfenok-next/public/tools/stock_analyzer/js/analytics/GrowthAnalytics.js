/**
 * GrowthAnalytics.js - 성장률 분석 모듈
 * Sprint 4 Integration
 */

class GrowthAnalytics {
    constructor() {
        this.data = [];
        this.filteredData = [];
        this.currentIndustry = 'all';
    }

    /**
     * 초기화
     */
    initialize(data) {
        this.data = data || this.generateSampleData();
        this.filteredData = [...this.data];
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
            { name: 'LG에너지솔루션', industry: 'energy' }
        ];

        return companies.map(company => ({
            ...company,
            growth: {
                q1: this.randomGrowth(),
                q2: this.randomGrowth(),
                q3: this.randomGrowth(),
                q4: this.randomGrowth()
            },
            revenue: Math.floor(Math.random() * 100000) + 10000,
            marketCap: Math.floor(Math.random() * 500000) + 50000
        }));
    }

    randomGrowth() {
        return parseFloat((Math.random() * 30 - 5).toFixed(2));
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
        return this;
    }

    /**
     * 평균 성장률 계산
     */
    calculateAverageGrowth() {
        if (this.filteredData.length === 0) return 0;

        const totalGrowth = this.filteredData.reduce((sum, company) => {
            const avgGrowth = (company.growth.q1 + company.growth.q2 +
                             company.growth.q3 + company.growth.q4) / 4;
            return sum + avgGrowth;
        }, 0);

        return parseFloat((totalGrowth / this.filteredData.length).toFixed(2));
    }

    /**
     * 최고 성장률 기업
     */
    getTopGrowthCompanies(limit = 5) {
        return this.filteredData
            .map(company => ({
                ...company,
                avgGrowth: (company.growth.q1 + company.growth.q2 +
                           company.growth.q3 + company.growth.q4) / 4
            }))
            .sort((a, b) => b.avgGrowth - a.avgGrowth)
            .slice(0, limit);
    }

    /**
     * 분기별 성장률 트렌드
     */
    getQuarterlyTrend() {
        const quarters = ['q1', 'q2', 'q3', 'q4'];
        return quarters.map(q => {
            const avg = this.filteredData.reduce((sum, company) =>
                sum + company.growth[q], 0) / this.filteredData.length;
            return parseFloat(avg.toFixed(2));
        });
    }

    /**
     * 성장률 분포
     */
    getGrowthDistribution() {
        const ranges = [
            { label: '음수', min: -Infinity, max: 0 },
            { label: '0-10%', min: 0, max: 10 },
            { label: '10-20%', min: 10, max: 20 },
            { label: '20%+', min: 20, max: Infinity }
        ];

        return ranges.map(range => {
            const count = this.filteredData.filter(company => {
                const avg = (company.growth.q1 + company.growth.q2 +
                           company.growth.q3 + company.growth.q4) / 4;
                return avg >= range.min && avg < range.max;
            }).length;

            return {
                label: range.label,
                count: count,
                percentage: parseFloat((count / this.filteredData.length * 100).toFixed(1))
            };
        });
    }

    /**
     * Chart.js용 데이터 생성
     */
    getChartData() {
        const topCompanies = this.getTopGrowthCompanies(5);

        return {
            type: 'bar',
            data: {
                labels: topCompanies.map(c => c.name),
                datasets: [
                    {
                        label: 'Q1',
                        data: topCompanies.map(c => c.growth.q1),
                        backgroundColor: 'rgba(59, 130, 246, 0.5)',
                        borderColor: 'rgb(59, 130, 246)',
                        borderWidth: 1
                    },
                    {
                        label: 'Q2',
                        data: topCompanies.map(c => c.growth.q2),
                        backgroundColor: 'rgba(16, 185, 129, 0.5)',
                        borderColor: 'rgb(16, 185, 129)',
                        borderWidth: 1
                    },
                    {
                        label: 'Q3',
                        data: topCompanies.map(c => c.growth.q3),
                        backgroundColor: 'rgba(251, 146, 60, 0.5)',
                        borderColor: 'rgb(251, 146, 60)',
                        borderWidth: 1
                    },
                    {
                        label: 'Q4',
                        data: topCompanies.map(c => c.growth.q4),
                        backgroundColor: 'rgba(168, 85, 247, 0.5)',
                        borderColor: 'rgb(168, 85, 247)',
                        borderWidth: 1
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
                    title: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + '%';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '성장률 (%)'
                        }
                    }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const company = topCompanies[index];
                        this.onCompanyClick(company);
                    }
                }
            }
        };
    }

    /**
     * 기업 클릭 이벤트 핸들러
     */
    onCompanyClick(company) {
        if (window.dashboardManager) {
            window.dashboardManager.showCompanyDetail(company, 'growth');
        }
    }

    /**
     * CSV 내보내기용 데이터
     */
    exportToCSV() {
        const headers = ['기업명', '업종', 'Q1 성장률', 'Q2 성장률', 'Q3 성장률', 'Q4 성장률', '평균 성장률'];
        const rows = this.filteredData.map(company => {
            const avg = (company.growth.q1 + company.growth.q2 +
                        company.growth.q3 + company.growth.q4) / 4;
            return [
                company.name,
                company.industry,
                company.growth.q1.toFixed(2),
                company.growth.q2.toFixed(2),
                company.growth.q3.toFixed(2),
                company.growth.q4.toFixed(2),
                avg.toFixed(2)
            ];
        });

        return [headers, ...rows]
            .map(row => row.join(','))
            .join('\n');
    }

    /**
     * 상세 정보 HTML 생성
     */
    renderDetails() {
        const topCompanies = this.getTopGrowthCompanies(10);
        const distribution = this.getGrowthDistribution();

        return `
            <div class="space-y-6">
                <div>
                    <h3 class="text-lg font-semibold mb-4">Top 10 성장 기업</h3>
                    <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">순위</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">기업명</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">업종</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">평균 성장률</th>
                                </tr>
                            </thead>
                            <tbody class="bg-white divide-y divide-gray-200">
                                ${topCompanies.map((company, index) => `
                                    <tr class="hover:bg-gray-50 cursor-pointer" onclick="window.dashboardManager.showCompanyDetail(${JSON.stringify(company)}, 'growth')">
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${index + 1}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${company.name}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${company.industry}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-right ${company.avgGrowth >= 0 ? 'text-green-600' : 'text-red-600'}">
                                            ${company.avgGrowth.toFixed(2)}%
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div>
                    <h3 class="text-lg font-semibold mb-4">성장률 분포</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        ${distribution.map(item => `
                            <div class="bg-gray-50 rounded-lg p-4">
                                <p class="text-sm text-gray-600">${item.label}</p>
                                <p class="text-2xl font-bold text-gray-900 mt-2">${item.count}개</p>
                                <p class="text-xs text-gray-500 mt-1">${item.percentage}%</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GrowthAnalytics;
}
