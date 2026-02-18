# Sprint 4 E2E Tests - Playwright Test Suite

Comprehensive end-to-end testing for Sprint 4 Analytics modules (GrowthAnalytics, RankingAnalytics, EPSAnalytics) and the integrated dashboard.

## Overview

This test suite contains **52+ comprehensive E2E tests** covering:
- **Module Functionality**: 15+ tests for EPSAnalytics
- **Dashboard Rendering**: 20+ tests for UI and Chart.js visualization
- **Integration**: 10+ tests for module interactions
- **Performance**: 7+ tests for benchmarks and optimization

## Test Files

### 1. sprint4-eps-analytics.spec.js (15+ tests)
Tests for EPSAnalytics module (490 lines, 13 methods):
- Module initialization and setup
- Data retrieval methods (getCompanyEPS, getSectorEPSAverages, getHighEPSCompanies)
- Data parsing and validation (parseEPS)
- Chart data generation (getEPSChartData, getROEvsEPSGrowthData)
- XSS security and data sanitization
- Edge cases and error handling

### 2. sprint4-dashboard-rendering.spec.js (20+ tests)
Tests for Sprint 4 Analytics dashboard rendering:
- HTML structure and DOM verification
- Chart.js rendering for 6 charts (Growth Analytics, Ranking Analytics, EPS Analytics)
- Data binding and updates
- Statistics card updates
- Responsive layout (desktop, tablet, mobile)
- User interactions and tab switching
- Error handling and edge cases

### 3. sprint4-integration.spec.js (10+ tests)
Integration tests for three Analytics modules:
- Module availability and initialization
- Shared dataManager consistency
- Cross-metric analysis
- Dashboard coordination
- Data flow and consistency
- Error propagation and recovery
- End-to-end user workflows

### 4. sprint4-performance.spec.js (7+ tests)
Performance benchmarks and optimization tests:
- Module initialization (< 1.5s per module, < 3s total)
- Chart rendering (< 500ms per chart, < 2s for all 6 charts)
- Memory usage and leak detection
- Data processing efficiency
- Cold start vs hot reload performance
- Real-world scenario benchmarks

## Running Tests

### Prerequisites
```bash
npm install
```

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npm test tests/sprint4-eps-analytics.spec.js
npm test tests/sprint4-dashboard-rendering.spec.js
npm test tests/sprint4-integration.spec.js
npm test tests/sprint4-performance.spec.js
```

### Run Tests with UI Mode (Interactive Debugging)
```bash
npm run test:ui
```

### Run Tests in Specific Browser
```bash
# Chromium only
npx playwright test --project=chromium

# Firefox only
npx playwright test --project=firefox

# WebKit (Safari) only
npx playwright test --project=webkit
```

### Run Tests with Debug Mode
```bash
npx playwright test --debug
```

### Generate Test Report
```bash
npx playwright show-report
```

## Performance Benchmarks

### Module Initialization
- EPSAnalytics: < 1.5 seconds
- GrowthAnalytics: < 1.5 seconds
- RankingAnalytics: < 1.5 seconds
- All modules (parallel): < 3 seconds

### Chart Rendering
- Single chart: < 500ms
- All 6 charts: < 2 seconds
- Re-render after tab switch: < 1 second

### Memory Usage
- Analytics modules: < 100MB
- Memory growth after 10 tab switches: < 20MB
- No memory leaks detected

### Real-World Scenarios
- Cold start (page load → dashboard ready): < 8 seconds
- Hot reload (dashboard re-entry): < 1 second

## Test Coverage

### EPSAnalytics Module (490 lines)
- ✅ Class initialization
- ✅ Data loading (T_EPS_C)
- ✅ Data enrichment
- ✅ 13 methods tested
- ✅ Error handling
- ✅ XSS protection

### Dashboard (HTML lines 963-1054)
- ✅ DOM structure
- ✅ 6 Chart.js instances
- ✅ Data binding
- ✅ Statistics cards
- ✅ Responsive layout
- ✅ User interactions

### Integration
- ✅ Module coordination
- ✅ Data consistency
- ✅ Error recovery
- ✅ End-to-end workflows

## CI/CD Integration

The test suite is configured for continuous integration:
- Retries: 2 (on CI only)
- Parallel execution: Disabled on CI for stability
- Screenshots: On failure only
- Videos: Retained on failure
- Test reports: HTML and JSON formats

### GitHub Actions Example
```yaml
- name: Run Playwright Tests
  run: npm test
  env:
    CI: true
```

## Debugging Failed Tests

### View Test Report
```bash
npx playwright show-report
```

### Run Single Test with Trace
```bash
npx playwright test tests/sprint4-eps-analytics.spec.js --trace on
```

### View Trace
```bash
npx playwright show-trace trace.zip
```

### Screenshots and Videos
Failed tests automatically capture:
- Screenshots: `test-results/`
- Videos: `test-results/`
- Traces: `test-results/`

## Writing New Tests

### Test Structure Template
```javascript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
  });

  test('should do something', async ({ page }) => {
    // Arrange: Set up test conditions

    // Act: Perform actions

    // Assert: Verify expectations
    expect(result).toBeTruthy();
  });
});
```

### Best Practices
1. Use descriptive test names
2. Follow Arrange-Act-Assert pattern
3. Use `waitForLoadState('networkidle')` for page loads
4. Add `waitForTimeout()` for dynamic content
5. Use `page.evaluate()` for JavaScript execution
6. Verify both success and error cases
7. Test responsive layouts with viewport changes
8. Include performance benchmarks where relevant

## Troubleshooting

### Tests Fail on First Run
- Ensure web server is running on port 8080
- Check if data files are available (`global_scouter_integrated.json`)

### Charts Not Rendering
- Increase `waitForTimeout()` values
- Verify Chart.js library is loaded
- Check browser console for errors

### Performance Tests Fail
- Run on dedicated hardware
- Close other applications
- Disable browser extensions
- Use headless mode for consistent results

### Memory Tests Not Available
- `performance.memory` API requires Chrome/Chromium
- Tests will pass gracefully in other browsers

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Chart.js Documentation](https://www.chartjs.org)
- [Project README](../README.md)
- [Sprint 4 Implementation Details](../WORKFLOW.md)

## Contact

For questions or issues:
- Review test output: `npx playwright show-report`
- Check console logs in browser DevTools
- Review trace files for detailed execution steps
