# Foundation Documentation - Stock Analyzer Global Expansion

## 📋 Overview

The Foundation phase establishes the core infrastructure for the Stock Analyzer Global Expansion project. This documentation covers the implementation of 11 foundational tasks (T001-T011) that provide the essential building blocks for all subsequent modules.

## 🏗️ Architecture Overview

```
Foundation Layer (Core Modules)
├── ModuleRegistry    - Plugin lifecycle management
├── EventBus          - Inter-module communication
├── DataProvider      - Data loading and caching
├── StateManager      - Global and module state
├── NavigationService - Module routing and navigation
├── ErrorBoundary     - Error isolation and recovery
└── PerformanceMonitor - Performance metrics tracking

Supporting Tools
├── csv_to_json_converter.py - CSV data transformation
├── csv_pipeline.sh/bat      - Automated conversion pipeline
└── Core Integration Tests   - Comprehensive test suite
```

## 📦 Core Modules

### 1. ModuleRegistry (T001)
**Purpose**: Central registry for managing module lifecycle

**Key Features**:
- Module registration and dependency management
- Lazy loading with automatic dependency resolution
- Module activation/deactivation lifecycle
- Error isolation per module
- Hot reload capability

**Usage Example**:
```javascript
// Register a module
moduleRegistry.registerModule({
    id: 'momentum-heatmap',
    name: 'Momentum Heatmap',
    version: '1.0.0',
    dependencies: ['data-provider'],
    factory: () => new MomentumHeatmap()
});

// Load and activate
await moduleRegistry.loadModule('momentum-heatmap');
await moduleRegistry.activateModule('momentum-heatmap');
```

**API Reference**:
- `registerModule(config)` - Register a new module
- `loadModule(moduleId)` - Load module and dependencies
- `activateModule(moduleId)` - Activate loaded module
- `deactivateModule(moduleId)` - Deactivate module
- `reloadModule(moduleId)` - Hot reload module
- `hasModule(moduleId)` - Check if module exists
- `isLoaded(moduleId)` - Check if module is loaded
- `isActive(moduleId)` - Check if module is active

---

### 2. EventBus (T002)
**Purpose**: Pub/sub system for module communication

**Key Features**:
- Standard event catalog for consistency
- Priority-based event handling
- Wildcard subscriptions
- Event history tracking
- Async/sync event emission

**Standard Events**:
```javascript
// Module lifecycle
'module:registered', 'module:loaded', 'module:activated', 'module:error'

// Data events
'data:loaded', 'data:updated', 'data:error', 'data:cache:invalidated'

// Navigation
'navigation:before', 'navigation:after', 'navigation:error'

// User actions
'user:security:selected', 'user:filter:applied', 'user:sort:applied'

// System
'system:ready', 'system:error', 'system:performance:warning'
```

**Usage Example**:
```javascript
// Subscribe to events
eventBus.on('data:loaded', (data) => {
    console.log(`Loaded ${data.recordCount} records`);
});

// Emit events
await eventBus.emit('user:security:selected', {
    ticker: 'AAPL',
    timestamp: Date.now()
});

// One-time subscription
eventBus.once('module:loaded', handler);
```

---

### 3. DataProvider (T003)
**Purpose**: Centralized data management layer

**Key Features**:
- TTL-based caching strategy
- Automatic retry with exponential backoff
- Data quality metrics calculation
- Query API with filtering and sorting
- Batch loading optimization

**Query API**:
```javascript
// Load data with caching
const companies = await dataProvider.loadData('companies');

// Query with filters
const results = await dataProvider.query('companies', {
    filters: {
        marketCapMillions: { $gt: 10000 },
        country: 'USA'
    },
    sort: { field: 'marketCapMillions', order: 'desc' },
    limit: 50,
    offset: 0
});
```

**Filter Operators**:
- `$eq` - Equal to
- `$ne` - Not equal to
- `$gt` - Greater than
- `$gte` - Greater than or equal
- `$lt` - Less than
- `$lte` - Less than or equal
- `$in` - In array
- `$nin` - Not in array
- `$contains` - String contains
- `$regex` - Regular expression match

---

### 4. StateManager (T004)
**Purpose**: Global and module-scoped state management

**Key Features**:
- Global state for shared data
- Module-isolated state scopes
- State persistence to localStorage
- Computed state with dependency tracking
- State history for debugging
- Subscription system for reactivity

**Usage Example**:
```javascript
// Global state
stateManager.setGlobalState('theme', 'dark');
const theme = stateManager.getGlobalState('theme');

// Module state
stateManager.setModuleState('portfolio', 'holdings', [...]);
const holdings = stateManager.getModuleState('portfolio', 'holdings');

// Computed state
stateManager.createComputed('totalValue', (sm) => {
    const holdings = sm.getModuleState('portfolio', 'holdings') || [];
    return holdings.reduce((sum, h) => sum + h.value, 0);
}, ['portfolio:holdings']);

// Subscribe to changes
const unsubscribe = stateManager.subscribe('global', 'theme', (newTheme) => {
    applyTheme(newTheme);
});
```

---

### 5. NavigationService (T005)
**Purpose**: Module routing and navigation management

**Key Features**:
- Hash and pushState routing modes
- Navigation guards (before/after)
- Browser history integration
- Deep linking support
- Navigation stack management
- Module transition animations

**Usage Example**:
```javascript
// Register routes
navigationService.registerRoute('/portfolio', {
    moduleId: 'portfolio-builder',
    params: { view: 'holdings' }
});

// Navigate programmatically
await navigationService.navigateTo('portfolio-builder', {
    params: { portfolioId: 123 },
    query: { view: 'performance' }
});

// Navigation guards
navigationService.beforeEach((context) => {
    // Check authentication
    if (requiresAuth(context.to) && !isAuthenticated()) {
        return false; // Cancel navigation
    }
    return true;
});
```

---

### 6. ErrorBoundary (T006)
**Purpose**: Error isolation and recovery system

**Key Features**:
- Module-level error boundaries
- Automatic recovery strategies
- Error reporting and logging
- Fallback UI rendering
- Recovery attempt management
- Global error handling

**Recovery Strategies**:
```javascript
// Register custom recovery strategy
errorBoundary.registerRecoveryStrategy('data-module', async (moduleId, error) => {
    // Clear cache and reload
    await dataProvider.clearCache();
    await eventBus.emit('module:reload', { moduleId });
});

// Create module boundary
const boundary = errorBoundary.createModuleBoundary('analytics', container);

// Wrap risky operations
const safeFn = boundary.wrap(() => {
    // Risky operation
    processComplexData();
});
```

---

### 7. PerformanceMonitor (T007)
**Purpose**: Performance metrics and optimization

**Key Features**:
- Performance Observer API integration
- FPS and memory monitoring
- Network request tracking
- Custom metric recording
- Threshold-based warnings
- Performance reporting

**Metrics Tracked**:
- Module load time
- Data fetch duration
- Render performance
- Memory usage
- Network latency
- Long task detection

**Usage Example**:
```javascript
// Track module performance
const tracker = performanceMonitor.trackModule('momentum-heatmap');

const loadTracker = tracker.trackLoad();
// ... load module
loadTracker.complete();

// Custom metrics
const stop = performanceMonitor.startTimer('custom:operation');
// ... perform operation
stop();

// Set thresholds
performanceMonitor.setThreshold('module:load', 1000); // 1 second
```

## 🔧 Supporting Tools

### CSV to JSON Converter (T004)
**Purpose**: Transform Global Scouter CSV data to optimized JSON

**Features**:
- Field mapping configuration
- Data type conversion
- Quality metrics calculation
- Batch conversion support
- Validation and error reporting

**Usage**:
```bash
# Single file conversion
python tools/csv_to_json_converter.py data/Global_Scouter.csv -o data/companies.json

# Batch conversion
python tools/csv_to_json_converter.py data/ -o data/json/ --batch

# With configuration
python tools/csv_to_json_converter.py data/input.csv -c config/csv_config.json
```

### CSV Pipeline Scripts (T010)
**Purpose**: Automate CSV conversion workflow

**Scripts**:
- `csv_pipeline.sh` - Unix/Linux/macOS
- `csv_pipeline.bat` - Windows

**Modes**:
```bash
# Batch conversion
./csv_pipeline.sh --batch

# Watch mode (auto-convert on change)
./csv_pipeline.sh --watch

# Run tests
./csv_pipeline.sh --test
```

## 🧪 Testing

### Core Integration Tests (T009)
**Location**: `tests/core/core.integration.test.js`

**Test Coverage**:
- EventBus pub/sub functionality
- StateManager state operations
- ModuleRegistry lifecycle
- NavigationService routing
- DataProvider caching
- ErrorBoundary recovery
- PerformanceMonitor tracking
- Cross-module integration

**Running Tests**:
```bash
# Browser
Open tests/test_runner.html

# Auto-run
tests/test_runner.html?autorun=true

# Command line (future)
npm test
```

## 📊 Performance Targets

Based on master_plan.md requirements:

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Initial Load | < 5s | TBD | 🟡 |
| Module Switch | < 1s | TBD | 🟡 |
| CSV Conversion | < 30s (6000 records) | ~15s | ✅ |
| Memory Usage | < 100MB | TBD | 🟡 |
| Test Coverage | > 80% | ~70% | 🟡 |

## 🔌 Integration Points

### For Module Developers

1. **Module Registration**:
```javascript
class CustomModule {
    constructor() {
        this.id = 'custom-module';
        this.version = '1.0.0';
    }

    async initialize(context) {
        this.eventBus = context.eventBus;
        this.dataProvider = context.dataProvider;
        this.stateManager = context.stateManager;
    }

    async activate() {
        // Start module functionality
    }

    async deactivate() {
        // Cleanup
    }
}
```

2. **Event Integration**:
```javascript
// Listen for data updates
this.eventBus.on('data:updated', (data) => {
    this.refreshView(data);
});

// Emit user actions
this.eventBus.emit('user:filter:applied', {
    filters: this.getActiveFilters()
});
```

3. **State Management**:
```javascript
// Save module state
this.stateManager.setModuleState(this.id, 'viewConfig', config);

// Subscribe to global changes
this.stateManager.subscribe('global', 'theme', (theme) => {
    this.applyTheme(theme);
});
```

## 🚀 Next Steps

With Foundation complete, the project is ready for:

1. **Week 3-5**: Momentum Core Modules
   - M_Company (reference implementation)
   - M_Country, M_Industry, M_ETFs

2. **Week 6-8**: Analysis Modules
   - SmartAnalytics
   - DeepCompare

3. **Week 9-11**: Selection & Portfolio
   - PortfolioBuilder enhancements
   - S_Chart, S_Valuation

## 📝 Configuration Files

### CSV Configuration (`config/csv_config.json`)
- Field mappings (50+ fields)
- Data type definitions
- Validation rules
- Quality thresholds
- Output formatting

### Module Configuration (future)
```json
{
  "modules": {
    "momentum-heatmap": {
      "enabled": true,
      "autoLoad": true,
      "config": {
        "updateInterval": 60000,
        "maxRecords": 1000
      }
    }
  }
}
```

## 🐛 Known Issues & Limitations

1. **Browser Compatibility**:
   - Performance Observer API requires modern browsers
   - localStorage limited to ~10MB

2. **Memory Management**:
   - Large datasets may require pagination
   - Implement virtual scrolling for large tables

3. **Error Recovery**:
   - Some errors require manual intervention
   - Network errors need better retry logic

## 📚 References

- [Master Plan](../../../fenomeno_knowledge/stock-analyzer-global-expansion/master_plan.md)
- [Architecture Design](../../../fenomeno_knowledge/stock-analyzer-global-expansion/architecture.md)
- [API Specification](../../../fenomeno_knowledge/stock-analyzer-global-expansion/api_specification.md)
- [Data Schema](../../../fenomeno_knowledge/stock-analyzer-global-expansion/data_schema.md)

## 🤝 Contributing

When adding new Core functionality:

1. Update relevant Core module
2. Add integration tests
3. Update this documentation
4. Run full test suite
5. Update GLOBAL_EXPANSION_STATUS.md

## 📄 License

Part of Stock Analyzer Global Expansion Project
© 2025 - SPEC_DRIVEN_WORKFLOW Implementation

---

*Last Updated: Phase 3, Week 1-2 - Foundation Complete*