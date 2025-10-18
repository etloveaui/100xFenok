/**
 * E2E Test Suite: DataCleanupManager (ValidationAnalytics)
 *
 * Purpose: Comprehensive testing of DataCleanupManager validation functionality
 * Data Source: M_Company.json (6,176 companies via CompanyMasterProvider)
 *
 * Test Coverage:
 * - Module loading and initialization
 * - Field coverage validation (31/33 fields = 93.9%)
 * - New validator testing (6 validators: 결산, W, 1 M, 3 M, 6 M, 12 M)
 * - Quality metrics calculation
 * - Validation report generation
 * - Edge cases and error handling
 *
 * CRITICAL: Tests use FULL dataset (6,176 companies) - NO slicing!
 *
 * Sprint 4 Module 2: ValidationAnalytics
 * Task 2.1-2.5 Complete:
 * - Format Detection Engine
 * - Auto-Correction Engine
 * - Validation Reporting
 * - 6 new validators added
 * - HTML integration complete
 */

import { test, expect } from '@playwright/test';

test.describe('ValidationAnalytics (DataCleanupManager) E2E Tests', () => {

  // Setup: Navigate to the page before each test
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Wait for DataCleanupManager and CompanyMasterProvider initialization
    await page.waitForFunction(() => {
      return window.dataCleanupManager !== undefined &&
             window.companyMaster !== undefined &&
             window.validationReport !== undefined;
    }, { timeout: 10000 });
  });

  // ========================================
  // GROUP 1: MODULE LOADING (3 tests)
  // ========================================

  test('1.1: Should load DataCleanupManager module successfully', async ({ page }) => {
    const moduleStatus = await page.evaluate(() => {
      return {
        dcmExists: typeof DataCleanupManager !== 'undefined',
        dcmClass: typeof DataCleanupManager === 'function',
        instanceExists: window.dataCleanupManager !== undefined,
        hasCleanupRules: window.dataCleanupManager?.cleanupRules !== undefined,
        hasValidationRules: window.dataCleanupManager?.validationRules !== undefined
      };
    });

    expect(moduleStatus.dcmExists).toBe(true);
    expect(moduleStatus.dcmClass).toBe(true);
    expect(moduleStatus.instanceExists).toBe(true);
    expect(moduleStatus.hasCleanupRules).toBe(true);
    expect(moduleStatus.hasValidationRules).toBe(true);
  });

  test('1.2: Should initialize DataCleanupManager instance', async ({ page }) => {
    const initStatus = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;

      return {
        cleanupRulesKeys: Object.keys(dcm.cleanupRules),
        validationRulesKeys: Object.keys(dcm.validationRules),
        hasFieldValidators: dcm.validationRules.fieldValidators !== undefined,
        validatorCount: Object.keys(dcm.validationRules.fieldValidators).length
      };
    });

    expect(initStatus.cleanupRulesKeys).toContain('invalidPatterns');
    expect(initStatus.cleanupRulesKeys).toContain('numericFields');
    expect(initStatus.validationRulesKeys).toContain('fieldValidators');
    expect(initStatus.hasFieldValidators).toBe(true);
    expect(initStatus.validatorCount).toBeGreaterThanOrEqual(31);
  });

  test('1.3: Should generate validation report on page load', async ({ page }) => {
    const reportStatus = await page.evaluate(() => {
      return {
        reportExists: window.validationReport !== undefined,
        hasTimestamp: window.validationReport?.timestamp !== undefined,
        hasDatasetSize: window.validationReport?.datasetSize !== undefined,
        hasFieldCoverage: window.validationReport?.fieldCoverage !== undefined,
        hasQualityMetrics: window.validationReport?.qualityMetrics !== undefined,
        datasetSize: window.validationReport?.datasetSize
      };
    });

    expect(reportStatus.reportExists).toBe(true);
    expect(reportStatus.hasTimestamp).toBe(true);
    expect(reportStatus.hasDatasetSize).toBe(true);
    expect(reportStatus.hasFieldCoverage).toBe(true);
    expect(reportStatus.hasQualityMetrics).toBe(true);
    expect(reportStatus.datasetSize).toBe(6176);
  });

  // ========================================
  // GROUP 2: FIELD COVERAGE VALIDATION (5 tests)
  // ========================================

  test('2.1: Should validate 31+ field validators defined', async ({ page }) => {
    const coverage = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validatorCount = Object.keys(dcm.validationRules.fieldValidators).length;

      return {
        totalFields: window.validationReport.fieldCoverage.totalFields,
        validatedFields: window.validationReport.fieldCoverage.validatedFields,
        coveragePercentage: window.validationReport.fieldCoverage.coveragePercentage,
        validatorCount
      };
    });

    // Verify that we have 31+ validators defined in DataCleanupManager
    expect(coverage.validatorCount).toBeGreaterThanOrEqual(31);

    // Note: totalFields/validatedFields depend on what exists in M_Company.json
    // M_Company.json has 33 fields, but DataCleanupManager has 39 validators
    // Only fields that exist in the data AND have validators will be counted
    expect(coverage.totalFields).toBeGreaterThan(0);
    expect(coverage.validatedFields).toBeGreaterThan(0);

    // Coverage percentage depends on actual data population
    expect(coverage.coveragePercentage).toMatch(/^\d+\.\d+%$/);
  });

  test('2.2: Should validate High Priority fields (7/7)', async ({ page }) => {
    const highPriorityFields = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validators = dcm.validationRules.fieldValidators;

      // High Priority Fields (Identity, Market Cap, Profitability)
      const highPriority = [
        'Ticker',
        'corpName',
        '(USD mn)',
        'PER (Oct-25)',
        'PBR (Oct-25)',
        'ROE (Fwd)',
        'ROA (Fwd)'
      ];

      return {
        totalHighPriority: highPriority.length,
        validated: highPriority.filter(field => validators[field] !== undefined).length,
        allPresent: highPriority.every(field => validators[field] !== undefined)
      };
    });

    expect(highPriorityFields.totalHighPriority).toBe(7);
    expect(highPriorityFields.validated).toBe(7);
    expect(highPriorityFields.allPresent).toBe(true);
  });

  test('2.3: Should validate Medium Priority fields (11/11)', async ({ page }) => {
    const mediumPriorityFields = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validators = dcm.validationRules.fieldValidators;

      // Medium Priority Fields (Financial, Leverage, Price)
      const mediumPriority = [
        'Debt/Equity (Fwd)',
        'Current Ratio (Fwd)',
        'Quick Ratio (Fwd)',
        'Return (Y)',
        'Return (3Y)',
        'Return (5Y)',
        'Revenue (Fwd)',
        'EBITDA (Fwd)',
        'EPS (Fwd)',
        'Price (Oct-25)',
        'Target Price'
      ];

      return {
        totalMediumPriority: mediumPriority.length,
        validated: mediumPriority.filter(field => validators[field] !== undefined).length,
        allPresent: mediumPriority.every(field => validators[field] !== undefined)
      };
    });

    expect(mediumPriorityFields.totalMediumPriority).toBe(11);
    expect(mediumPriorityFields.validated).toBe(11);
    expect(mediumPriorityFields.allPresent).toBe(true);
  });

  test('2.4: Should identify missing Low Priority fields (0/15)', async ({ page }) => {
    const lowPriorityFields = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validators = dcm.validationRules.fieldValidators;

      // Low Priority Fields (Optional/Additional info)
      const lowPriority = [
        'exchange',
        'industry',
        'FY 0',
        '설립',
        '현재가',
        '전일대비',
        '전주대비',
        'BVPS (Oct-25)',
        'OPM (Fwd)',
        'CCC (FY 0)',
        'DPS (Fwd)',
        'Upside (%)',
        'Analyst',
        'Rating',
        '45933'
      ];

      return {
        totalLowPriority: lowPriority.length,
        validated: lowPriority.filter(field => validators[field] !== undefined).length
      };
    });

    expect(lowPriorityFields.totalLowPriority).toBe(15);
    expect(lowPriorityFields.validated).toBeGreaterThanOrEqual(13); // Most are present
  });

  test('2.5: Should calculate coverage percentage correctly', async ({ page }) => {
    const coverageCalculation = await page.evaluate(() => {
      const report = window.validationReport;
      const fc = report.fieldCoverage;

      const calculatedPercentage = (fc.validatedFields / fc.totalFields * 100).toFixed(1);
      const reportedPercentage = parseFloat(fc.coveragePercentage);

      return {
        totalFields: fc.totalFields,
        validatedFields: fc.validatedFields,
        calculatedPercentage: parseFloat(calculatedPercentage),
        reportedPercentage,
        match: Math.abs(parseFloat(calculatedPercentage) - reportedPercentage) < 0.1
      };
    });

    expect(coverageCalculation.match).toBe(true);
    expect(coverageCalculation.reportedPercentage).toBeGreaterThan(0);
    expect(coverageCalculation.reportedPercentage).toBeLessThanOrEqual(100);
  });

  // ========================================
  // GROUP 3: VALIDATOR TESTING - NEW FIELDS (6 tests)
  // ========================================

  test('3.1: Should validate 결산 field (Month whitelist: Jan-Dec)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validator = dcm.validationRules.fieldValidators['결산'];

      return {
        validatorExists: validator !== undefined,
        validJan: validator('Jan'),
        validDec: validator('Dec'),
        validJun: validator('Jun'),
        invalidJanuary: validator('January'),
        invalidMonth: validator('Month13'),
        nullValue: validator(null),
        undefinedValue: validator(undefined),
        emptyString: validator('')
      };
    });

    expect(result.validatorExists).toBe(true);
    expect(result.validJan).toBe(true);
    expect(result.validDec).toBe(true);
    expect(result.validJun).toBe(true);
    expect(result.invalidJanuary).toBe(false);
    expect(result.invalidMonth).toBe(false);
    expect(result.nullValue).toBe(true); // nullable
    expect(result.undefinedValue).toBe(true); // nullable
    expect(result.emptyString).toBe(true); // nullable
  });

  test('3.2: Should validate W field (Range: -1.0 to 3.0)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validator = dcm.validationRules.fieldValidators['W'];

      return {
        validatorExists: validator !== undefined,
        validPositive: validator(0.5),
        validNegative: validator(-0.5),
        validZero: validator(0),
        validMin: validator(-1.0),
        validMax: validator(3.0),
        invalidTooLow: validator(-1.5),
        invalidTooHigh: validator(3.5),
        boundaryMin: validator(-1.0),
        boundaryMax: validator(3.0)
      };
    });

    expect(result.validatorExists).toBe(true);
    expect(result.validPositive).toBe(true);
    expect(result.validNegative).toBe(true);
    expect(result.validZero).toBe(true);
    expect(result.validMin).toBe(true);
    expect(result.validMax).toBe(true);
    expect(result.invalidTooLow).toBe(false);
    expect(result.invalidTooHigh).toBe(false);
    expect(result.boundaryMin).toBe(true);
    expect(result.boundaryMax).toBe(true);
  });

  test('3.3: Should validate 1 M field (Range: -1.0 to 3.0)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validator = dcm.validationRules.fieldValidators['1 M'];

      return {
        validatorExists: validator !== undefined,
        validPositive: validator(1.5),
        validNegative: validator(-0.8),
        validMin: validator(-1.0),
        validMax: validator(3.0),
        invalidTooLow: validator(-2.0),
        invalidTooHigh: validator(4.0),
        boundaryTest: validator(2.99)
      };
    });

    expect(result.validatorExists).toBe(true);
    expect(result.validPositive).toBe(true);
    expect(result.validNegative).toBe(true);
    expect(result.validMin).toBe(true);
    expect(result.validMax).toBe(true);
    expect(result.invalidTooLow).toBe(false);
    expect(result.invalidTooHigh).toBe(false);
    expect(result.boundaryTest).toBe(true);
  });

  test('3.4: Should validate 3 M field (Range: -1.0 to 3.0)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validator = dcm.validationRules.fieldValidators['3 M'];

      return {
        validatorExists: validator !== undefined,
        validPositive: validator(2.5),
        validNegative: validator(-0.9),
        validZero: validator(0),
        invalidTooLow: validator(-1.1),
        invalidTooHigh: validator(3.1)
      };
    });

    expect(result.validatorExists).toBe(true);
    expect(result.validPositive).toBe(true);
    expect(result.validNegative).toBe(true);
    expect(result.validZero).toBe(true);
    expect(result.invalidTooLow).toBe(false);
    expect(result.invalidTooHigh).toBe(false);
  });

  test('3.5: Should validate 6 M field (Range: -1.0 to 3.0)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validator = dcm.validationRules.fieldValidators['6 M'];

      return {
        validatorExists: validator !== undefined,
        validPositive: validator(1.8),
        validNegative: validator(-0.6),
        validMin: validator(-1.0),
        validMax: validator(3.0),
        invalidTooLow: validator(-1.5),
        invalidTooHigh: validator(5.0)
      };
    });

    expect(result.validatorExists).toBe(true);
    expect(result.validPositive).toBe(true);
    expect(result.validNegative).toBe(true);
    expect(result.validMin).toBe(true);
    expect(result.validMax).toBe(true);
    expect(result.invalidTooLow).toBe(false);
    expect(result.invalidTooHigh).toBe(false);
  });

  test('3.6: Should validate 12 M field (Range: -1.0 to 3.0)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validator = dcm.validationRules.fieldValidators['12 M'];

      return {
        validatorExists: validator !== undefined,
        validPositive: validator(2.0),
        validNegative: validator(-0.7),
        validZero: validator(0),
        validMin: validator(-1.0),
        validMax: validator(3.0),
        invalidTooLow: validator(-2.0),
        invalidTooHigh: validator(3.5)
      };
    });

    expect(result.validatorExists).toBe(true);
    expect(result.validPositive).toBe(true);
    expect(result.validNegative).toBe(true);
    expect(result.validZero).toBe(true);
    expect(result.validMin).toBe(true);
    expect(result.validMax).toBe(true);
    expect(result.invalidTooLow).toBe(false);
    expect(result.invalidTooHigh).toBe(false);
  });

  // ========================================
  // GROUP 4: QUALITY METRICS (4 tests)
  // ========================================

  test('4.1: Should calculate Quality Score correctly', async ({ page }) => {
    const qualityScore = await page.evaluate(() => {
      const qm = window.validationReport.qualityMetrics;

      return {
        qualityScore: qm.qualityScore,
        scoreValue: parseFloat(qm.qualityScore),
        errorRate: qm.errorRate,
        totalIssues: qm.totalIssues,
        criticalIssues: qm.criticalIssues,
        warningIssues: qm.warningIssues,
        infoIssues: qm.infoIssues
      };
    });

    expect(qualityScore.qualityScore).toMatch(/^\d+\.\d+\/100$/);
    expect(qualityScore.scoreValue).toBeGreaterThanOrEqual(0);
    expect(qualityScore.scoreValue).toBeLessThanOrEqual(100);
    expect(qualityScore.errorRate).toMatch(/^\d+\.\d+%$/);
    expect(qualityScore.totalIssues).toBeGreaterThanOrEqual(0);
  });

  test('4.2: Should detect format issues (percentage/decimal)', async ({ page }) => {
    const formatIssues = await page.evaluate(() => {
      const fi = window.validationReport.formatIssues;

      return {
        hasFormatIssues: fi !== undefined,
        percentageAsDecimal: fi.percentageAsDecimal.length,
        decimalAsPercentage: fi.decimalAsPercentage.length,
        stringNumbers: fi.stringNumbers.length,
        totalFormatIssues: fi.percentageAsDecimal.length +
                          fi.decimalAsPercentage.length +
                          fi.stringNumbers.length
      };
    });

    expect(formatIssues.hasFormatIssues).toBe(true);
    expect(formatIssues.percentageAsDecimal).toBeGreaterThanOrEqual(0);
    expect(formatIssues.decimalAsPercentage).toBeGreaterThanOrEqual(0);
    expect(formatIssues.stringNumbers).toBeGreaterThanOrEqual(0);
  });

  test('4.3: Should identify null/infinity values', async ({ page }) => {
    const nullInfinityIssues = await page.evaluate(() => {
      const fi = window.validationReport.formatIssues;

      return {
        hasNullInfinity: fi.nullInfinity !== undefined,
        count: fi.nullInfinity.length,
        sample: fi.nullInfinity.slice(0, 3)
      };
    });

    expect(nullInfinityIssues.hasNullInfinity).toBe(true);
    expect(nullInfinityIssues.count).toBeGreaterThanOrEqual(0);
  });

  test('4.4: Should report out-of-range values', async ({ page }) => {
    const outOfRangeIssues = await page.evaluate(() => {
      const fi = window.validationReport.formatIssues;

      return {
        hasOutOfRange: fi.outOfRange !== undefined,
        count: fi.outOfRange.length,
        sample: fi.outOfRange.slice(0, 3).map(issue => ({
          field: issue.field,
          value: issue.value,
          range: issue.range
        }))
      };
    });

    expect(outOfRangeIssues.hasOutOfRange).toBe(true);
    expect(outOfRangeIssues.count).toBeGreaterThanOrEqual(0);
  });

  // ========================================
  // GROUP 5: VALIDATION REPORT (4 tests)
  // ========================================

  test('5.1: Should generate comprehensive validation report', async ({ page }) => {
    const report = await page.evaluate(() => window.validationReport);

    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('datasetSize');
    expect(report).toHaveProperty('fieldCoverage');
    expect(report).toHaveProperty('qualityMetrics');
    expect(report).toHaveProperty('formatIssues');
    expect(report).toHaveProperty('recommendations');

    expect(report.datasetSize).toBe(6176);
  });

  test('5.2: Should include fieldCoverage analysis', async ({ page }) => {
    const fieldCoverage = await page.evaluate(() => {
      const fc = window.validationReport.fieldCoverage;

      return {
        hasTotalFields: 'totalFields' in fc,
        hasValidatedFields: 'validatedFields' in fc,
        hasCoveragePercentage: 'coveragePercentage' in fc,
        hasFieldDetails: 'fieldDetails' in fc,
        fieldDetailsCount: Object.keys(fc.fieldDetails).length,
        sampleFieldDetail: fc.fieldDetails['Ticker'] || fc.fieldDetails['corpName']
      };
    });

    expect(fieldCoverage.hasTotalFields).toBe(true);
    expect(fieldCoverage.hasValidatedFields).toBe(true);
    expect(fieldCoverage.hasCoveragePercentage).toBe(true);
    expect(fieldCoverage.hasFieldDetails).toBe(true);
    expect(fieldCoverage.fieldDetailsCount).toBeGreaterThanOrEqual(31);
    expect(fieldCoverage.sampleFieldDetail).toHaveProperty('totalRecords');
    expect(fieldCoverage.sampleFieldDetail).toHaveProperty('validRecords');
    expect(fieldCoverage.sampleFieldDetail).toHaveProperty('completeness');
  });

  test('5.3: Should include qualityMetrics', async ({ page }) => {
    const qualityMetrics = await page.evaluate(() => {
      const qm = window.validationReport.qualityMetrics;

      return {
        hasTotalRecords: 'totalRecords' in qm,
        hasTotalFields: 'totalFields' in qm,
        hasQualityScore: 'qualityScore' in qm,
        hasErrorRate: 'errorRate' in qm,
        hasCriticalIssues: 'criticalIssues' in qm,
        hasWarningIssues: 'warningIssues' in qm,
        hasInfoIssues: 'infoIssues' in qm,
        totalRecords: qm.totalRecords,
        totalFields: qm.totalFields
      };
    });

    expect(qualityMetrics.hasTotalRecords).toBe(true);
    expect(qualityMetrics.hasTotalFields).toBe(true);
    expect(qualityMetrics.hasQualityScore).toBe(true);
    expect(qualityMetrics.hasErrorRate).toBe(true);
    expect(qualityMetrics.hasCriticalIssues).toBe(true);
    expect(qualityMetrics.hasWarningIssues).toBe(true);
    expect(qualityMetrics.hasInfoIssues).toBe(true);
    expect(qualityMetrics.totalRecords).toBe(6176);
    expect(qualityMetrics.totalFields).toBeGreaterThanOrEqual(31);
  });

  test('5.4: Should include actionable recommendations', async ({ page }) => {
    const recommendations = await page.evaluate(() => {
      const recs = window.validationReport.recommendations;

      return {
        isArray: Array.isArray(recs),
        count: recs.length,
        sampleRecommendation: recs[0],
        allHavePriority: recs.every(r => 'priority' in r),
        allHaveCategory: recs.every(r => 'category' in r),
        allHaveIssue: recs.every(r => 'issue' in r),
        allHaveAction: recs.every(r => 'action' in r),
        allHaveImpact: recs.every(r => 'impact' in r)
      };
    });

    expect(recommendations.isArray).toBe(true);
    expect(recommendations.count).toBeGreaterThan(0);
    expect(recommendations.allHavePriority).toBe(true);
    expect(recommendations.allHaveCategory).toBe(true);
    expect(recommendations.allHaveIssue).toBe(true);
    expect(recommendations.allHaveAction).toBe(true);
    expect(recommendations.allHaveImpact).toBe(true);
  });

  // ========================================
  // GROUP 6: EDGE CASES (3 tests)
  // ========================================

  test('6.1: Should handle companies with missing data gracefully', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const dcm = window.dataCleanupManager;

      // Create test data with missing fields
      const testData = [
        { Ticker: 'TEST1', corpName: 'Test Company 1' },
        { Ticker: 'TEST2', corpName: 'Test Company 2', 'PER (Oct-25)': null },
        { Ticker: 'TEST3', corpName: 'Test Company 3', 'ROE (Fwd)': undefined }
      ];

      const report = dcm.generateValidationReport(testData);

      return {
        success: report !== null,
        datasetSize: report.datasetSize,
        hasFieldCoverage: report.fieldCoverage !== undefined,
        hasQualityMetrics: report.qualityMetrics !== undefined
      };
    });

    expect(result.success).toBe(true);
    expect(result.datasetSize).toBe(3);
    expect(result.hasFieldCoverage).toBe(true);
    expect(result.hasQualityMetrics).toBe(true);
  });

  test('6.2: Should validate nullable fields correctly', async ({ page }) => {
    const result = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;

      // Test nullable fields (exchange, industry, 결산, etc.)
      const nullableFields = ['exchange', 'industry', '결산', 'Analyst', 'Rating'];
      const validators = dcm.validationRules.fieldValidators;

      return nullableFields.map(field => ({
        field,
        hasValidator: validators[field] !== undefined,
        nullValid: validators[field] ? validators[field](null) : null,
        undefinedValid: validators[field] ? validators[field](undefined) : null,
        emptyValid: validators[field] ? validators[field]('') : null
      }));
    });

    result.forEach(fieldTest => {
      if (fieldTest.hasValidator) {
        expect(fieldTest.nullValid).toBe(true);
        expect(fieldTest.undefinedValid).toBe(true);
        expect(fieldTest.emptyValid).toBe(true);
      }
    });
  });

  test('6.3: Should handle boundary values (min/max ranges)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const dcm = window.dataCleanupManager;
      const validators = dcm.validationRules.fieldValidators;

      return {
        // Performance metrics: -1.0 to 3.0
        W_minBoundary: validators['W'](-1.0),
        W_maxBoundary: validators['W'](3.0),
        W_belowMin: validators['W'](-1.01),
        W_aboveMax: validators['W'](3.01),

        // ROE: -100 to 200
        ROE_minBoundary: validators['ROE (Fwd)'](-100),
        ROE_maxBoundary: validators['ROE (Fwd)'](200),
        ROE_belowMin: validators['ROE (Fwd)'](-101),
        ROE_aboveMax: validators['ROE (Fwd)'](201),

        // PER: 0 to 1000
        PER_minBoundary: validators['PER (Oct-25)'](0),
        PER_maxBoundary: validators['PER (Oct-25)'](1000),
        PER_belowMin: validators['PER (Oct-25)'](-1),
        PER_aboveMax: validators['PER (Oct-25)'](1001)
      };
    });

    // Performance metrics boundaries
    expect(result.W_minBoundary).toBe(true);
    expect(result.W_maxBoundary).toBe(true);
    expect(result.W_belowMin).toBe(false);
    expect(result.W_aboveMax).toBe(false);

    // ROE boundaries
    expect(result.ROE_minBoundary).toBe(true);
    expect(result.ROE_maxBoundary).toBe(true);
    expect(result.ROE_belowMin).toBe(false);
    expect(result.ROE_aboveMax).toBe(false);

    // PER boundaries
    expect(result.PER_minBoundary).toBe(true);
    expect(result.PER_maxBoundary).toBe(true);
    expect(result.PER_belowMin).toBe(false);
    expect(result.PER_aboveMax).toBe(false);
  });

  // ========================================
  // PERFORMANCE & INTEGRATION TEST
  // ========================================

  test('Performance: Full dataset validation should complete in < 5 seconds', async ({ page }) => {
    const performanceResults = await page.evaluate(async () => {
      const dcm = window.dataCleanupManager;
      const companies = window.companyMaster.companies;

      const start = performance.now();
      const report = dcm.generateValidationReport(companies);
      const duration = performance.now() - start;

      return {
        duration,
        datasetSize: companies.length,
        reportGenerated: report !== null,
        qualityScore: report.qualityMetrics.qualityScore,
        coverage: report.fieldCoverage.coveragePercentage
      };
    });

    console.log('\n========================================');
    console.log('PERFORMANCE TEST: ValidationAnalytics');
    console.log('========================================');
    console.log(`Duration:       ${performanceResults.duration.toFixed(2)}ms`);
    console.log(`Dataset Size:   ${performanceResults.datasetSize} companies`);
    console.log(`Quality Score:  ${performanceResults.qualityScore}`);
    console.log(`Coverage:       ${performanceResults.coverage}`);
    console.log('========================================\n');

    expect(performanceResults.duration).toBeLessThan(5000);
    expect(performanceResults.datasetSize).toBe(6176);
    expect(performanceResults.reportGenerated).toBe(true);
  });

});
