# Sprint 4 Tests - Quick Start Guide

## Installation

```bash
cd C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer
npm install
```

## Running Tests

### All Tests (52+ tests)
```bash
npm test
```

### Individual Test Files
```bash
# EPSAnalytics tests (15+ tests)
npm run test:eps

# Dashboard rendering tests (20+ tests)
npm run test:dashboard

# Integration tests (10+ tests)
npm run test:integration

# Performance tests (7+ tests)
npm run test:performance
```

### Interactive Mode (Best for Development)
```bash
npm run test:e2e:ui
```

### Headed Mode (See Browser)
```bash
npm run test:headed
```

### Debug Mode (Step-by-Step)
```bash
npm run test:e2e:debug
```

### Specific Browser
```bash
npm run test:chromium
npm run test:firefox
npm run test:webkit
```

## View Test Results

```bash
npm run test:e2e:report
```

## Test Structure

```
tests/
├── sprint4-eps-analytics.spec.js       # 15+ tests - EPSAnalytics module
├── sprint4-dashboard-rendering.spec.js # 20+ tests - Dashboard UI & Charts
├── sprint4-integration.spec.js         # 10+ tests - Module integration
├── sprint4-performance.spec.js         # 7+ tests  - Performance benchmarks
├── README.md                           # Detailed documentation
└── QUICK_START.md                      # This file
```

## Expected Results

### Total Test Count: 52+
- ✅ EPSAnalytics: 15+ tests
- ✅ Dashboard Rendering: 20+ tests
- ✅ Integration: 10+ tests
- ✅ Performance: 7+ tests

### Performance Benchmarks
- Module init: < 1.5s each
- Chart rendering: < 500ms per chart
- Full dashboard: < 2s
- Cold start: < 8s

## Common Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run all E2E tests |
| `npm run test:e2e:ui` | Interactive UI mode |
| `npm run test:eps` | Test EPSAnalytics only |
| `npm run test:dashboard` | Test dashboard only |
| `npm run test:performance` | Performance benchmarks |
| `npm run test:e2e:report` | View HTML report |

## Troubleshooting

### Port Already in Use
If port 8080 is busy:
1. Stop other servers
2. Or change port in `playwright.config.js`

### Tests Timeout
- Increase timeout in test file
- Check network connection
- Ensure data files are present

### Charts Not Rendering
- Wait longer: increase `waitForTimeout()`
- Check browser console
- Verify Chart.js loads

## Next Steps

1. ✅ Run all tests: `npm test`
2. ✅ Review report: `npm run test:e2e:report`
3. ✅ Read detailed docs: `tests/README.md`
4. ✅ Add new tests as needed

## Test Coverage Summary

### EPSAnalytics Module (490 lines)
- [x] Initialization
- [x] Data loading (T_EPS_C)
- [x] 13 methods tested
- [x] Chart data generation
- [x] XSS protection
- [x] Error handling

### Dashboard UI
- [x] HTML structure (lines 963-1054)
- [x] 6 Chart.js charts
- [x] Growth Analytics section
- [x] Ranking Analytics section
- [x] EPS Analytics section
- [x] Responsive layout

### Integration
- [x] 3 module coordination
- [x] Data consistency
- [x] Error recovery
- [x] Tab switching

### Performance
- [x] Init benchmarks
- [x] Chart rendering speed
- [x] Memory usage
- [x] Real-world scenarios
