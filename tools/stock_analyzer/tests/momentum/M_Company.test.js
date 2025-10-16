/**
 * M_Company Module Tests
 * Comprehensive test suite for Company Momentum Tracking Module
 * @module Momentum/M_Company.test
 * @version 1.0.0
 */

// Mock dependencies
const mockDataProvider = {
    loadData: jest.fn()
};

const mockStateManager = {
    setModuleState: jest.fn(),
    getModuleState: jest.fn(),
    getAllModuleState: jest.fn()
};

const mockEventBus = {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn()
};

const mockPerformanceMonitor = {
    trackModule: jest.fn(() => ({
        trackLoad: jest.fn(() => ({ complete: jest.fn() })),
        trackRender: jest.fn(() => jest.fn()),
        trackDataFetch: jest.fn(() => jest.fn()),
        track: jest.fn(() => jest.fn())
    }))
};

// Import module
const M_Company = require('./M_Company');

// Sample test data
const mockCompanyData = [
    {
        Ticker: 'AAPL',
        corpName: 'Apple Inc.',
        currentPrice: 175.43,
        returnYTD: 0.45,
        return1M: 0.05,
        return3M: 0.12,
        marketCapMillions: 2800000,
        priceData: {
            return1Week: 0.02,
            return4Week: 0.05,
            return12Week: 0.12,
            return52Week: 0.45
        }
    },
    {
        Ticker: 'MSFT',
        corpName: 'Microsoft Corporation',
        currentPrice: 380.52,
        returnYTD: 0.58,
        return1M: 0.08,
        return3M: 0.15,
        marketCapMillions: 2850000,
        priceData: {
            return1Week: 0.03,
            return4Week: 0.08,
            return12Week: 0.15,
            return52Week: 0.58
        }
    },
    {
        Ticker: 'GOOGL',
        corpName: 'Alphabet Inc.',
        currentPrice: 140.88,
        returnYTD: 0.35,
        return1M: -0.02,
        return3M: 0.08,
        marketCapMillions: 1750000,
        priceData: {
            return1Week: -0.01,
            return4Week: -0.02,
            return12Week: 0.08,
            return52Week: 0.35
        }
    }
];

describe('M_Company Module', () => {
    let module;
    let context;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Set up context
        context = {
            dataProvider: mockDataProvider,
            stateManager: mockStateManager,
            eventBus: mockEventBus,
            performanceMonitor: mockPerformanceMonitor
        };

        // Mock DOM
        document.body.innerHTML = '<div id="momentum-company-container"></div>';

        // Create module instance
        module = new M_Company({
            updateInterval: 60000,
            maxCompanies: 100
        });

        // Mock global window object
        global.window = {
            M_Company: module
        };

        // Mock component dependencies
        global.MomentumCalculator = jest.fn().mockImplementation(() => ({
            calculate: jest.fn().mockReturnValue({
                price: 0.8,
                earnings: 0.7,
                volume: 0.6,
                fundamental: 0.75,
                technical: 0.65
            })
        }));

        global.RankingEngine = jest.fn().mockImplementation(() => ({
            rank: jest.fn().mockReturnValue([])
        }));

        global.FilterEngine = jest.fn().mockImplementation(() => ({
            filter: jest.fn().mockReturnValue(mockCompanyData)
        }));

        global.MomentumVisualizer = jest.fn().mockImplementation(() => ({
            render: jest.fn()
        }));
    });

    afterEach(() => {
        if (module) {
            module.destroy();
        }
        document.body.innerHTML = '';
    });

    describe('Module Initialization', () => {
        test('should initialize with default configuration', () => {
            expect(module.id).toBe('momentum-company');
            expect(module.name).toBe('Company Momentum');
            expect(module.version).toBe('1.0.0');
            expect(module.config.updateInterval).toBe(60000);
            expect(module.config.maxCompanies).toBe(100);
        });

        test('should accept custom configuration', () => {
            const customModule = new M_Company({
                updateInterval: 30000,
                maxCompanies: 500,
                defaultSort: 'return1M',
                defaultOrder: 'asc'
            });

            expect(customModule.config.updateInterval).toBe(30000);
            expect(customModule.config.maxCompanies).toBe(500);
            expect(customModule.config.defaultSort).toBe('return1M');
            expect(customModule.config.defaultOrder).toBe('asc');
        });

        test('should initialize dependencies correctly', async () => {
            await module.initialize(context);

            expect(module.dataProvider).toBe(mockDataProvider);
            expect(module.stateManager).toBe(mockStateManager);
            expect(module.eventBus).toBe(mockEventBus);
            expect(module.performanceMonitor).toBe(mockPerformanceMonitor);
        });

        test('should create component instances', async () => {
            await module.initialize(context);

            expect(global.MomentumCalculator).toHaveBeenCalled();
            expect(global.RankingEngine).toHaveBeenCalled();
            expect(global.FilterEngine).toHaveBeenCalled();
            expect(global.MomentumVisualizer).toHaveBeenCalled();
        });
    });

    describe('Module Activation', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({
                data: mockCompanyData
            });
            mockStateManager.getAllModuleState.mockReturnValue({});

            await module.initialize(context);
        });

        test('should activate module successfully', async () => {
            await module.activate();

            expect(module.container).toBeTruthy();
            expect(mockDataProvider.loadData).toHaveBeenCalledWith('companies');
            expect(mockStateManager.setModuleState)
                .toHaveBeenCalledWith('momentum-company', 'active', true);
        });

        test('should create UI elements', async () => {
            await module.activate();

            expect(document.getElementById('momentum-company-container')).toBeTruthy();
            expect(document.querySelector('.momentum-company')).toBeTruthy();
            expect(document.querySelector('.module-header')).toBeTruthy();
            expect(document.querySelector('.module-stats')).toBeTruthy();
        });

        test('should handle activation errors', async () => {
            mockDataProvider.loadData.mockRejectedValue(new Error('Data load failed'));

            await expect(module.activate()).rejects.toThrow('Data load failed');
        });
    });

    describe('Data Loading', () => {
        beforeEach(async () => {
            await module.initialize(context);
        });

        test('should load company data successfully', async () => {
            mockDataProvider.loadData.mockResolvedValue({
                data: mockCompanyData
            });

            await module.loadData();

            expect(module.companies).toEqual(mockCompanyData);
            expect(module.filteredCompanies).toEqual(mockCompanyData);
            expect(mockEventBus.emit).toHaveBeenCalledWith('momentum:data:loaded', {
                module: 'momentum-company',
                count: 3
            });
        });

        test('should handle array format data', async () => {
            mockDataProvider.loadData.mockResolvedValue(mockCompanyData);

            await module.loadData();

            expect(module.companies).toEqual(mockCompanyData);
        });

        test('should respect maxCompanies limit', async () => {
            const manyCompanies = Array(200).fill(null).map((_, i) => ({
                ...mockCompanyData[0],
                Ticker: `TICK${i}`
            }));

            mockDataProvider.loadData.mockResolvedValue({ data: manyCompanies });

            await module.loadData();

            expect(module.companies.length).toBe(100);
        });

        test('should handle data loading errors', async () => {
            mockDataProvider.loadData.mockRejectedValue(new Error('Network error'));

            await expect(module.loadData()).rejects.toThrow('Network error');
            expect(mockEventBus.emit).toHaveBeenCalledWith('momentum:data:error', {
                module: 'momentum-company',
                error: 'Network error'
            });
        });

        test('should handle invalid data format', async () => {
            mockDataProvider.loadData.mockResolvedValue('invalid data');

            await expect(module.loadData()).rejects.toThrow('Invalid company data format');
        });
    });

    describe('Momentum Calculation', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
            await module.loadData();
        });

        test('should calculate momentum for all companies', async () => {
            await module.calculateMomentum();

            expect(module.momentumCalculator.calculate)
                .toHaveBeenCalledTimes(mockCompanyData.length);

            module.companies.forEach(company => {
                expect(company.momentum).toBeDefined();
                expect(company.momentumScore).toBeDefined();
            });
        });

        test('should calculate composite momentum score', () => {
            const momentum = {
                price: 0.8,
                earnings: 0.7,
                volume: 0.6,
                fundamental: 0.75,
                technical: 0.65
            };

            const score = module.calculateCompositeScore(momentum);

            expect(score).toBeGreaterThan(0);
            expect(score).toBeLessThanOrEqual(1);
        });

        test('should handle missing momentum metrics', () => {
            const partialMomentum = {
                price: 0.8,
                volume: 0.6
            };

            const score = module.calculateCompositeScore(partialMomentum);

            expect(score).toBeGreaterThan(0);
            expect(score).toBeLessThanOrEqual(1);
        });

        test('should handle null momentum', () => {
            const score = module.calculateCompositeScore(null);
            expect(score).toBe(0);
        });

        test('should update rankings after calculation', async () => {
            await module.calculateMomentum();

            expect(module.rankings.size).toBeGreaterThan(0);
            expect(module.rankingEngine.rank).toHaveBeenCalled();
        });
    });

    describe('Filtering', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
            await module.loadData();
        });

        test('should apply filters correctly', () => {
            const filters = {
                sector: 'Technology',
                minMarketCap: 1000000
            };

            module.filterEngine.filter.mockReturnValue([mockCompanyData[0]]);

            module.applyFilters(filters);

            expect(module.filterEngine.filter)
                .toHaveBeenCalledWith(module.companies, filters);
            expect(module.filteredCompanies).toHaveLength(1);
            expect(mockStateManager.setModuleState)
                .toHaveBeenCalledWith('momentum-company', 'filters', filters);
        });

        test('should emit filter event', () => {
            const filters = { sector: 'Technology' };

            module.applyFilters(filters);

            expect(mockEventBus.emit).toHaveBeenCalledWith('momentum:filtered', {
                module: 'momentum-company',
                filters,
                count: expect.any(Number)
            });
        });

        test('should update rankings after filtering', () => {
            module.applyFilters({});

            expect(module.rankingEngine.rank).toHaveBeenCalled();
        });
    });

    describe('Sorting', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
            await module.loadData();
        });

        test('should sort companies by field', () => {
            module.sortCompanies('returnYTD', 'desc');

            const firstCompany = module.filteredCompanies[0];
            const lastCompany = module.filteredCompanies[module.filteredCompanies.length - 1];

            expect(firstCompany.returnYTD).toBeGreaterThanOrEqual(lastCompany.returnYTD);
        });

        test('should handle ascending sort', () => {
            module.sortCompanies('currentPrice', 'asc');

            const firstCompany = module.filteredCompanies[0];
            const lastCompany = module.filteredCompanies[module.filteredCompanies.length - 1];

            expect(firstCompany.currentPrice).toBeLessThanOrEqual(lastCompany.currentPrice);
        });

        test('should handle null values in sorting', () => {
            module.filteredCompanies[0].returnYTD = null;

            expect(() => module.sortCompanies('returnYTD', 'desc')).not.toThrow();
        });

        test('should update state after sorting', () => {
            module.sortCompanies('marketCapMillions', 'desc');

            expect(mockStateManager.setModuleState)
                .toHaveBeenCalledWith('momentum-company', 'sort', {
                    field: 'marketCapMillions',
                    order: 'desc'
                });
        });
    });

    describe('Company Selection', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
            await module.loadData();
            // Mock the showCompanyDetail method
            module.showCompanyDetail = jest.fn();
        });

        test('should select company by ticker', () => {
            module.selectCompany('AAPL');

            expect(module.selectedCompanies.has('AAPL')).toBe(true);
            expect(mockEventBus.emit).toHaveBeenCalledWith('momentum:company:selected', {
                module: 'momentum-company',
                ticker: 'AAPL',
                company: expect.objectContaining({ Ticker: 'AAPL' })
            });
        });

        test('should handle invalid ticker selection', () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            module.selectCompany('INVALID');

            expect(consoleSpy).toHaveBeenCalledWith('Company not found: INVALID');
            expect(module.selectedCompanies.has('INVALID')).toBe(false);

            consoleSpy.mockRestore();
        });

        test('should add companies to comparison', () => {
            module.addToComparison(['AAPL', 'MSFT']);

            expect(module.comparisonList).toHaveLength(2);
            expect(module.comparisonList[0].Ticker).toBe('AAPL');
            expect(module.comparisonList[1].Ticker).toBe('MSFT');
        });

        test('should limit comparison list to 10 companies', () => {
            const tickers = Array(15).fill(null).map((_, i) => 'AAPL');
            module.companies = Array(15).fill(null).map((_, i) => ({
                ...mockCompanyData[0],
                Ticker: `TICK${i}`
            }));

            module.addToComparison(module.companies.map(c => c.Ticker));

            expect(module.comparisonList).toHaveLength(10);
        });

        test('should prevent duplicate companies in comparison', () => {
            module.addToComparison(['AAPL']);
            module.addToComparison(['AAPL']);

            const appleCount = module.comparisonList.filter(c => c.Ticker === 'AAPL').length;
            expect(appleCount).toBe(1);
        });
    });

    describe('Export Functionality', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
            await module.loadData();

            // Mock download functionality
            global.URL = {
                createObjectURL: jest.fn(() => 'blob:url'),
                revokeObjectURL: jest.fn()
            };

            module.exportAsCSV = jest.fn().mockReturnValue('csv,data');
            module.exportAsExcel = jest.fn().mockResolvedValue('excel,data');
        });

        test('should export data as CSV', async () => {
            await module.exportData('csv');

            expect(module.exportAsCSV).toHaveBeenCalledWith(mockCompanyData);
            expect(mockEventBus.emit).toHaveBeenCalledWith('momentum:exported', {
                module: 'momentum-company',
                format: 'csv',
                count: 3
            });
        });

        test('should export data as JSON', async () => {
            await module.exportData('json');

            expect(mockEventBus.emit).toHaveBeenCalledWith('momentum:exported', {
                module: 'momentum-company',
                format: 'json',
                count: 3
            });
        });

        test('should export filtered data when specified', async () => {
            module.filteredCompanies = [mockCompanyData[0]];

            await module.exportData('csv', { filtered: true });

            expect(module.exportAsCSV).toHaveBeenCalledWith([mockCompanyData[0]]);
        });

        test('should handle unsupported export format', async () => {
            await expect(module.exportData('pdf')).rejects.toThrow('Unsupported export format: pdf');
        });
    });

    describe('UI Rendering', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
            await module.activate();
        });

        test('should render table view', () => {
            module.renderTableView();

            const table = document.querySelector('.momentum-table');
            expect(table).toBeTruthy();

            const rows = table.querySelectorAll('tbody tr');
            expect(rows.length).toBe(3);
        });

        test('should update statistics display', () => {
            module.updateStatistics();

            expect(document.getElementById('mc-total-count').textContent)
                .toBe(module.companies.length.toString());
            expect(document.getElementById('mc-filtered-count').textContent)
                .toBe(module.filteredCompanies.length.toString());
        });

        test('should format numbers correctly', () => {
            expect(module.formatNumber(123.456)).toBe('123.46');
            expect(module.formatNumber(null)).toBe('-');
            expect(module.formatNumber(undefined)).toBe('-');
        });

        test('should format percentages correctly', () => {
            expect(module.formatPercent(0.1234)).toBe('+12.34%');
            expect(module.formatPercent(-0.0567)).toBe('-5.67%');
            expect(module.formatPercent(null)).toBe('-');
        });

        test('should format large numbers correctly', () => {
            expect(module.formatLargeNumber(1500000)).toBe('1.5T');
            expect(module.formatLargeNumber(2500)).toBe('2.5B');
            expect(module.formatLargeNumber(500)).toBe('500');
            expect(module.formatLargeNumber(null)).toBe('-');
        });
    });

    describe('Auto-Update', () => {
        beforeEach(async () => {
            jest.useFakeTimers();
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('should start auto-update timer', async () => {
            await module.activate();

            expect(module.updateTimer).toBeTruthy();

            jest.advanceTimersByTime(60000);

            expect(mockDataProvider.loadData).toHaveBeenCalledTimes(2);
        });

        test('should stop auto-update timer', () => {
            module.startAutoUpdate();
            expect(module.updateTimer).toBeTruthy();

            module.stopAutoUpdate();
            expect(module.updateTimer).toBeNull();
        });

        test('should not start multiple timers', () => {
            module.startAutoUpdate();
            const firstTimer = module.updateTimer;

            module.startAutoUpdate();
            expect(module.updateTimer).toBe(firstTimer);
        });
    });

    describe('State Management', () => {
        beforeEach(async () => {
            await module.initialize(context);
        });

        test('should load saved state', async () => {
            const savedState = {
                filters: { sector: 'Technology' },
                sort: { field: 'returnYTD', order: 'desc' },
                selectedCompanies: ['AAPL', 'MSFT'],
                comparisonList: ['AAPL']
            };

            mockStateManager.getAllModuleState.mockReturnValue(savedState);

            await module.loadState();

            expect(module.selectedCompanies).toEqual(new Set(['AAPL', 'MSFT']));
            expect(module.comparisonList).toEqual(['AAPL']);
        });

        test('should save current state', async () => {
            module.selectedCompanies = new Set(['AAPL', 'GOOGL']);
            module.comparisonList = [{ Ticker: 'MSFT' }];

            await module.saveState();

            expect(mockStateManager.setModuleState)
                .toHaveBeenCalledWith('momentum-company', 'selectedCompanies', ['AAPL', 'GOOGL']);
            expect(mockStateManager.setModuleState)
                .toHaveBeenCalledWith('momentum-company', 'comparisonList', ['MSFT']);
        });
    });

    describe('Event Handling', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
            await module.loadData();
        });

        test('should handle data update events', async () => {
            const handler = mockEventBus.on.mock.calls.find(
                call => call[0] === 'data:updated'
            )[1];

            await handler({ dataType: 'companies' });

            expect(mockDataProvider.loadData).toHaveBeenCalled();
        });

        test('should handle security selection events', () => {
            module.selectCompany = jest.fn();

            const handler = mockEventBus.on.mock.calls.find(
                call => call[0] === 'user:security:selected'
            )[1];

            handler({ ticker: 'AAPL' });

            expect(module.selectCompany).toHaveBeenCalledWith('AAPL');
        });

        test('should handle filter application events', () => {
            module.applyFilters = jest.fn();

            const handler = mockEventBus.on.mock.calls.find(
                call => call[0] === 'user:filter:applied'
            )[1];

            const filters = { sector: 'Technology' };
            handler({ module: 'momentum-company', filters });

            expect(module.applyFilters).toHaveBeenCalledWith(filters);
        });
    });

    describe('Module Deactivation', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
            await module.activate();
        });

        test('should deactivate module correctly', async () => {
            module.stopAutoUpdate = jest.fn();
            module.saveState = jest.fn();
            module.clearUI = jest.fn();

            await module.deactivate();

            expect(module.stopAutoUpdate).toHaveBeenCalled();
            expect(module.saveState).toHaveBeenCalled();
            expect(module.clearUI).toHaveBeenCalled();
            expect(mockStateManager.setModuleState)
                .toHaveBeenCalledWith('momentum-company', 'active', false);
        });

        test('should clear UI on deactivation', async () => {
            await module.deactivate();

            expect(module.container.innerHTML).toBe('');
        });
    });

    describe('Module Destruction', () => {
        beforeEach(async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });
            await module.initialize(context);
            await module.activate();
        });

        test('should destroy module completely', () => {
            module.destroy();

            expect(module.companies).toEqual([]);
            expect(module.filteredCompanies).toEqual([]);
            expect(module.rankings.size).toBe(0);
            expect(module.updateTimer).toBeNull();
        });
    });

    describe('Performance Tracking', () => {
        beforeEach(async () => {
            await module.initialize(context);
        });

        test('should track module activation performance', async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });

            await module.activate();

            expect(mockPerformanceMonitor.trackModule).toHaveBeenCalledWith('momentum-company');
        });

        test('should track data loading performance', async () => {
            mockDataProvider.loadData.mockResolvedValue({ data: mockCompanyData });

            await module.loadData();

            const tracker = mockPerformanceMonitor.trackModule('momentum-company');
            expect(tracker.trackDataFetch).toHaveBeenCalledWith('companies');
        });

        test('should track rendering performance', () => {
            module.render();

            const tracker = mockPerformanceMonitor.trackModule('momentum-company');
            expect(tracker.trackRender).toHaveBeenCalled();
        });
    });

    describe('Utility Functions', () => {
        beforeEach(async () => {
            await module.initialize(context);
        });

        test('should get nested object values', () => {
            const obj = {
                level1: {
                    level2: {
                        value: 'nested'
                    }
                }
            };

            expect(module.getNestedValue(obj, 'level1.level2.value')).toBe('nested');
            expect(module.getNestedValue(obj, 'level1.missing')).toBeUndefined();
            expect(module.getNestedValue(null, 'any')).toBeUndefined();
        });
    });

    describe('Error Handling', () => {
        beforeEach(async () => {
            await module.initialize(context);
        });

        test('should handle missing dependencies gracefully', async () => {
            module.dataProvider = null;

            await expect(module.loadData()).rejects.toThrow();
        });

        test('should handle render errors', () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            // Force an error in render
            module.container = null;

            expect(() => module.render()).not.toThrow();

            consoleSpy.mockRestore();
        });

        test('should handle refresh errors', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            mockDataProvider.loadData.mockRejectedValue(new Error('Refresh failed'));

            await module.refresh();

            expect(consoleSpy).toHaveBeenCalledWith('❌ Refresh failed:', expect.any(Error));

            consoleSpy.mockRestore();
        });
    });
});

// Export for Jest
module.exports = {};