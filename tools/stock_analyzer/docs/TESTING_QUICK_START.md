# Testing Quick Start Guide
## Stock Analyzer - Sprint 4 Implementation

**Date**: 2025-10-17
**Purpose**: Immediate testing implementation guide for Sprint 4

---

## 1. Installation (5 minutes)

```bash
# Navigate to project directory
cd C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer

# Install testing dependencies (if not already installed)
npm install --save-dev vitest @vitest/ui jsdom @vitest/coverage-v8

# Install Playwright for E2E tests
npm install --save-dev @playwright/test
npx playwright install --with-deps
```

---

## 2. Project Structure

```
stock_analyzer/
├── tests/
│   ├── setup.js                          # ✅ Created
│   ├── unit/
│   │   ├── GrowthAnalytics.test.js       # ✅ Created (28 tests)
│   │   ├── RankingAnalytics.test.js      # TODO: Sprint 4 Task 4.T3
│   │   └── utils.test.js                 # TODO: Sprint 4
│   ├── integration/
│   │   ├── data-flow.test.js             # TODO: Sprint 5
│   │   └── user-interactions.test.js     # TODO: Sprint 5
│   ├── e2e/
│   │   ├── critical-paths.spec.js        # TODO: Sprint 4 Task 4.T5
│   │   └── browser-compatibility.spec.js # TODO: Sprint 5
│   └── data-quality/
│       ├── schema-validation.test.js     # TODO: Sprint 4 Task 4.T4
│       └── quality-score.test.js         # TODO: Sprint 4
├── vitest.config.js                      # ✅ Enhanced
├── playwright.config.js                  # TODO: Sprint 4 Task 4.T5
└── docs/
    ├── COMPREHENSIVE_TEST_STRATEGY.md    # ✅ Created
    └── TESTING_QUICK_START.md            # ✅ This file
```

---

## 3. Running Tests

### Unit Tests (Vitest)

```bash
# Run all unit tests
npm run test

# Run with coverage report
npm run test:coverage

# Run with interactive UI
npm run test:ui

# Run specific test file
npm run test tests/unit/GrowthAnalytics.test.js

# Run in watch mode (auto-rerun on file changes)
npm run test -- --watch
```

### E2E Tests (Playwright)

```bash
# Run all E2E tests
npx playwright test

# Run with UI mode (interactive debugging)
npx playwright test --ui

# Run specific browser
npx playwright test --project=chromium

# Show test report
npx playwright show-report
```

---

## 4. Sprint 4 Testing Tasks

### Task 4.T1: Set up Vitest Framework ✅ COMPLETED
- [x] Install Vitest and dependencies
- [x] Create vitest.config.js
- [x] Create tests/setup.js
- [x] Configure coverage thresholds (80% target)

**Status**: Ready to use

---

### Task 4.T2: GrowthAnalytics Unit Tests ✅ COMPLETED
- [x] Create tests/unit/GrowthAnalytics.test.js
- [x] 28 test cases covering:
  - Initialization (3 tests)
  - Data parsing (6 tests)
  - Business logic (6 tests)
  - Utility functions (4 tests)
  - Edge cases (3 tests)

**Status**: Ready for execution

**Run**:
```bash
npm run test tests/unit/GrowthAnalytics.test.js
```

**Expected**: ~75% coverage for GrowthAnalytics module

---

### Task 4.T3: RankingAnalytics Unit Tests ⏳ TODO
**File**: `tests/unit/RankingAnalytics.test.js`

**Test Cases to Implement** (20+ tests):
- Initialization tests (load T_Rank.csv with 1252 records)
- getRanking() functionality
- getSectorRanking() filtering
- getCustomRanking() with user weights
- Ranking tie handling
- Null value handling (Quality Score 93.6% means some nulls)

**Template**:
```javascript
import { describe, test, expect, beforeEach } from 'vitest';

describe('RankingAnalytics', () => {
  test('initialize() loads T_Rank data with 1252 records', async () => {
    // Mock fetch with T_Rank data
    // Assert: rankingData.length === 1252
  });

  test('getRanking() returns multi-indicator rankings', () => {
    // Given: initialized ranking data
    // When: getRanking(['ROE', 'OPM'])
    // Then: returns sorted list by combined rank
  });
});
```

**Coverage Target**: ≥75%

---

### Task 4.T4: Data Quality Validation Tests ⏳ TODO
**File**: `tests/data-quality/schema-validation.test.js`

**Test Cases** (15+ tests):
- Schema validation for S-Tier CSV files
- Row count verification (M_Company: 6178, T_Rank: 1252, etc.)
- Column count verification
- Required columns check (Ticker, Corp, Exchange)
- Data type validation (numeric fields contain numbers)
- Quality score calculation verification

**Template**:
```javascript
describe('CSV Schema Validation', () => {
  const csvFiles = [
    { name: 'M_Company.csv', expectedRows: 6178, expectedCols: 34 },
    { name: 'T_Rank.csv', expectedRows: 1252, expectedCols: 38 }
  ];

  csvFiles.forEach(file => {
    test(`${file.name} has expected row count`, () => {
      // Load CSV and count rows
      // Assert: actual ≈ expected (±5% tolerance)
    });
  });
});
```

**Coverage Target**: Validate all 5 S-Tier files

---

### Task 4.T5: E2E Tests (Critical Paths) ⏳ TODO
**File**: `tests/e2e/critical-paths.spec.js`
**File**: `playwright.config.js`

**Setup**:
1. Create `playwright.config.js` (see COMPREHENSIVE_TEST_STRATEGY.md Section 7.3)
2. Configure base URL: `http://localhost:5173`
3. Set up browser projects (Chromium, Firefox, WebKit)

**Test Cases** (2 E2E tests minimum for Sprint 4):
```javascript
test('User can search and view stock details', async ({ page }) => {
  // 1. Navigate to app
  await page.goto('http://localhost:5173');

  // 2. Wait for data load
  await page.waitForSelector('#stock-table');

  // 3. Search for "Apple"
  await page.fill('#search-input', 'Apple');

  // 4. Verify results
  const rows = await page.locator('tbody tr').count();
  expect(rows).toBeGreaterThan(0);
});

test('Data loads within 3 seconds', async ({ page }) => {
  const startTime = Date.now();
  await page.goto('http://localhost:5173');
  await page.waitForSelector('#stock-table tbody tr');

  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000); // Performance target
});
```

**Coverage Target**: 2 critical paths passing

---

### Task 4.T6: Performance Baseline ⏳ TODO
**File**: `tests/performance/load-test.js`

**Measurements**:
- Initial data load time (target: < 3 seconds)
- Search time (target: < 100ms)
- Filter time (target: < 200ms)
- Pagination switch time (target: < 50ms)

**Implementation**:
```javascript
describe('Performance Baseline', () => {
  test('Initial load time < 3 seconds', async () => {
    const startTime = performance.now();

    // Load data
    await fetch('./data/enhanced_summary_data_full.json');

    const loadTime = performance.now() - startTime;
    expect(loadTime).toBeLessThan(3000);
  });
});
```

---

### Task 4.T7: Documentation ⏳ TODO
**Files to Update**:
- `README.md` (add Testing section)
- `docs/COMPREHENSIVE_TEST_STRATEGY.md` (already created ✅)
- `docs/TESTING_QUICK_START.md` (this file ✅)

**README.md Addition**:
```markdown
## Testing

### Running Tests

```bash
# Unit tests
npm run test

# Coverage report
npm run test:coverage

# E2E tests
npx playwright test
```

### Test Coverage Targets

- Unit Tests: ≥80%
- Integration Tests: ≥70%
- E2E Tests: 100% of critical paths

See [Testing Strategy](docs/COMPREHENSIVE_TEST_STRATEGY.md) for details.
```

---

## 5. Quality Gates (Sprint 4)

**Must Pass Before Sprint Completion**:

- [ ] **Unit Tests**: ≥75% coverage for GrowthAnalytics and RankingAnalytics
- [ ] **Data Quality**: All S-Tier CSV files validated (5 files)
- [ ] **E2E Tests**: 2 critical paths passing (search, data load)
- [ ] **Performance**: Initial load < 3 seconds verified
- [ ] **Regression**: No new critical bugs introduced
- [ ] **Documentation**: Testing section added to README.md

**Blocker Resolution**: All P0 (critical) bugs must be fixed before sprint closure

---

## 6. CI/CD Setup (Sprint 5)

**GitHub Actions Configuration** (Future):
- Automated test runs on every commit
- Coverage reports uploaded to Codecov
- E2E tests in CI with screenshots on failure
- Performance regression checks

**File**: `.github/workflows/test.yml` (see COMPREHENSIVE_TEST_STRATEGY.md Section 7.1)

---

## 7. Common Commands

```bash
# Install all dependencies
npm install

# Run unit tests
npm run test

# Run with coverage
npm run test:coverage

# Run specific test
npm run test tests/unit/GrowthAnalytics.test.js

# Run E2E tests
npx playwright test

# Open Playwright UI
npx playwright test --ui

# Generate HTML coverage report
npm run test:coverage
# Open: coverage/index.html

# Run all tests (unit + E2E)
npm run test:all  # TODO: Add this script
```

---

## 8. Debugging Tests

### Vitest Debugging

```bash
# Run single test with console output
npm run test -- --reporter=verbose tests/unit/GrowthAnalytics.test.js

# Run with debugger (Chrome DevTools)
node --inspect-brk ./node_modules/vitest/vitest.mjs run

# Run specific test by name
npm run test -- --grep "parseGrowth"
```

### Playwright Debugging

```bash
# Run with headed browser (see browser actions)
npx playwright test --headed

# Run with debugger
npx playwright test --debug

# Generate trace file
npx playwright test --trace on

# View trace
npx playwright show-trace trace.zip
```

---

## 9. Test Writing Best Practices

### Unit Test Structure

```javascript
describe('ModuleName', () => {
  // Setup
  let instance;

  beforeEach(() => {
    instance = new ModuleName();
  });

  // Test naming: "should [expected behavior] when [condition]"
  test('should return null when input is invalid', () => {
    // Arrange
    const input = null;

    // Act
    const result = instance.parseData(input);

    // Assert
    expect(result).toBe(null);
  });
});
```

### E2E Test Structure

```javascript
test('User workflow description', async ({ page }) => {
  // 1. Setup - Navigate
  await page.goto('URL');

  // 2. Action - User interaction
  await page.click('#button');

  // 3. Assertion - Verify outcome
  expect(await page.locator('#result').textContent()).toBe('Expected');
});
```

---

## 10. Next Steps

**Immediate (Sprint 4)**:
1. Run existing GrowthAnalytics tests: `npm run test`
2. Implement RankingAnalytics tests (Task 4.T3)
3. Create data quality validation tests (Task 4.T4)
4. Set up Playwright and create 2 E2E tests (Task 4.T5)
5. Establish performance baselines (Task 4.T6)
6. Update README.md with testing section (Task 4.T7)

**Short-term (Sprint 5)**:
- Expand to EPSAnalytics and CashFlowAnalytics tests
- Add integration tests for module interactions
- Set up CI/CD pipeline (GitHub Actions)
- Implement browser compatibility tests

**Long-term (Sprint 6+)**:
- Achieve ≥80% overall coverage
- Visual regression testing
- Load testing for 100k+ rows
- Security testing (XSS, injection prevention)

---

## 11. Support Resources

**Documentation**:
- [Comprehensive Test Strategy](COMPREHENSIVE_TEST_STRATEGY.md) - Full testing guide
- [Vitest Documentation](https://vitest.dev/) - Official Vitest docs
- [Playwright Documentation](https://playwright.dev/) - Official Playwright docs

**Key Contacts**:
- Testing Lead: Quality Engineer (Claude Code)
- Development Team: Sprint 4 Team
- Questions: Sprint retrospectives or GitHub Discussions

---

**Last Updated**: 2025-10-17
**Status**: Ready for Sprint 4 Implementation
