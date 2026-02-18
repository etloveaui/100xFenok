# Stock Analyzer Enhanced - API Specification

**Document Version**: 1.0
**Date**: 2025-10-17
**Related**: ARCHITECTURE_BLUEPRINT.md
**Status**: Phase 1 API Design

---

## Table of Contents

1. [Chart Lifecycle Management APIs](#1-chart-lifecycle-management-apis)
2. [Data Validation APIs](#2-data-validation-apis)
3. [Correction Engine APIs](#3-correction-engine-apis)
4. [Field Schema Definition](#4-field-schema-definition)
5. [Data Structures](#5-data-structures)
6. [Error Codes](#6-error-codes)

---

## 1. Chart Lifecycle Management APIs

### 1.1 ChartLifecycleManager

**File**: `modules/EconomicDashboard/ChartLifecycleManager.js`

```javascript
class ChartLifecycleManager {
    /**
     * Constructor
     * @param {Object} config - Configuration options
     * @param {EventSystem} config.eventSystem - Event system instance
     */
    constructor(config)

    /**
     * Register a chart component with the lifecycle manager
     * @param {string} name - Unique chart identifier (e.g., 'tedSpread')
     * @param {Object} component - Chart component instance
     * @param {string} tabName - Parent tab name (e.g., 'dashboard')
     * @returns {boolean} - Registration success
     * @throws {Error} - If chart with same name already registered
     */
    registerChart(name, component, tabName): boolean

    /**
     * Handle tab visibility change event
     * @param {string} tabName - Tab that became visible
     * @returns {Promise<void>}
     * @emits chart:tab:visible
     */
    async onTabVisible(tabName): Promise<void>

    /**
     * Ensure chart is initialized (lazy initialization)
     * @param {string} chartName - Chart identifier
     * @returns {Promise<boolean>} - True if initialized, false if failed
     * @emits chart:init:start
     * @emits chart:init:success
     * @emits chart:init:failed
     */
    async ensureInitialized(chartName): Promise<boolean>

    /**
     * Check if chart is initialized
     * @param {string} chartName - Chart identifier
     * @returns {boolean} - Initialization status
     */
    isInitialized(chartName): boolean

    /**
     * Resize all visible charts
     * @returns {void}
     * @emits chart:resize:start
     * @emits chart:resize:complete
     */
    resizeVisibleCharts(): void

    /**
     * Get chart state
     * @param {string} chartName - Chart identifier
     * @returns {ChartState|null} - Chart state object or null if not found
     */
    getChartState(chartName): ChartState | null

    /**
     * Get all charts in a tab
     * @param {string} tabName - Tab identifier
     * @returns {string[]} - Array of chart names
     */
    getChartsInTab(tabName): string[]

    /**
     * Mark chart as visible
     * @param {string} chartName - Chart identifier
     * @returns {boolean} - Success status
     */
    setChartVisible(chartName): boolean

    /**
     * Mark chart as hidden
     * @param {string} chartName - Chart identifier
     * @returns {boolean} - Success status
     */
    setChartHidden(chartName): boolean

    /**
     * Destroy chart and clean up resources
     * @param {string} chartName - Chart identifier
     * @returns {boolean} - Success status
     */
    destroyChart(chartName): boolean

    /**
     * Get all registered charts
     * @returns {Map<string, ChartState>} - Chart states map
     */
    getAllCharts(): Map<string, ChartState>

    /**
     * Reset all charts to created state
     * @returns {void}
     */
    resetAllCharts(): void
}
```

### 1.2 Chart Component Interface

All chart components must implement this interface:

```javascript
interface ChartComponent {
    /**
     * Component name (unique identifier)
     * @type {string}
     */
    name: string

    /**
     * Canvas element ID
     * @type {string}
     */
    canvasId: string

    /**
     * Initialization status
     * @type {boolean}
     */
    isInitialized: boolean

    /**
     * Chart.js instance
     * @type {Chart|null}
     */
    chart: Chart | null

    /**
     * Initialize chart (lazy initialization)
     * @returns {Promise<boolean>} - True if successful
     * @throws {Error} - If canvas not found or Chart.js fails
     */
    initChart(): Promise<boolean>

    /**
     * Render component DOM structure
     * @returns {HTMLElement} - Container element
     */
    render(): HTMLElement

    /**
     * Update chart data
     * @param {any} data - New data for chart
     * @returns {void}
     */
    updateData(data: any): void

    /**
     * Resize chart to fit container
     * @returns {void}
     */
    resize(): void

    /**
     * Destroy chart and clean up resources
     * @returns {void}
     */
    destroy(): void

    /**
     * Get chart configuration
     * @returns {Object} - Chart.js configuration object
     */
    getChartConfig(): Object
}
```

### 1.3 EconomicDashboard Extensions

**File**: `modules/EconomicDashboard/EconomicDashboard.js`

New/modified methods:

```javascript
class EconomicDashboard {
    /**
     * Initialize lifecycle manager
     * @private
     * @returns {void}
     */
    initializeLifecycleManager(): void

    /**
     * Ensure all charts are initialized
     * @param {boolean} force - Force re-initialization
     * @returns {Promise<void>}
     */
    async ensureInitialized(force = false): Promise<void>

    /**
     * Handle window resize event
     * @returns {void}
     */
    handleResize(): void

    /**
     * Get lifecycle manager instance
     * @returns {ChartLifecycleManager}
     */
    getLifecycleManager(): ChartLifecycleManager
}
```

---

## 2. Data Validation APIs

### 2.1 DataValidator

**File**: `modules/validation/DataValidator.js`

```javascript
class DataValidator {
    /**
     * Constructor
     * @param {Object} schema - Field schema definition (FIELD_SCHEMA)
     */
    constructor(schema)

    /**
     * Validate entire dataset
     * @param {Array<Object>} data - Array of company objects
     * @returns {ValidationReport} - Comprehensive validation report
     */
    validateDataset(data): ValidationReport

    /**
     * Validate single company
     * @param {Object} company - Company data object
     * @param {number} index - Array index (for reference)
     * @returns {CompanyValidationResult} - Validation result for company
     */
    validateCompany(company, index): CompanyValidationResult

    /**
     * Validate single field
     * @param {string} fieldName - Field identifier
     * @param {any} value - Field value
     * @param {FieldDefinition} fieldDef - Field schema definition
     * @returns {FieldIssue|null} - Issue object or null if valid
     */
    validateField(fieldName, value, fieldDef): FieldIssue | null

    /**
     * Validate field type
     * @param {string} fieldName - Field identifier
     * @param {any} value - Field value
     * @param {FieldDefinition} fieldDef - Field schema definition
     * @returns {FieldIssue|null} - Type issue or null
     */
    validateType(fieldName, value, fieldDef): FieldIssue | null

    /**
     * Validate field range
     * @param {string} fieldName - Field identifier
     * @param {any} value - Field value
     * @param {FieldDefinition} fieldDef - Field schema definition
     * @returns {FieldIssue|null} - Range issue or null
     */
    validateRange(fieldName, value, fieldDef): FieldIssue | null

    /**
     * Validate field format (critical for percentage issues)
     * @param {string} fieldName - Field identifier
     * @param {any} value - Field value
     * @param {FieldDefinition} fieldDef - Field schema definition
     * @returns {FieldIssue|null} - Format issue or null
     */
    validateFormat(fieldName, value, fieldDef): FieldIssue | null

    /**
     * Generate comprehensive validation report
     * @param {ValidationReport} validationResult - Raw validation result
     * @returns {EnhancedValidationReport} - Report with coverage analysis
     */
    generateReport(validationResult): EnhancedValidationReport

    /**
     * Calculate field coverage statistics
     * @param {ValidationReport} validationResult - Validation result
     * @returns {Object} - Field coverage details
     */
    calculateFieldCoverage(validationResult): Object

    /**
     * Get schema definition
     * @returns {Object} - Field schema
     */
    getSchema(): Object

    /**
     * Add custom field validator
     * @param {string} fieldName - Field identifier
     * @param {Function} validator - Validation function
     * @returns {void}
     */
    addFieldValidator(fieldName, validator): void
}
```

---

## 3. Correction Engine APIs

### 3.1 CorrectionEngine

**File**: `modules/validation/CorrectionEngine.js`

```javascript
class CorrectionEngine {
    /**
     * Constructor
     * @param {DataValidator} validator - Validator instance
     */
    constructor(validator)

    /**
     * Auto-correct format issues
     * @param {Array<Object>} data - Dataset to correct
     * @param {Array<FormatIssue>} formatIssues - Issues to correct
     * @param {boolean} dryRun - Preview mode (default: true)
     * @returns {Array<Correction>} - Applied corrections
     */
    correctFormatIssues(data, formatIssues, dryRun = true): Array<Correction>

    /**
     * Get correction preview
     * @returns {CorrectionPreview} - Preview data
     */
    getPreview(): CorrectionPreview

    /**
     * Apply corrections with user confirmation
     * @param {Array<Object>} data - Dataset to correct
     * @param {Array<FormatIssue>} formatIssues - Issues to correct
     * @returns {Promise<CorrectionResult>} - Correction result
     */
    async applyWithConfirmation(data, formatIssues): Promise<CorrectionResult>

    /**
     * Show confirmation modal to user
     * @param {CorrectionPreview} preview - Preview data
     * @returns {Promise<boolean>} - True if user approved
     */
    async showConfirmationModal(preview): Promise<boolean>

    /**
     * Group corrections by field
     * @returns {Object} - Grouped corrections
     */
    groupCorrectionsByField(): Object

    /**
     * Rollback applied corrections
     * @param {Array<Object>} data - Dataset to rollback
     * @returns {number} - Number of corrections rolled back
     */
    rollback(data): number

    /**
     * Get correction history
     * @returns {Array<Correction>} - All corrections made
     */
    getCorrectionHistory(): Array<Correction>

    /**
     * Clear correction history
     * @returns {void}
     */
    clearHistory(): void

    /**
     * Export corrections as JSON
     * @returns {string} - JSON string of corrections
     */
    exportCorrections(): string

    /**
     * Import corrections from JSON
     * @param {string} json - JSON string
     * @returns {boolean} - Import success
     */
    importCorrections(json): boolean
}
```

---

## 4. Field Schema Definition

### 4.1 FIELD_SCHEMA Constant

**File**: `modules/validation/FieldSchema.js`

```javascript
/**
 * Complete field schema for Stock Analyzer (39 fields)
 * @constant
 * @type {Object}
 */
const FIELD_SCHEMA = {
    [fieldName: string]: FieldDefinition
}

/**
 * Field definition structure
 * @typedef {Object} FieldDefinition
 * @property {string} type - Field type ('string'|'number'|'percentage'|'currency')
 * @property {boolean} required - Required field flag
 * @property {string} format - Format type ('decimal'|'integer')
 * @property {number} [min] - Minimum value (for numeric types)
 * @property {number} [max] - Maximum value (for numeric types)
 * @property {number} [decimalPlaces] - Decimal precision
 * @property {number} [minLength] - Minimum string length
 * @property {number} [maxLength] - Maximum string length
 * @property {RegExp} [pattern] - Validation regex pattern
 * @property {Array<string>} [enum] - Allowed values
 * @property {string} category - Field category for grouping
 */

/**
 * Get field definition
 * @param {string} fieldName - Field identifier
 * @returns {FieldDefinition|null} - Field definition or null
 */
function getFieldDefinition(fieldName): FieldDefinition | null

/**
 * Get all fields in category
 * @param {string} category - Category identifier
 * @returns {Array<string>} - Field names
 */
function getFieldsByCategory(category): Array<string>

/**
 * Get required fields
 * @returns {Array<string>} - Required field names
 */
function getRequiredFields(): Array<string>

/**
 * Validate schema integrity
 * @returns {boolean} - True if schema is valid
 * @throws {Error} - If schema has errors
 */
function validateSchema(): boolean
```

---

## 5. Data Structures

### 5.1 Chart Lifecycle Data Structures

```typescript
/**
 * Chart state object
 */
interface ChartState {
    component: ChartComponent;
    state: 'created' | 'rendered' | 'initialized' | 'visible' | 'hidden' | 'destroyed';
    isVisible: boolean;
    isInitialized: boolean;
    tabName: string;
    lastUpdated: Date;
    errorCount: number;
    lastError?: Error;
}

/**
 * Lifecycle event payload
 */
interface LifecycleEvent {
    chartName: string;
    previousState: string;
    newState: string;
    timestamp: Date;
    metadata?: any;
}
```

### 5.2 Validation Data Structures

```typescript
/**
 * Validation report
 */
interface ValidationReport {
    timestamp: string;
    totalCompanies: number;
    totalFields: number;
    validationResults: Array<CompanyValidationResult>;
    formatIssues: Array<FormatIssue>;
    summary: ValidationSummary;
}

/**
 * Company validation result
 */
interface CompanyValidationResult {
    index: number;
    ticker: string;
    isValid: boolean;
    issues: Array<FieldIssue>;
}

/**
 * Field issue object
 */
interface FieldIssue {
    field: string;
    type: 'required' | 'type' | 'range' | 'format';
    value: any;
    expected?: any;
    message: string;
    suggestedCorrection?: any;
}

/**
 * Validation summary
 */
interface ValidationSummary {
    validCompanies: number;
    invalidCompanies: number;
    fieldCoverage: string;
    issuesByType: {
        required: number;
        type: number;
        range: number;
        format: number;
    };
}

/**
 * Enhanced validation report
 */
interface EnhancedValidationReport extends ValidationReport {
    generatedAt: string;
    fieldCoverageDetails: Object;
}

/**
 * Format issue
 */
interface FormatIssue {
    company: string;
    field: string;
    currentValue: any;
    expectedFormat: string;
    suggestedCorrection: any;
}
```

### 5.3 Correction Data Structures

```typescript
/**
 * Correction object
 */
interface Correction {
    company: string;
    field: string;
    before: any;
    after: any;
    applied: boolean;
    timestamp?: Date;
}

/**
 * Correction preview
 */
interface CorrectionPreview {
    totalCorrections: number;
    byField: Object;
    sampleCorrections: Array<Correction>;
}

/**
 * Correction result
 */
interface CorrectionResult {
    success: boolean;
    corrections: Array<Correction>;
    errors?: Array<Error>;
}
```

---

## 6. Error Codes

### 6.1 Chart Lifecycle Error Codes

```javascript
const CHART_ERROR_CODES = {
    // Initialization errors (1000-1099)
    CANVAS_NOT_FOUND: {
        code: 1001,
        message: 'Canvas element not found',
        severity: 'error'
    },
    CHARTJS_INIT_FAILED: {
        code: 1002,
        message: 'Chart.js initialization failed',
        severity: 'error'
    },
    INVALID_CHART_CONFIG: {
        code: 1003,
        message: 'Invalid chart configuration',
        severity: 'error'
    },
    CHART_ALREADY_INITIALIZED: {
        code: 1004,
        message: 'Chart already initialized',
        severity: 'warning'
    },

    // Registration errors (1100-1199)
    DUPLICATE_CHART_NAME: {
        code: 1101,
        message: 'Chart with same name already registered',
        severity: 'error'
    },
    INVALID_COMPONENT: {
        code: 1102,
        message: 'Invalid chart component',
        severity: 'error'
    },

    // Lifecycle errors (1200-1299)
    CHART_NOT_REGISTERED: {
        code: 1201,
        message: 'Chart not registered with lifecycle manager',
        severity: 'error'
    },
    STATE_TRANSITION_INVALID: {
        code: 1202,
        message: 'Invalid state transition',
        severity: 'warning'
    }
};
```

### 6.2 Validation Error Codes

```javascript
const VALIDATION_ERROR_CODES = {
    // Field validation errors (2000-2099)
    REQUIRED_FIELD_MISSING: {
        code: 2001,
        message: 'Required field missing',
        severity: 'error'
    },
    INVALID_TYPE: {
        code: 2002,
        message: 'Invalid field type',
        severity: 'error'
    },
    OUT_OF_RANGE: {
        code: 2003,
        message: 'Value out of valid range',
        severity: 'error'
    },
    FORMAT_MISMATCH: {
        code: 2004,
        message: 'Field format mismatch',
        severity: 'warning'
    },

    // Schema errors (2100-2199)
    SCHEMA_INVALID: {
        code: 2101,
        message: 'Schema definition invalid',
        severity: 'error'
    },
    FIELD_NOT_IN_SCHEMA: {
        code: 2102,
        message: 'Field not defined in schema',
        severity: 'warning'
    },

    // Dataset errors (2200-2299)
    EMPTY_DATASET: {
        code: 2201,
        message: 'Dataset is empty',
        severity: 'error'
    },
    INVALID_DATASET_FORMAT: {
        code: 2202,
        message: 'Dataset format invalid',
        severity: 'error'
    }
};
```

### 6.3 Correction Error Codes

```javascript
const CORRECTION_ERROR_CODES = {
    // Correction errors (3000-3099)
    CORRECTION_FAILED: {
        code: 3001,
        message: 'Correction operation failed',
        severity: 'error'
    },
    USER_CANCELLED: {
        code: 3002,
        message: 'User cancelled correction',
        severity: 'info'
    },
    ROLLBACK_FAILED: {
        code: 3003,
        message: 'Rollback operation failed',
        severity: 'error'
    },
    NO_CORRECTIONS_APPLIED: {
        code: 3004,
        message: 'No corrections were applied',
        severity: 'warning'
    }
};
```

---

## 7. Event System Integration

### 7.1 Chart Lifecycle Events

```javascript
// Emitted when tab becomes visible
eventSystem.emit('chart:tab:visible', {
    tabName: string,
    chartNames: Array<string>
});

// Emitted when chart initialization starts
eventSystem.emit('chart:init:start', {
    chartName: string,
    timestamp: Date
});

// Emitted when chart initialization succeeds
eventSystem.emit('chart:init:success', {
    chartName: string,
    duration: number
});

// Emitted when chart initialization fails
eventSystem.emit('chart:init:failed', {
    chartName: string,
    error: Error,
    errorCode: number
});

// Emitted when charts are being resized
eventSystem.emit('chart:resize:start', {
    chartCount: number
});

// Emitted when chart resize completes
eventSystem.emit('chart:resize:complete', {
    chartCount: number,
    duration: number
});
```

### 7.2 Validation Events

```javascript
// Emitted when validation starts
eventSystem.emit('validation:start', {
    datasetSize: number,
    fieldCount: number
});

// Emitted when validation completes
eventSystem.emit('validation:complete', {
    report: ValidationReport,
    duration: number
});

// Emitted when format issues are detected
eventSystem.emit('validation:format:issues', {
    issueCount: number,
    issues: Array<FormatIssue>
});
```

### 7.3 Correction Events

```javascript
// Emitted when correction preview is shown
eventSystem.emit('correction:preview:shown', {
    correctionCount: number,
    preview: CorrectionPreview
});

// Emitted when user approves corrections
eventSystem.emit('correction:approved', {
    correctionCount: number
});

// Emitted when corrections are applied
eventSystem.emit('correction:applied', {
    successCount: number,
    failCount: number
});

// Emitted when rollback is triggered
eventSystem.emit('correction:rollback', {
    rollbackCount: number
});
```

---

## 8. Usage Examples

### 8.1 Chart Lifecycle Usage

```javascript
// Initialize lifecycle manager
const lifecycleManager = new ChartLifecycleManager({
    eventSystem: window.eventSystem
});

// Register charts
lifecycleManager.registerChart('tedSpread', tedSpreadComponent, 'dashboard');
lifecycleManager.registerChart('heatmap', heatmapComponent, 'dashboard');

// Handle tab switch
document.getElementById('tab-dashboard').addEventListener('click', () => {
    lifecycleManager.onTabVisible('dashboard');
});

// Resize on window resize
window.addEventListener('resize', () => {
    lifecycleManager.resizeVisibleCharts();
});
```

### 8.2 Data Validation Usage

```javascript
// Load and validate data
async function loadData() {
    const rawData = await fetch('./data/Stock_Oct-25_sorted.json').then(r => r.json());

    // Validate
    const validator = new DataValidator(FIELD_SCHEMA);
    const report = validator.validateDataset(rawData);

    console.log(`Validation: ${report.summary.validCompanies}/${rawData.length} valid`);
    console.log(`Format issues: ${report.formatIssues.length}`);

    // Handle format issues
    if (report.formatIssues.length > 0) {
        const correctionEngine = new CorrectionEngine(validator);
        const result = await correctionEngine.applyWithConfirmation(rawData, report.formatIssues);

        if (result.success) {
            console.log(`Applied ${result.corrections.length} corrections`);
        }
    }

    // Generate final report
    const finalReport = validator.generateReport(report);
    console.table(finalReport.fieldCoverageDetails);

    return rawData;
}
```

### 8.3 Manual Correction Usage

```javascript
// Dry-run corrections
const correctionEngine = new CorrectionEngine(validator);
const corrections = correctionEngine.correctFormatIssues(data, issues, true);

// Preview corrections
const preview = correctionEngine.getPreview();
console.table(preview.sampleCorrections);

// Apply corrections manually
correctionEngine.correctFormatIssues(data, issues, false);

// Rollback if needed
correctionEngine.rollback(data);
```

---

## 9. Backward Compatibility

All new APIs are additive and do not break existing functionality:

- **EconomicDashboard**: `lifecycleManager` is optional, falls back to immediate initialization
- **DataValidator**: Can be used alongside existing `DataCleanupManager`
- **CorrectionEngine**: Optional feature, does not interfere with manual data fixes

Existing code continues to work without modification.

---

## Conclusion

This API specification provides complete method signatures, data structures, error codes, and usage examples for the Stock Analyzer Enhanced architecture. All APIs are designed for:

- Type safety (TypeScript-compatible)
- Predictable behavior
- Error handling
- Event-driven communication
- Backward compatibility

**Next Document**: `IMPLEMENTATION_STRATEGY.md` for Sprint 1/2 execution plan.
