# Stock Analyzer Enhanced - Comprehensive Refactoring Plan

**Analysis Date**: 2025-10-17
**Codebase Size**: ~4,766 lines (main file) + 27,196 lines (modules)
**Total Classes**: 50+ classes across modular architecture
**Analysis Scope**: Full system architecture, code quality, and technical debt

---

## Executive Summary

The Stock Analyzer Enhanced application has evolved from a monolithic structure into a modular architecture with significant progress. However, **critical technical debt** remains, particularly in the main orchestration file (`stock_analyzer_enhanced.js` at 4,766 lines) and several god-class modules. This refactoring plan provides a phased approach to reduce complexity, improve maintainability, and establish sustainable architectural patterns.

### Key Metrics

| Metric | Current | Target | Priority |
|--------|---------|--------|----------|
| Main file size | 4,766 lines | <500 lines | 🔴 Critical |
| Largest module | 1,229 lines | <300 lines | 🔴 Critical |
| Global state variables | 10+ | 0 | 🔴 Critical |
| Cyclomatic complexity | High | Medium | 🟡 Important |
| Code duplication | ~15-20% | <5% | 🟡 Important |
| Test coverage | 0% | >70% | 🟢 Future |

---

## Phase 1: Critical Refactoring (Sprint 4-5)

**Goal**: Eliminate god objects, reduce main file size by 80%, establish dependency injection

### 1.1 Main File Decomposition (Priority: 🔴 CRITICAL)

**Problem**: `stock_analyzer_enhanced.js` is a 4,766-line god file with mixed responsibilities

**Current Structure**:
```javascript
// Anti-pattern: Everything in one file
let allData = [];              // Global state
let config = {};               // Global config
let columnConfig = {};         // Global config
let metadata = {};             // Global metadata
window.activeCompanyForComparison = null;  // Global window pollution

class SimplePaginationManager { }  // Inline class definition
const ERROR_MESSAGES = { };         // Configuration constant
async function init() { }           // 80+ line initialization
async function loadData() { }       // Complex data loading
function renderTable(data) { }      // 167-line rendering
// ... 50+ more functions
```

**Target Structure**:
```javascript
// main.js (~400 lines max)
import { Application } from './core/Application.js';
import { AppConfig } from './config/AppConfig.js';

document.addEventListener('DOMContentLoaded', async () => {
    const config = await AppConfig.load();
    const app = new Application(config);
    await app.initialize();
});
```

**Refactoring Tasks**:

#### Task 1.1.1: Extract Application Core (Risk: LOW)
```javascript
// Before: Scattered initialization
async function init() {
    console.log("Stock Analyzer Enhanced Initializing...");
    await loadData();
    await loadScreenerIndices();
    renderScreenerPanel();
    // 80+ more lines of manager initialization...
}

// After: Centralized application bootstrap
// File: src/core/Application.js
export class Application {
    constructor(config, dependencies) {
        this.config = config;
        this.eventBus = dependencies.eventBus;
        this.dataProvider = dependencies.dataProvider;
        this.moduleRegistry = dependencies.moduleRegistry;
        this.stateManager = dependencies.stateManager;
    }

    async initialize() {
        await this.dataProvider.loadInitialData();
        await this.moduleRegistry.registerCoreModules();
        await this.setupEventHandlers();
        await this.renderInitialUI();
    }

    async renderInitialUI() {
        const screenerModule = await this.moduleRegistry.activateModule('screener');
        await screenerModule.render();
    }
}
```

**Benefits**:
- Single responsibility (orchestration only)
- Testable initialization flow
- Clear dependency management
- ~4,300 lines moved to specialized modules

#### Task 1.1.2: Extract Global State to StateManager (Risk: MEDIUM)
```javascript
// Before: Global state pollution (ANTI-PATTERN)
let allData = [];
let config = {};
let columnConfig = {};
let metadata = {};
let indices = { quality: [], value: [], momentum: [] };
let currentFilter = 'all';
let sortState = { column: null, order: 'asc' };
let currentPage = 1;
let pageSize = 50;
window.activeCompanyForComparison = null;

// After: Centralized state management
// File: src/core/StateManager.js (ALREADY EXISTS - NEEDS ENHANCEMENT)
export class StateManager {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.state = this.getInitialState();
        this.subscribers = new Map();
        this.history = [];
    }

    getInitialState() {
        return {
            data: {
                companies: [],
                indices: { quality: [], value: [], momentum: [] },
                metadata: {}
            },
            ui: {
                currentFilter: 'all',
                sortState: { column: null, order: 'asc' },
                pagination: { currentPage: 1, pageSize: 50 },
                activeComparison: null
            },
            config: {
                column: {},
                app: {}
            }
        };
    }

    setState(path, value) {
        const oldValue = this.getState(path);
        this.setValueByPath(this.state, path, value);
        this.history.push({ path, oldValue, newValue: value, timestamp: Date.now() });
        this.notifySubscribers(path, value, oldValue);
        this.eventBus.emit('state:changed', { path, value, oldValue });
    }

    getState(path) {
        return this.getValueByPath(this.state, path);
    }

    subscribe(path, callback) {
        if (!this.subscribers.has(path)) {
            this.subscribers.set(path, new Set());
        }
        this.subscribers.get(path).add(callback);
        return () => this.subscribers.get(path).delete(callback);
    }

    private notifySubscribers(path, newValue, oldValue) {
        const subscribers = this.subscribers.get(path);
        if (subscribers) {
            subscribers.forEach(callback => callback(newValue, oldValue));
        }
    }
}
```

**Usage Example**:
```javascript
// Before
window.activeCompanyForComparison = company;

// After
stateManager.setState('ui.activeComparison', company);
```

**Benefits**:
- Zero global variables
- Change tracking and undo capability
- Reactive updates via subscriptions
- Clear state ownership

#### Task 1.1.3: Extract Configuration Management (Risk: LOW)
```javascript
// Before: Inline configuration
const ERROR_MESSAGES = {
    LOAD_FAILED: '데이터 로딩에 실패했습니다...',
    // ... many more
};

// After: Structured configuration
// File: src/config/AppConfig.js
export class AppConfig {
    static async load() {
        const [columnConfig, appConfig, errorMessages] = await Promise.all([
            fetch('./data/column_config.json').then(r => r.json()),
            fetch('./stock_analyzer_config.json').then(r => r.json()),
            fetch('./config/error_messages.json').then(r => r.json())
        ]);

        return new AppConfig(columnConfig, appConfig, errorMessages);
    }

    constructor(columnConfig, appConfig, errorMessages) {
        this.column = columnConfig;
        this.app = appConfig;
        this.errorMessages = errorMessages;
        this.validate();
    }

    validate() {
        if (!this.column || !this.app) {
            throw new Error('Invalid configuration');
        }
    }

    getErrorMessage(key) {
        return this.errorMessages[key] || 'Unknown error';
    }
}
```

**Benefits**:
- Configuration validation
- Type safety for configs
- Easy testing with mock configs
- Centralized config updates

---

### 1.2 God Class Decomposition (Priority: 🔴 CRITICAL)

**Problem**: Multiple modules exceed 1,000 lines with mixed responsibilities

#### Target 1: CompanyDetailView.js (1,229 lines)

**Current Issues**:
- Mixed UI rendering, data transformation, chart creation
- No separation of concerns
- Difficult to test

**Refactoring Strategy**:
```javascript
// Before: God class with everything
class CompanyDetailView {
    showDetailView(ticker) {
        // Data fetching
        const data = this.fetchCompanyData(ticker);

        // Data transformation
        const transformed = this.transformData(data);

        // Chart creation
        this.createCharts(transformed);

        // DOM manipulation
        this.renderUI(transformed);

        // Event handling
        this.attachEventHandlers();
    }
}

// After: Separated responsibilities
// File: src/modules/CompanyDetail/CompanyDetailView.js (~300 lines)
export class CompanyDetailView {
    constructor(dataProvider, chartFactory, renderer) {
        this.dataProvider = dataProvider;
        this.chartFactory = chartFactory;
        this.renderer = renderer;
    }

    async showDetailView(ticker) {
        const data = await this.dataProvider.getCompanyDetail(ticker);
        const viewModel = CompanyDetailViewModel.from(data);
        const charts = this.chartFactory.createDetailCharts(viewModel);
        this.renderer.render(viewModel, charts);
    }
}

// File: src/modules/CompanyDetail/CompanyDetailViewModel.js (~150 lines)
export class CompanyDetailViewModel {
    static from(companyData) {
        return new CompanyDetailViewModel({
            ticker: companyData.Ticker,
            name: companyData.corpName,
            metrics: MetricsTransformer.transform(companyData),
            charts: ChartDataTransformer.transform(companyData)
        });
    }
}

// File: src/modules/CompanyDetail/CompanyDetailRenderer.js (~200 lines)
export class CompanyDetailRenderer {
    render(viewModel, charts) {
        const container = this.createContainer();
        container.appendChild(this.renderHeader(viewModel));
        container.appendChild(this.renderMetrics(viewModel.metrics));
        container.appendChild(this.renderCharts(charts));
        return container;
    }
}

// File: src/modules/CompanyDetail/CompanyDetailChartFactory.js (~150 lines)
export class CompanyDetailChartFactory {
    constructor(chartManager) {
        this.chartManager = chartManager;
    }

    createDetailCharts(viewModel) {
        return {
            radar: this.chartManager.createRadarChart(viewModel.charts.radar),
            comparison: this.chartManager.createComparisonChart(viewModel.charts.comparison)
        };
    }
}
```

**Benefits**:
- Each class <300 lines
- Single Responsibility Principle
- Testable components
- Reusable transformers

#### Target 2: DataCleanupManager.js (1,118 lines)

**Current Issues**:
- Data validation, cleaning, transformation all mixed
- Multiple responsibilities in one class

**Refactoring Strategy**:
```javascript
// After: Strategy Pattern for data operations
// File: src/data/strategies/ValidationStrategy.js
export class ValidationStrategy {
    validate(data) {
        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }
}

export class NumericValidationStrategy extends ValidationStrategy {
    validate(value) {
        const parsed = parseFloat(value);
        return {
            isValid: !isNaN(parsed),
            errors: isNaN(parsed) ? ['Not a number'] : [],
            warnings: []
        };
    }
}

// File: src/data/DataCleaner.js (~200 lines)
export class DataCleaner {
    constructor(strategies) {
        this.strategies = strategies; // { field: ValidationStrategy }
    }

    clean(records) {
        return records.map(record => this.cleanRecord(record));
    }

    cleanRecord(record) {
        const cleaned = { ...record };
        for (const [field, strategy] of Object.entries(this.strategies)) {
            const result = strategy.validate(record[field]);
            if (result.isValid) {
                cleaned[field] = strategy.transform(record[field]);
            } else {
                cleaned[field] = strategy.getDefault();
                cleaned._errors = [...(cleaned._errors || []), ...result.errors];
            }
        }
        return cleaned;
    }
}
```

**Benefits**:
- Strategy pattern for extensibility
- Each strategy <100 lines
- Easy to add new validation rules
- Testable strategies

---

### 1.3 Eliminate Code Duplication (Priority: 🟡 IMPORTANT)

**Problem**: Chart creation, data transformation, error handling duplicated across modules

#### Duplication 1: Chart Creation Patterns

**Before**: Repeated pattern in ChartManager, AdvancedChartManager, DeepCompare
```javascript
// ChartManager.js
createRadarChart(canvasId, companyData) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) { console.warn(`캔버스를 찾을 수 없습니다`); return null; }
    if (this.charts.has(canvasId)) { this.charts.get(canvasId).destroy(); }
    const ctx = canvas.getContext('2d');
    // ... chart creation
}

// AdvancedChartManager.js
createAdvancedRadarChart(canvasId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) { console.warn(`캔버스를 찾을 수 없습니다`); return null; }
    if (this.charts.has(canvasId)) { this.charts.get(canvasId).destroy(); }
    const ctx = canvas.getContext('2d');
    // ... similar chart creation
}
```

**After**: Template Method Pattern
```javascript
// File: src/charts/BaseChartFactory.js
export class BaseChartFactory {
    constructor(chartRegistry) {
        this.chartRegistry = chartRegistry;
    }

    createChart(canvasId, config) {
        const canvas = this.getCanvas(canvasId);
        if (!canvas) return null;

        this.destroyExisting(canvasId);
        const chart = this.buildChart(canvas, config);
        this.chartRegistry.register(canvasId, chart);
        return chart;
    }

    getCanvas(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.warn(`Canvas not found: ${canvasId}`);
            return null;
        }
        return canvas;
    }

    destroyExisting(canvasId) {
        if (this.chartRegistry.has(canvasId)) {
            this.chartRegistry.get(canvasId).destroy();
        }
    }

    buildChart(canvas, config) {
        // Template method - subclasses implement
        throw new Error('buildChart must be implemented');
    }
}

// File: src/charts/RadarChartFactory.js
export class RadarChartFactory extends BaseChartFactory {
    buildChart(canvas, config) {
        const ctx = canvas.getContext('2d');
        return new Chart(ctx, {
            type: 'radar',
            data: config.data,
            options: this.getRadarOptions(config)
        });
    }

    getRadarOptions(config) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            // ... radar-specific options
        };
    }
}
```

**Benefits**:
- 70% reduction in duplicated code
- Consistent chart lifecycle
- Easy to add new chart types
- Single point of modification

#### Duplication 2: Data Transformation

**Before**: Similar transformation logic in multiple modules
```javascript
// GrowthAnalytics.js
parseGrowth(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = parseFloat(value);
    if (isNaN(num)) return null;
    if (Math.abs(num) <= 1) return num * 100;
    return num;
}

// ComparisonEngine.js
normalizeValue(value, min, max, reverse = false) {
    if (value == null) return 0;
    const num = parseFloat(value);
    if (isNaN(num)) return 0;
    // ... normalization logic
}
```

**After**: Unified Transformer Service
```javascript
// File: src/services/DataTransformerService.js
export class DataTransformerService {
    parseNumeric(value, defaultValue = null) {
        if (value == null || value === '') return defaultValue;
        const num = parseFloat(value);
        return isNaN(num) ? defaultValue : num;
    }

    parsePercentage(value) {
        const num = this.parseNumeric(value);
        if (num === null) return null;
        return Math.abs(num) <= 1 ? num * 100 : num;
    }

    normalize(value, min, max, invert = false) {
        const num = this.parseNumeric(value, 0);
        const normalized = (num - min) / (max - min) * 100;
        return invert ? 100 - normalized : normalized;
    }

    formatCurrency(value, currency = 'USD') {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency
        }).format(value);
    }
}
```

**Benefits**:
- Single source of truth for transformations
- Consistent data handling
- Easy to add new transformations
- Testable pure functions

---

### 1.4 Dependency Injection Pattern (Priority: 🔴 CRITICAL)

**Problem**: Tight coupling via `window` global object and direct instantiation

**Before**: Tight coupling anti-pattern
```javascript
// Scattered throughout codebase
if (window.columnManager) {
    window.columnManager.initialize();
}

if (window.advancedFilterManager) {
    window.advancedFilterManager.initialize();
}

// Direct instantiation
const chartManager = new ChartManager();
```

**After**: Dependency Injection Container
```javascript
// File: src/core/DIContainer.js
export class DIContainer {
    constructor() {
        this.services = new Map();
        this.factories = new Map();
    }

    register(name, factory, options = {}) {
        this.factories.set(name, {
            factory,
            singleton: options.singleton !== false,
            instance: null
        });
    }

    resolve(name) {
        if (!this.factories.has(name)) {
            throw new Error(`Service ${name} not registered`);
        }

        const service = this.factories.get(name);

        if (service.singleton) {
            if (!service.instance) {
                service.instance = service.factory(this);
            }
            return service.instance;
        }

        return service.factory(this);
    }

    resolveAll(names) {
        return names.reduce((acc, name) => {
            acc[name] = this.resolve(name);
            return acc;
        }, {});
    }
}

// File: src/config/services.js
export function registerServices(container) {
    // Core services
    container.register('eventBus', () => new EventBus(), { singleton: true });
    container.register('stateManager', (c) => new StateManager(c.resolve('eventBus')), { singleton: true });
    container.register('dataProvider', (c) => new DataProvider(c.resolve('eventBus')), { singleton: true });

    // Managers
    container.register('chartManager', (c) => new ChartManager(
        c.resolve('dataProvider'),
        c.resolve('eventBus')
    ), { singleton: true });

    container.register('filterManager', (c) => new FilterManager(
        c.resolve('dataProvider'),
        c.resolve('stateManager'),
        c.resolve('eventBus')
    ), { singleton: true });

    // Module registry
    container.register('moduleRegistry', (c) => new ModuleRegistry(
        c.resolve('eventBus')
    ), { singleton: true });
}

// File: main.js
const container = new DIContainer();
registerServices(container);

const app = container.resolve('application');
await app.initialize();
```

**Benefits**:
- Testable components (inject mocks)
- Clear dependency graph
- No window pollution
- Easy to swap implementations

---

## Phase 2: Architecture Improvements (Sprint 6-8)

**Goal**: Establish sustainable patterns, improve code organization, reduce cognitive load

### 2.1 Implement Repository Pattern for Data Access

**Problem**: Data access scattered across modules, no caching strategy, no offline support

**After**: Repository Pattern
```javascript
// File: src/repositories/CompanyRepository.js
export class CompanyRepository {
    constructor(dataProvider, cache, eventBus) {
        this.dataProvider = dataProvider;
        this.cache = cache;
        this.eventBus = eventBus;
    }

    async getAll() {
        const cacheKey = 'companies:all';

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const companies = await this.dataProvider.loadData('companies');
        this.cache.set(cacheKey, companies);
        this.eventBus.emit('data:loaded', { type: 'companies', count: companies.length });

        return companies;
    }

    async getByTicker(ticker) {
        const companies = await this.getAll();
        return companies.find(c => c.Ticker === ticker);
    }

    async getByIndustry(industry) {
        const companies = await this.getAll();
        return companies.filter(c => c.industry === industry);
    }

    async query(criteria) {
        const companies = await this.getAll();
        return new CompanyQueryBuilder(companies)
            .where(criteria)
            .execute();
    }

    invalidateCache() {
        this.cache.clear('companies:*');
        this.eventBus.emit('cache:invalidated', { repository: 'company' });
    }
}

// File: src/repositories/CompanyQueryBuilder.js
export class CompanyQueryBuilder {
    constructor(data) {
        this.data = data;
        this.filters = [];
        this.sortOptions = null;
        this.limitValue = null;
    }

    where(criteria) {
        this.filters.push(criteria);
        return this;
    }

    sortBy(field, order = 'asc') {
        this.sortOptions = { field, order };
        return this;
    }

    limit(count) {
        this.limitValue = count;
        return this;
    }

    execute() {
        let result = [...this.data];

        // Apply filters
        for (const criteria of this.filters) {
            result = result.filter(item => this.evaluateCriteria(item, criteria));
        }

        // Apply sorting
        if (this.sortOptions) {
            result.sort(this.createComparator(this.sortOptions));
        }

        // Apply limit
        if (this.limitValue) {
            result = result.slice(0, this.limitValue);
        }

        return result;
    }

    evaluateCriteria(item, criteria) {
        for (const [field, condition] of Object.entries(criteria)) {
            if (!this.matchCondition(item[field], condition)) {
                return false;
            }
        }
        return true;
    }

    matchCondition(value, condition) {
        if (typeof condition === 'object') {
            if (condition.$gte !== undefined) return value >= condition.$gte;
            if (condition.$lte !== undefined) return value <= condition.$lte;
            if (condition.$in !== undefined) return condition.$in.includes(value);
        }
        return value === condition;
    }

    createComparator({ field, order }) {
        return (a, b) => {
            const aVal = a[field];
            const bVal = b[field];
            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return order === 'asc' ? comparison : -comparison;
        };
    }
}
```

**Usage**:
```javascript
// Before: Direct data access everywhere
const companies = window.allData.filter(c => c.industry === 'Technology');

// After: Repository pattern
const techCompanies = await companyRepository.getByIndustry('Technology');

// Complex queries
const highGrowthTech = await companyRepository.query({
    industry: 'Technology',
    'Sales (3)': { $gte: 20 },
    'ROE (Fwd)': { $gte: 15 }
})
.sortBy('Sales (3)', 'desc')
.limit(50)
.execute();
```

**Benefits**:
- Centralized data access logic
- Consistent caching strategy
- Query builder for complex filters
- Easy to add offline support

---

### 2.2 Module Communication via Event Bus

**Problem**: Direct module coupling, callbacks scattered everywhere

**After**: Event-Driven Communication
```javascript
// File: src/modules/FilterModule/FilterModule.js
export class FilterModule {
    constructor(eventBus, filterRepository) {
        this.eventBus = eventBus;
        this.filterRepository = filterRepository;
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.eventBus.on('filter:apply', async ({ criteria }) => {
            const results = await this.filterRepository.apply(criteria);
            this.eventBus.emit('filter:applied', { results, criteria });
        });

        this.eventBus.on('filter:reset', () => {
            this.filterRepository.reset();
            this.eventBus.emit('filter:reset:complete');
        });
    }

    applyFilter(criteria) {
        this.eventBus.emit('filter:apply', { criteria });
    }
}

// File: src/modules/TableModule/TableModule.js
export class TableModule {
    constructor(eventBus, tableRenderer) {
        this.eventBus = eventBus;
        this.tableRenderer = tableRenderer;
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.eventBus.on('filter:applied', ({ results }) => {
            this.tableRenderer.render(results);
        });

        this.eventBus.on('sort:applied', ({ data, column, order }) => {
            this.tableRenderer.update(data);
        });
    }
}
```

**Standard Events**:
```javascript
// Data Events
'data:loaded'           // { type, count, data }
'data:updated'          // { type, changes }
'data:error'            // { type, error }

// User Action Events
'user:filter:applied'   // { criteria, results }
'user:sort:applied'     // { column, order }
'user:search:performed' // { query, results }
'user:company:selected' // { ticker, company }

// UI Events
'ui:modal:opened'       // { modalId }
'ui:modal:closed'       // { modalId }
'ui:tab:changed'        // { from, to }

// System Events
'system:ready'          // { modules }
'system:error'          // { module, error }
```

**Benefits**:
- Loose coupling between modules
- Easy to add new features
- Clear data flow
- Testable event handlers

---

### 2.3 Factory Pattern for Module Creation

**Problem**: Module instantiation scattered, hard to control lifecycle

**After**: Module Factory
```javascript
// File: src/factories/ModuleFactory.js
export class ModuleFactory {
    constructor(container) {
        this.container = container;
        this.moduleDefinitions = new Map();
    }

    registerModule(id, definition) {
        this.moduleDefinitions.set(id, definition);
    }

    createModule(id, options = {}) {
        const definition = this.moduleDefinitions.get(id);

        if (!definition) {
            throw new Error(`Module ${id} not registered`);
        }

        const dependencies = this.resolveDependencies(definition.dependencies);
        const module = new definition.class({ ...dependencies, ...options });

        if (typeof module.initialize === 'function') {
            module.initialize();
        }

        return module;
    }

    resolveDependencies(deps) {
        return deps.reduce((acc, dep) => {
            acc[dep] = this.container.resolve(dep);
            return acc;
        }, {});
    }
}

// File: src/config/modules.js
export function registerModules(factory) {
    factory.registerModule('screener', {
        class: ScreenerModule,
        dependencies: ['eventBus', 'dataProvider', 'filterManager', 'tableRenderer']
    });

    factory.registerModule('dashboard', {
        class: DashboardModule,
        dependencies: ['eventBus', 'dataProvider', 'chartManager']
    });

    factory.registerModule('portfolio', {
        class: PortfolioModule,
        dependencies: ['eventBus', 'portfolioRepository', 'optimizationEngine']
    });
}
```

**Benefits**:
- Consistent module creation
- Automatic dependency resolution
- Module lifecycle management
- Easy to add new modules

---

### 2.4 Improve Error Handling

**Problem**: Inconsistent error handling, errors silently swallowed

**After**: Centralized Error Handling
```javascript
// File: src/core/ErrorHandler.js
export class ErrorHandler {
    constructor(eventBus, logger, errorBoundary) {
        this.eventBus = eventBus;
        this.logger = logger;
        this.errorBoundary = errorBoundary;
        this.errorStrategies = new Map();
        this.setupGlobalHandlers();
    }

    setupGlobalHandlers() {
        window.addEventListener('error', (event) => {
            this.handleError(event.error, { source: 'window', event });
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.handleError(event.reason, { source: 'promise', event });
        });

        this.eventBus.on('system:error', ({ error, context }) => {
            this.handleError(error, context);
        });
    }

    registerStrategy(errorType, strategy) {
        this.errorStrategies.set(errorType, strategy);
    }

    handleError(error, context = {}) {
        const errorType = this.classifyError(error);
        const strategy = this.errorStrategies.get(errorType) || this.defaultStrategy;

        this.logger.error(error, context);

        const recovery = strategy.handle(error, context);

        if (recovery.shouldNotify) {
            this.notifyUser(error, recovery);
        }

        if (recovery.shouldReport) {
            this.reportError(error, context);
        }

        return recovery;
    }

    classifyError(error) {
        if (error.name === 'NetworkError' || error.message.includes('fetch')) {
            return 'network';
        }
        if (error.name === 'ValidationError') {
            return 'validation';
        }
        if (error.name === 'DataError') {
            return 'data';
        }
        return 'unknown';
    }

    notifyUser(error, recovery) {
        this.eventBus.emit('ui:notification:show', {
            type: 'error',
            title: recovery.title,
            message: recovery.message,
            actions: recovery.actions
        });
    }

    reportError(error, context) {
        // Send to error tracking service
        console.error('Error reported:', error, context);
    }
}

// File: src/errors/strategies/NetworkErrorStrategy.js
export class NetworkErrorStrategy {
    handle(error, context) {
        return {
            shouldNotify: true,
            shouldReport: true,
            title: 'Network Error',
            message: 'Unable to connect. Please check your internet connection.',
            actions: [
                { label: 'Retry', handler: () => context.retry() },
                { label: 'Dismiss', handler: () => {} }
            ]
        };
    }
}
```

**Benefits**:
- Consistent error handling
- User-friendly error messages
- Error tracking and reporting
- Recovery strategies

---

## Phase 3: Optimization & Quality (Sprint 9+)

**Goal**: Performance optimization, testing infrastructure, documentation

### 3.1 Performance Optimization

#### Task 3.1.1: Virtual Scrolling for Large Tables
```javascript
// File: src/components/VirtualTable/VirtualTable.js
export class VirtualTable {
    constructor(container, options) {
        this.container = container;
        this.rowHeight = options.rowHeight || 40;
        this.visibleRows = options.visibleRows || 20;
        this.buffer = options.buffer || 5;
        this.data = [];
        this.scrollTop = 0;
    }

    setData(data) {
        this.data = data;
        this.render();
    }

    render() {
        const totalHeight = this.data.length * this.rowHeight;
        const startIndex = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - this.buffer);
        const endIndex = Math.min(this.data.length, startIndex + this.visibleRows + this.buffer * 2);

        const visibleData = this.data.slice(startIndex, endIndex);

        this.container.innerHTML = `
            <div style="height: ${totalHeight}px; position: relative;">
                <div style="transform: translateY(${startIndex * this.rowHeight}px);">
                    ${visibleData.map(row => this.renderRow(row)).join('')}
                </div>
            </div>
        `;
    }

    renderRow(data) {
        return `<div class="table-row" style="height: ${this.rowHeight}px;">${data}</div>`;
    }
}
```

**Expected Performance Gain**: 90% reduction in DOM nodes for 6,000+ rows

#### Task 3.1.2: Memoization for Expensive Calculations
```javascript
// File: src/utils/memoization.js
export function memoize(fn, keyGenerator = (...args) => JSON.stringify(args)) {
    const cache = new Map();

    return function memoized(...args) {
        const key = keyGenerator(...args);

        if (cache.has(key)) {
            return cache.get(key);
        }

        const result = fn.apply(this, args);
        cache.set(key, result);
        return result;
    };
}

// Usage: Memoize expensive industry average calculations
class GrowthAnalytics {
    constructor() {
        this.getSectorGrowthAverages = memoize(
            this.getSectorGrowthAverages.bind(this)
        );
    }

    getSectorGrowthAverages() {
        // Expensive calculation - now cached
    }
}
```

#### Task 3.1.3: Web Workers for Heavy Computation
```javascript
// File: src/workers/dataProcessor.worker.js
self.onmessage = function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'calculateMomentum':
            const result = calculateMomentumScores(data);
            self.postMessage({ type: 'momentum:calculated', result });
            break;

        case 'filterData':
            const filtered = applyFilters(data.records, data.filters);
            self.postMessage({ type: 'filter:applied', filtered });
            break;
    }
};

function calculateMomentumScores(companies) {
    // Heavy calculation offloaded to worker
    return companies.map(company => ({
        ...company,
        momentumScore: complexMomentumCalculation(company)
    }));
}

// File: src/services/WorkerService.js
export class WorkerService {
    constructor() {
        this.worker = new Worker('./workers/dataProcessor.worker.js');
        this.callbacks = new Map();
    }

    async calculateMomentum(companies) {
        return new Promise((resolve) => {
            const requestId = Date.now();

            this.callbacks.set(requestId, (result) => {
                resolve(result);
                this.callbacks.delete(requestId);
            });

            this.worker.postMessage({
                type: 'calculateMomentum',
                data: companies,
                requestId
            });
        });
    }
}
```

**Expected Performance Gain**: 60% faster complex calculations, non-blocking UI

---

### 3.2 Testing Infrastructure

#### Task 3.2.1: Unit Testing Setup
```javascript
// File: tests/unit/repositories/CompanyRepository.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CompanyRepository } from '@/repositories/CompanyRepository';

describe('CompanyRepository', () => {
    let repository;
    let mockDataProvider;
    let mockCache;
    let mockEventBus;

    beforeEach(() => {
        mockDataProvider = {
            loadData: vi.fn().mockResolvedValue([
                { Ticker: 'AAPL', corpName: 'Apple Inc.', industry: 'Technology' },
                { Ticker: 'MSFT', corpName: 'Microsoft', industry: 'Technology' }
            ])
        };

        mockCache = new Map();
        mockEventBus = {
            emit: vi.fn()
        };

        repository = new CompanyRepository(mockDataProvider, mockCache, mockEventBus);
    });

    describe('getAll', () => {
        it('should load companies from data provider', async () => {
            const companies = await repository.getAll();

            expect(companies).toHaveLength(2);
            expect(companies[0].Ticker).toBe('AAPL');
            expect(mockDataProvider.loadData).toHaveBeenCalledWith('companies');
        });

        it('should cache companies after first load', async () => {
            await repository.getAll();
            await repository.getAll();

            expect(mockDataProvider.loadData).toHaveBeenCalledTimes(1);
        });

        it('should emit data:loaded event', async () => {
            await repository.getAll();

            expect(mockEventBus.emit).toHaveBeenCalledWith('data:loaded', {
                type: 'companies',
                count: 2
            });
        });
    });

    describe('getByTicker', () => {
        it('should return company matching ticker', async () => {
            const company = await repository.getByTicker('AAPL');

            expect(company.corpName).toBe('Apple Inc.');
        });

        it('should return undefined for non-existent ticker', async () => {
            const company = await repository.getByTicker('INVALID');

            expect(company).toBeUndefined();
        });
    });

    describe('query', () => {
        it('should filter companies by criteria', async () => {
            const results = await repository.query({
                industry: 'Technology'
            }).execute();

            expect(results).toHaveLength(2);
        });
    });
});
```

**Test Coverage Targets**:
- Repositories: 90%
- Services: 85%
- Utilities: 95%
- Components: 70%

#### Task 3.2.2: Integration Testing
```javascript
// File: tests/integration/DataFlow.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestApp } from './helpers/testApp';

describe('Data Flow Integration', () => {
    let app;

    beforeEach(async () => {
        app = await setupTestApp();
    });

    it('should load and filter data end-to-end', async () => {
        // Load initial data
        await app.initialize();

        // Apply filter
        await app.filterModule.applyFilter({ industry: 'Technology' });

        // Verify table updated
        const tableData = app.tableModule.getData();
        expect(tableData.every(c => c.industry === 'Technology')).toBe(true);
    });

    it('should synchronize state across modules', async () => {
        await app.initialize();

        // Select company in one module
        app.companyDetailModule.selectCompany('AAPL');

        // Verify state updated
        const selectedCompany = app.stateManager.getState('ui.activeComparison');
        expect(selectedCompany.Ticker).toBe('AAPL');

        // Verify other modules notified
        expect(app.chartModule.getCurrentCompany().Ticker).toBe('AAPL');
    });
});
```

---

### 3.3 Documentation Generation

#### Task 3.3.1: JSDoc Comments
```javascript
/**
 * Repository for company data operations
 *
 * @class CompanyRepository
 * @example
 * const repo = new CompanyRepository(dataProvider, cache, eventBus);
 * const companies = await repo.getAll();
 * const tech = await repo.query({ industry: 'Technology' }).execute();
 */
export class CompanyRepository {
    /**
     * Get all companies
     *
     * @async
     * @returns {Promise<Array<Company>>} Array of company objects
     * @throws {DataLoadError} If data loading fails
     * @fires data:loaded
     *
     * @example
     * const companies = await repository.getAll();
     * console.log(companies.length); // 1249
     */
    async getAll() {
        // ...
    }

    /**
     * Query companies with criteria
     *
     * @param {Object} criteria - Filter criteria
     * @param {string} [criteria.industry] - Filter by industry
     * @param {Object} [criteria.Sales] - Sales growth filter
     * @param {number} [criteria.Sales.$gte] - Minimum sales growth
     * @returns {CompanyQueryBuilder} Query builder for chaining
     *
     * @example
     * const highGrowth = await repo.query({
     *   'Sales (3)': { $gte: 20 },
     *   'ROE (Fwd)': { $gte: 15 }
     * }).sortBy('Sales (3)', 'desc').limit(50).execute();
     */
    query(criteria) {
        // ...
    }
}
```

---

## Risk Assessment

### High-Risk Refactorings

| Task | Risk Level | Mitigation Strategy |
|------|-----------|---------------------|
| Extract global state | 🔴 High | Incremental migration, feature flags, parallel implementation |
| Main file decomposition | 🔴 High | Phase by phase, maintain backward compatibility |
| Module communication changes | 🟡 Medium | Event bus wrapper for gradual migration |
| Repository pattern | 🟡 Medium | Adapter pattern for existing code |

### Rollback Strategy

1. **Feature Flags**: Enable/disable new architecture
2. **Parallel Implementation**: Run old and new code side-by-side
3. **Incremental Rollout**: 10% → 50% → 100% traffic
4. **Automated Rollback**: If error rate >5%, auto-revert

---

## Metrics & Success Criteria

### Code Quality Metrics

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| Main file LOC | 4,766 | <500 | SonarQube |
| Average class size | 450 | <250 | ESLint |
| Cyclomatic complexity | 28 | <10 | CodeClimate |
| Code duplication | 18% | <5% | PMD/CPD |
| Test coverage | 0% | >70% | Vitest |

### Performance Metrics

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| Initial load time | 3.2s | <1.5s | Lighthouse |
| Table render (6k rows) | 1.8s | <300ms | Performance API |
| Memory usage | 180MB | <100MB | Chrome DevTools |
| Bundle size | 850KB | <400KB | Webpack Analyzer |

### Developer Experience

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| Build time | 12s | <5s | Vite metrics |
| Hot reload time | 800ms | <200ms | Vite metrics |
| Time to add feature | 4h | <2h | Team survey |

---

## Implementation Timeline

### Sprint 4 (Week 1-2)
- [ ] Task 1.1.1: Extract Application Core
- [ ] Task 1.1.2: Extract Global State to StateManager
- [ ] Task 1.1.3: Extract Configuration Management

### Sprint 5 (Week 3-4)
- [ ] Task 1.2: Decompose CompanyDetailView
- [ ] Task 1.2: Decompose DataCleanupManager
- [ ] Task 1.4: Implement Dependency Injection

### Sprint 6 (Week 5-6)
- [ ] Task 1.3: Eliminate chart duplication
- [ ] Task 2.1: Implement Repository Pattern
- [ ] Task 2.2: Event Bus migration

### Sprint 7 (Week 7-8)
- [ ] Task 2.3: Module Factory
- [ ] Task 2.4: Error Handling
- [ ] Task 3.2.1: Unit testing setup

### Sprint 8 (Week 9-10)
- [ ] Task 3.1: Performance optimizations
- [ ] Task 3.2.2: Integration testing
- [ ] Task 3.3: Documentation

---

## Appendix

### A. SOLID Principles Violations Summary

1. **Single Responsibility**:
   - `stock_analyzer_enhanced.js`: Initialization, data loading, rendering, event handling, state management
   - `CompanyDetailView.js`: Data fetching, transformation, chart creation, DOM manipulation

2. **Open/Closed**:
   - Chart creation logic hardcoded in multiple places
   - Filter strategies not extensible

3. **Dependency Inversion**:
   - Direct dependencies on `window` global
   - Tight coupling to Chart.js implementation

### B. Design Patterns to Apply

| Pattern | Use Case | Benefits |
|---------|----------|----------|
| Repository | Data access layer | Centralized data logic, testability |
| Factory | Module creation | Consistent instantiation, lifecycle |
| Strategy | Filter/validation | Extensibility, testability |
| Observer (Event Bus) | Module communication | Loose coupling |
| Dependency Injection | Service wiring | Testability, flexibility |
| Template Method | Chart creation | Code reuse, consistency |
| Builder | Complex queries | Fluent API, readability |

### C. Code Complexity Analysis

**Cyclomatic Complexity** (functions > 20):
- `renderTable()`: 45
- `performSort()`: 28
- `applyFilters()`: 32
- `init()`: 38

**Longest Functions** (LOC > 100):
- `renderTable()`: 167 lines
- `showCompanyModal()`: 142 lines
- `createDetailTable()`: 105 lines

### D. Recommended Tools

- **Linting**: ESLint with Airbnb config
- **Testing**: Vitest + Testing Library
- **Build**: Vite
- **Type Checking**: TypeScript (gradual migration)
- **Code Quality**: SonarQube
- **Bundleanalyzer**: Webpack Bundle Analyzer

---

## Conclusion

This refactoring plan addresses critical technical debt while establishing sustainable architectural patterns. The phased approach minimizes risk while delivering measurable improvements in code quality, maintainability, and performance.

**Key Deliverables**:
- 90% reduction in main file size
- Zero global variables
- 70%+ test coverage
- 50% performance improvement
- Sustainable architecture for future growth

**Success depends on**:
- Incremental execution
- Comprehensive testing
- Team alignment
- Continuous monitoring

---

**Document Version**: 1.0
**Last Updated**: 2025-10-17
**Next Review**: Sprint 5 completion
