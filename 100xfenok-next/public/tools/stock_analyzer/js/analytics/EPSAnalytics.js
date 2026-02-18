/**
 * EPSAnalytics.js - EPS 분석 모듈
 * Sprint 4 Integration
 */

class EPSAnalytics {
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
            eps: {
                q1: this.randomEPS(),
                q2: this.randomEPS(),
                q3: this.randomEPS(),
                q4: this.randomEPS()
            },
            per: parseFloat((Math.random() * 30 + 5).toFixed(2)),
            roe: parseFloat((Math.random() * 20 + 5).toFixed(2)),
            dividendYield: parseFloat((Math.random() * 5).toFixed(2))
        }));
    }

    randomEPS() {
        return Math.floor(Math.random() * 10000) + 1000;
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
     * 평균 EPS 계산
     */
    calculateAverageEPS() {
        if (this.filteredData.length === 0) return 0;

        const totalEPS = this.filteredData.reduce((sum, company) => {
            const avgEPS = (company.eps.q1 + company.eps.q2 +
                          company.eps.q3 + company.eps.q4) / 4;
            return sum + avgEPS;
        }, 0);

        return Math.floor(totalEPS / this.filteredData.length);
    }

    /**
     * 최고 EPS 기업
     */
    getTopEPSCompanies(limit = 5) {
        return this.filteredData
            .map(company => ({
                ...company,
                avgEPS: (company.eps.q1 + company.eps.q2 +
                        company.eps.q3 + company.eps.q4) / 4
            }))
            .sort((a, b) => b.avgEPS - a.avgEPS)
            .slice(0, limit);
    }

    /**
     * EPS 성장률 계산
     */
    calculateEPSGrowth(company) {
        const quarters = [company.eps.q1, company.eps.q2, company.eps.q3, company.eps.q4];
        const growth = [];

        for (let i = 1; i < quarters.length; i++) {
            const rate = ((quarters[i] - quarters[i - 1]) / quarters[i - 1]) * 100;
            growth.push(parseFloat(rate.toFixed(2)));
        }

        return growth;
    }

    /**
     * 분기별 EPS 트렌드
     */
    getQuarterlyTrend() {
        const quarters = ['q1', 'q2', 'q3', 'q4'];
        return quarters.map(q => {
            const avg = this.filteredData.reduce((sum, company) =>
                sum + company.eps[q], 0) / this.filteredData.length;
            return Math.floor(avg);
        });
    }

    /**
     * EPS 분포 통계
     */
    getEPSDistribution() {
        const ranges = [
            { label: '0-2K', min: 0, max: 2000 },
            { label: '2K-5K', min: 2000, max: 5000 },
            { label: '5K-8K', min: 5000, max: 8000 },
            { label: '8K+', min: 8000, max: Infinity }
        ];

        return ranges.map(range => {
            const count = this.filteredData.filter(company => {
                const avg = (company.eps.q1 + company.eps.q2 +
                           company.eps.q3 + company.eps.q4) / 4;
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
     * PER 기준 저평가 기업
     */
    getUndervaluedByPER(limit = 5) {
        return this.filteredData
            .sort((a, b) => a.per - b.per)
            .slice(0, limit);
    }

    /**
     * Chart.js용 데이터 생성
     */
    getChartData() {
        const topCompanies = this.getTopEPSCompanies(5);

        return {
            type: 'line',
            data: {
                labels: ['Q1', 'Q2', 'Q3', 'Q4'],
                datasets: topCompanies.map((company, index) => {
                    const colors = [
                        'rgb(59, 130, 246)',
                        'rgb(16, 185, 129)',
                        'rgb(251, 146, 60)',
                        'rgb(168, 85, 247)',
                        'rgb(236, 72, 153)'
                    ];
                    const color = colors[index % colors.length];

                    return {
                        label: company.name,
                        data: [company.eps.q1, company.eps.q2, company.eps.q3, company.eps.q4],
                        borderColor: color,
                        backgroundColor: color.replace('rgb', 'rgba').replace(')', ', 0.1)'),
                        borderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.1
                    };
                })
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
                                return context.dataset.label + ': ' +
                                       context.parsed.y.toLocaleString() + '원';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'EPS (원)'
                        },
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString();
                            }
                        }
                    }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const datasetIndex = elements[0].datasetIndex;
                        const company = topCompanies[datasetIndex];
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
            window.dashboardManager.showCompanyDetail(company, 'eps');
        }
    }

    /**
     * CSV 내보내기용 데이터
     */
    exportToCSV() {
        const headers = ['기업명', '업종', 'Q1 EPS', 'Q2 EPS', 'Q3 EPS', 'Q4 EPS', '평균 EPS', 'PER', 'ROE'];
        const rows = this.filteredData.map(company => {
            const avg = (company.eps.q1 + company.eps.q2 +
                        company.eps.q3 + company.eps.q4) / 4;
            return [
                company.name,
                company.industry,
                company.eps.q1,
                company.eps.q2,
                company.eps.q3,
                company.eps.q4,
                Math.floor(avg),
                company.per,
                company.roe
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
        const topCompanies = this.getTopEPSCompanies(10);
        const undervalued = this.getUndervaluedByPER(5);
        const distribution = this.getEPSDistribution();

        return `
            <div class="space-y-6">
                <!-- Top EPS Companies -->
                <div>
                    <h3 class="text-lg font-semibold mb-4">Top 10 EPS 기업</h3>
                    <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">순위</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">기업명</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">업종</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">평균 EPS</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">PER</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">ROE</th>
                                </tr>
                            </thead>
                            <tbody class="bg-white divide-y divide-gray-200">
                                ${topCompanies.map((company, index) => `
                                    <tr class="hover:bg-gray-50 cursor-pointer" onclick="window.dashboardManager.showCompanyDetail(${JSON.stringify(company)}, 'eps')">
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${index + 1}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${company.name}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${company.industry}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">${Math.floor(company.avgEPS).toLocaleString()}원</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">${company.per}</td>
                                        <td class="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">${company.roe}%</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Undervalued Companies -->
                <div>
                    <h3 class="text-lg font-semibold mb-4">PER 기준 저평가 기업</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        ${undervalued.map(company => `
                            <div class="bg-blue-50 rounded-lg p-4 cursor-pointer hover:bg-blue-100 transition"
                                 onclick="window.dashboardManager.showCompanyDetail(${JSON.stringify(company)}, 'eps')">
                                <h4 class="font-semibold text-blue-900 mb-2">${company.name}</h4>
                                <div class="space-y-1 text-sm">
                                    <div class="flex justify-between">
                                        <span class="text-blue-600">PER:</span>
                                        <span class="text-blue-900 font-medium">${company.per}</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-blue-600">ROE:</span>
                                        <span class="text-blue-900 font-medium">${company.roe}%</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-blue-600">배당수익률:</span>
                                        <span class="text-blue-900 font-medium">${company.dividendYield}%</span>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- EPS Distribution -->
                <div>
                    <h3 class="text-lg font-semibold mb-4">EPS 분포</h3>
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
    module.exports = EPSAnalytics;
}
