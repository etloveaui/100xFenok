/**
 * E_Indicators Module Test Suite
 * Phase 3 - Economic Indicators Module
 *
 * Test Requirements:
 * - Economic data parsing and validation
 * - Cycle classification algorithm
 * - Time series data handling
 * - Indicator aggregation
 * - Chart data preparation
 */

describe('E_Indicators Module', () => {
    let economicIndicators;
    let mockEconomicData;
    let mockEventBus;

    beforeEach(() => {
        // Mock event bus
        mockEventBus = {
            publish: jest.fn(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn()
        };

        // Mock economic data
        mockEconomicData = {
            gdp: [
                { date: '2024-Q1', value: 2.1, country: 'US' },
                { date: '2024-Q2', value: 2.3, country: 'US' },
                { date: '2024-Q3', value: 2.5, country: 'US' },
                { date: '2024-Q4', value: 2.2, country: 'US' }
            ],
            inflation: [
                { date: '2024-01', value: 3.2, country: 'US' },
                { date: '2024-02', value: 3.1, country: 'US' },
                { date: '2024-03', value: 3.0, country: 'US' }
            ],
            unemployment: [
                { date: '2024-01', value: 3.8, country: 'US' },
                { date: '2024-02', value: 3.7, country: 'US' },
                { date: '2024-03', value: 3.9, country: 'US' }
            ],
            interestRate: [
                { date: '2024-01', value: 5.25, country: 'US' },
                { date: '2024-02', value: 5.25, country: 'US' },
                { date: '2024-03', value: 5.50, country: 'US' }
            ]
        };
    });

    describe('Module Initialization', () => {
        test('should initialize with default configuration', () => {
            economicIndicators = new E_Indicators();
            expect(economicIndicators).toBeDefined();
            expect(economicIndicators.config).toEqual({
                updateInterval: 3600000, // 1 hour
                countries: ['US', 'EU', 'JP', 'CN', 'KR'],
                indicators: ['gdp', 'inflation', 'unemployment', 'interestRate'],
                chartTypes: ['line', 'area', 'bar'],
                cyclePhases: ['expansion', 'peak', 'contraction', 'trough']
            });
        });

        test('should initialize with custom configuration', () => {
            const customConfig = {
                updateInterval: 1800000,
                countries: ['US', 'EU'],
                theme: 'dark'
            };
            economicIndicators = new E_Indicators(customConfig);
            expect(economicIndicators.config.updateInterval).toBe(1800000);
            expect(economicIndicators.config.countries).toEqual(['US', 'EU']);
            expect(economicIndicators.config.theme).toBe('dark');
        });
    });

    describe('Data Loading and Parsing', () => {
        beforeEach(() => {
            economicIndicators = new E_Indicators();
        });

        test('should load economic data successfully', async () => {
            const result = await economicIndicators.loadData(mockEconomicData);
            expect(result).toBe(true);
            expect(economicIndicators.data).toBeDefined();
            expect(economicIndicators.data.gdp).toHaveLength(4);
        });

        test('should validate data format', async () => {
            const invalidData = { invalid: 'data' };
            await expect(economicIndicators.loadData(invalidData))
                .rejects.toThrow('Invalid economic data format');
        });

        test('should parse time series data correctly', () => {
            economicIndicators.data = mockEconomicData;
            const timeSeries = economicIndicators.parseTimeSeries('gdp', 'US');
            expect(timeSeries).toHaveLength(4);
            expect(timeSeries[0]).toEqual({
                date: '2024-Q1',
                value: 2.1
            });
        });

        test('should handle missing data gracefully', () => {
            economicIndicators.data = mockEconomicData;
            const timeSeries = economicIndicators.parseTimeSeries('gdp', 'JP');
            expect(timeSeries).toEqual([]);
        });
    });

    describe('Economic Cycle Classification', () => {
        beforeEach(() => {
            economicIndicators = new E_Indicators();
            economicIndicators.data = mockEconomicData;
        });

        test('should classify expansion phase correctly', () => {
            const classification = economicIndicators.classifyCycle({
                gdpGrowth: 2.5,
                unemployment: 3.5,
                inflation: 2.0
            });
            expect(classification.phase).toBe('expansion');
            expect(classification.confidence).toBeGreaterThan(0.7);
        });

        test('should classify contraction phase correctly', () => {
            const classification = economicIndicators.classifyCycle({
                gdpGrowth: -0.5,
                unemployment: 6.5,
                inflation: 1.0
            });
            expect(classification.phase).toBe('contraction');
            expect(classification.confidence).toBeGreaterThan(0.6);
        });

        test('should classify peak phase correctly', () => {
            const classification = economicIndicators.classifyCycle({
                gdpGrowth: 3.5,
                unemployment: 3.0,
                inflation: 4.5
            });
            expect(classification.phase).toBe('peak');
        });

        test('should classify trough phase correctly', () => {
            const classification = economicIndicators.classifyCycle({
                gdpGrowth: 0.5,
                unemployment: 7.0,
                inflation: 0.5
            });
            expect(classification.phase).toBe('trough');
        });

        test('should calculate cycle momentum', () => {
            const momentum = economicIndicators.calculateCycleMomentum('US');
            expect(momentum).toBeDefined();
            expect(momentum.score).toBeGreaterThanOrEqual(-100);
            expect(momentum.score).toBeLessThanOrEqual(100);
            expect(momentum.trend).toMatch(/^(bullish|bearish|neutral)$/);
        });
    });

    describe('Indicator Aggregation', () => {
        beforeEach(() => {
            economicIndicators = new E_Indicators();
            economicIndicators.data = mockEconomicData;
        });

        test('should aggregate indicators by country', () => {
            const aggregated = economicIndicators.aggregateByCountry('US');
            expect(aggregated).toHaveProperty('gdp');
            expect(aggregated).toHaveProperty('inflation');
            expect(aggregated).toHaveProperty('unemployment');
            expect(aggregated).toHaveProperty('interestRate');
            expect(aggregated.gdp.latest).toBe(2.2);
            expect(aggregated.gdp.change).toBe(-0.3);
        });

        test('should calculate composite economic index', () => {
            const index = economicIndicators.calculateCompositeIndex('US');
            expect(index).toBeDefined();
            expect(index.value).toBeGreaterThanOrEqual(0);
            expect(index.value).toBeLessThanOrEqual(100);
            expect(index.components).toHaveLength(4);
        });

        test('should rank countries by economic strength', () => {
            const rankings = economicIndicators.rankCountries();
            expect(rankings).toBeDefined();
            expect(Array.isArray(rankings)).toBe(true);
            expect(rankings[0]).toHaveProperty('country');
            expect(rankings[0]).toHaveProperty('score');
            expect(rankings[0]).toHaveProperty('rank');
        });

        test('should detect economic anomalies', () => {
            const anomalies = economicIndicators.detectAnomalies('US');
            expect(anomalies).toBeDefined();
            expect(Array.isArray(anomalies)).toBe(true);
            if (anomalies.length > 0) {
                expect(anomalies[0]).toHaveProperty('indicator');
                expect(anomalies[0]).toHaveProperty('severity');
                expect(anomalies[0]).toHaveProperty('message');
            }
        });
    });

    describe('Chart Data Preparation', () => {
        beforeEach(() => {
            economicIndicators = new E_Indicators();
            economicIndicators.data = mockEconomicData;
        });

        test('should prepare line chart data', () => {
            const chartData = economicIndicators.prepareChartData('line', 'gdp', 'US');
            expect(chartData).toHaveProperty('labels');
            expect(chartData).toHaveProperty('datasets');
            expect(chartData.datasets[0]).toHaveProperty('data');
            expect(chartData.datasets[0].data).toHaveLength(4);
        });

        test('should prepare multi-series chart data', () => {
            const chartData = economicIndicators.prepareMultiSeriesChart(
                ['US', 'EU'],
                'gdp'
            );
            expect(chartData.datasets).toHaveLength(2);
            expect(chartData.datasets[0].label).toBe('US');
            expect(chartData.datasets[1].label).toBe('EU');
        });

        test('should prepare heatmap data', () => {
            const heatmapData = economicIndicators.prepareHeatmap();
            expect(heatmapData).toHaveProperty('countries');
            expect(heatmapData).toHaveProperty('indicators');
            expect(heatmapData).toHaveProperty('values');
            expect(Array.isArray(heatmapData.values)).toBe(true);
        });

        test('should format data for export', () => {
            const exportData = economicIndicators.exportData('csv');
            expect(typeof exportData).toBe('string');
            expect(exportData).toContain('Country');
            expect(exportData).toContain('GDP');
            expect(exportData).toContain('Inflation');
        });
    });

    describe('Real-time Updates', () => {
        beforeEach(() => {
            jest.useFakeTimers();
            economicIndicators = new E_Indicators({
                updateInterval: 1000,
                eventBus: mockEventBus
            });
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('should auto-update at specified interval', () => {
            economicIndicators.startAutoUpdate();
            jest.advanceTimersByTime(3000);
            expect(mockEventBus.publish).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'indicators:update'
                })
            );
            economicIndicators.stopAutoUpdate();
        });

        test('should emit events on data change', async () => {
            await economicIndicators.loadData(mockEconomicData);
            expect(mockEventBus.publish).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'indicators:loaded',
                    data: expect.any(Object)
                })
            );
        });

        test('should handle subscription lifecycle', () => {
            const callback = jest.fn();
            const unsubscribe = economicIndicators.subscribe('cycleChange', callback);
            economicIndicators.emit('cycleChange', { phase: 'expansion' });
            expect(callback).toHaveBeenCalled();
            unsubscribe();
            economicIndicators.emit('cycleChange', { phase: 'contraction' });
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('UI Component Integration', () => {
        beforeEach(() => {
            document.body.innerHTML = '<div id="test-container"></div>';
            economicIndicators = new E_Indicators();
            economicIndicators.data = mockEconomicData;
        });

        test('should render main dashboard', () => {
            const container = document.getElementById('test-container');
            economicIndicators.render(container);

            expect(container.querySelector('.e-indicators-dashboard')).toBeTruthy();
            expect(container.querySelector('.country-selector')).toBeTruthy();
            expect(container.querySelector('.indicator-cards')).toBeTruthy();
            expect(container.querySelector('.cycle-indicator')).toBeTruthy();
        });

        test('should update UI on country selection', () => {
            const container = document.getElementById('test-container');
            economicIndicators.render(container);

            const selector = container.querySelector('.country-selector select');
            selector.value = 'EU';
            selector.dispatchEvent(new Event('change'));

            const cycleIndicator = container.querySelector('.cycle-phase');
            expect(cycleIndicator.textContent).toContain('EU');
        });

        test('should display indicator cards correctly', () => {
            const container = document.getElementById('test-container');
            economicIndicators.render(container);

            const cards = container.querySelectorAll('.indicator-card');
            expect(cards.length).toBeGreaterThanOrEqual(4);

            const gdpCard = Array.from(cards).find(card =>
                card.textContent.includes('GDP')
            );
            expect(gdpCard).toBeTruthy();
            expect(gdpCard.querySelector('.value')).toBeTruthy();
            expect(gdpCard.querySelector('.change')).toBeTruthy();
        });

        test('should handle chart view toggle', () => {
            const container = document.getElementById('test-container');
            economicIndicators.render(container);

            const chartToggle = container.querySelector('.chart-toggle');
            chartToggle.click();

            const chartContainer = container.querySelector('.chart-container');
            expect(chartContainer.classList.contains('active')).toBe(true);
        });
    });

    describe('Error Handling', () => {
        beforeEach(() => {
            economicIndicators = new E_Indicators();
        });

        test('should handle network errors gracefully', async () => {
            const fetchData = jest.fn().mockRejectedValue(new Error('Network error'));
            economicIndicators.fetchData = fetchData;

            await expect(economicIndicators.loadRemoteData())
                .rejects.toThrow('Failed to load economic data');
        });

        test('should handle invalid indicator types', () => {
            expect(() => {
                economicIndicators.getIndicator('invalid_type', 'US');
            }).toThrow('Invalid indicator type');
        });

        test('should handle missing countries gracefully', () => {
            economicIndicators.data = mockEconomicData;
            const result = economicIndicators.aggregateByCountry('XX');
            expect(result).toEqual({
                gdp: { latest: null, change: null },
                inflation: { latest: null, change: null },
                unemployment: { latest: null, change: null },
                interestRate: { latest: null, change: null }
            });
        });
    });

    describe('Performance Tests', () => {
        test('should process large datasets efficiently', () => {
            const largeData = {
                gdp: Array(1000).fill(null).map((_, i) => ({
                    date: `2020-${i}`,
                    value: Math.random() * 5,
                    country: 'US'
                }))
            };

            economicIndicators = new E_Indicators();
            const start = performance.now();
            economicIndicators.data = largeData;
            const timeSeries = economicIndicators.parseTimeSeries('gdp', 'US');
            const end = performance.now();

            expect(end - start).toBeLessThan(100); // Should process in < 100ms
            expect(timeSeries).toHaveLength(1000);
        });

        test('should render efficiently with multiple countries', () => {
            const container = document.getElementById('test-container');
            economicIndicators = new E_Indicators({
                countries: ['US', 'EU', 'JP', 'CN', 'KR', 'UK', 'CA', 'AU']
            });
            economicIndicators.data = mockEconomicData;

            const start = performance.now();
            economicIndicators.render(container);
            const end = performance.now();

            expect(end - start).toBeLessThan(200); // Should render in < 200ms
        });
    });
});

// Helper function for creating mock data
function createMockIndicatorData(indicator, country, periods) {
    return Array(periods).fill(null).map((_, i) => ({
        date: `2024-${String(i + 1).padStart(2, '0')}`,
        value: Math.random() * 10,
        country: country
    }));
}

// Export for use in other tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createMockIndicatorData
    };
}