# Momentum Module Documentation

## Overview
The Momentum module is a comprehensive system for analyzing and visualizing stock momentum across multiple dimensions. It consists of 7 interconnected components that work together to provide advanced momentum analysis capabilities.

## Architecture

```
M_Company (Main Module)
    ├── MomentumCalculator   - Multi-factor momentum computation
    ├── RankingEngine        - Advanced ranking algorithms
    ├── FilterEngine         - Smart filtering system
    ├── MomentumVisualizer   - Data visualization
    ├── CompanyDetailView    - Detailed company analysis
    └── CompanyComparison    - Multi-company comparison
```

## Components

### 1. MomentumCalculator
Calculates various momentum metrics for companies.

**Key Features:**
- Price momentum (52-week performance)
- Earnings momentum (PER trends)
- Volume momentum (trading activity)
- Fundamental momentum (ROE, profit margins)
- Technical momentum (RSI, MACD)
- Relative momentum (vs industry/market)

**Usage:**
```javascript
const calculator = new MomentumCalculator();
const momentum = calculator.calculate(companyData);
```

### 2. RankingEngine
Provides multiple ranking algorithms for companies.

**Ranking Methods:**
- Standard ranking (1 to N)
- Percentile ranking (0-100)
- Z-score ranking (standard deviations)
- Decile ranking (1-10)
- Composite ranking (weighted multi-factor)

**Usage:**
```javascript
const engine = new RankingEngine();
const ranked = engine.rank(companies, 'momentum.total', 'percentile');
```

### 3. FilterEngine
Smart filtering system with template support.

**Filter Types:**
- Range filters (min/max values)
- Category filters (industry, exchange)
- Percentile filters (top 10%, etc.)
- Custom filters (user-defined)
- Template filters (pre-configured)

**Usage:**
```javascript
const filter = new FilterEngine();
const filtered = filter.applyFilters(companies, [
    { field: 'momentum.price', min: 50 },
    { field: 'industry', values: ['Technology'] }
]);
```

### 4. MomentumVisualizer
Creates various chart visualizations.

**Chart Types:**
- Heatmaps (momentum matrix)
- Line charts (time series)
- Bar charts (comparisons)
- Scatter plots (correlations)
- Radar charts (multi-factor)
- Gauge charts (single metrics)
- Sparklines (mini trends)

**Usage:**
```javascript
const visualizer = new MomentumVisualizer();
const chart = visualizer.createHeatmap(data, {
    width: 800,
    height: 600,
    colorScheme: 'RdYlGn'
});
```

### 5. CompanyDetailView
Displays comprehensive company information.

**Sections:**
- Overview (basic info, price, market cap)
- Momentum metrics (all momentum scores)
- Financials (revenue, profit, margins)
- Valuation (PER, PBR, EV/EBITDA)
- Technical indicators (RSI, MACD, Bollinger)
- News & sentiment

**Usage:**
```javascript
const detailView = new CompanyDetailView();
detailView.render(container, companyData);
```

### 6. CompanyComparison
Side-by-side comparison of multiple companies.

**Features:**
- Compare up to 5 companies
- Metric normalization
- Visual comparison charts
- Relative performance
- Export comparison results

**Usage:**
```javascript
const comparison = new CompanyComparison();
comparison.addCompany(company1);
comparison.addCompany(company2);
comparison.render(container);
```

### 7. M_Company (Main Module)
Orchestrates all components and provides the main API.

**Core Features:**
- Data loading and management
- Component coordination
- Event handling
- State management
- Auto-update capability
- Export functionality

**Usage:**
```javascript
// Initialize
const momentum = new M_Company({
    autoUpdate: true,
    updateInterval: 60000,
    theme: 'light'
});

// Load data
await momentum.loadData(stockData);

// Apply filters
momentum.applyFilter('momentum', { min: 50 });

// Sort results
momentum.sortBy('momentum.total', 'desc');

// Render
momentum.render(document.getElementById('container'));
```

## Integration with Stock Analyzer

### 1. HTML Setup
Add the module scripts to your HTML:

```html
<!-- Momentum Modules -->
<script src="./modules/Momentum/MomentumCalculator.js"></script>
<script src="./modules/Momentum/RankingEngine.js"></script>
<script src="./modules/Momentum/FilterEngine.js"></script>
<script src="./modules/Momentum/MomentumVisualizer.js"></script>
<script src="./modules/Momentum/CompanyDetailView.js"></script>
<script src="./modules/Momentum/CompanyComparison.js"></script>
<script src="./modules/Momentum/M_Company.js"></script>
```

### 2. JavaScript Initialization
Initialize in your main JavaScript file:

```javascript
// In your init function
if (window.M_Company) {
    window.momentumCompany = new window.M_Company({
        autoUpdate: true,
        updateInterval: 60000,
        theme: 'light'
    });

    // Load data
    await window.momentumCompany.loadData(allData);

    // Render to container
    window.momentumCompany.render(container);
}
```

### 3. Event Handling
Listen to module events:

```javascript
// Company selected
window.momentumCompany.on('companySelected', (company) => {
    console.log('Selected:', company);
});

// Filter changed
window.momentumCompany.on('filterChanged', (filters) => {
    console.log('Filters:', filters);
});

// Data updated
window.momentumCompany.on('dataUpdated', (data) => {
    console.log('Updated data:', data);
});
```

## Configuration Options

```javascript
const config = {
    // Display options
    theme: 'light' | 'dark',
    language: 'ko' | 'en',

    // Update options
    autoUpdate: true | false,
    updateInterval: 60000, // milliseconds

    // Visualization options
    charts: {
        heatmap: { enabled: true, colorScheme: 'RdYlGn' },
        sparkline: { enabled: true, width: 100, height: 30 }
    },

    // Ranking options
    ranking: {
        method: 'percentile', // standard, percentile, zscore, decile
        ascending: false
    },

    // Filter options
    filters: {
        showAdvanced: true,
        saveUserFilters: true
    }
};
```

## API Reference

### M_Company Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `loadData(data)` | Load company data | Array of company objects | Promise |
| `applyFilter(type, criteria)` | Apply filter | Filter type and criteria | Filtered data |
| `sortBy(field, order)` | Sort companies | Field name, 'asc' or 'desc' | Sorted data |
| `getTopCompanies(n)` | Get top N companies | Number | Array of companies |
| `exportData(format)` | Export data | 'csv', 'json', or 'excel' | Blob |
| `render(container)` | Render UI | DOM element | void |
| `showDetailView(company)` | Show company details | Company object | void |
| `showComparison(companies)` | Show comparison | Array of companies | void |

### Events

| Event | Description | Payload |
|-------|-------------|---------|
| `dataLoaded` | Data loaded successfully | `{ count: number, data: array }` |
| `companySelected` | Company selected | Company object |
| `filterChanged` | Filter applied | Filter criteria |
| `sortChanged` | Sort order changed | `{ field: string, order: string }` |
| `exportCompleted` | Export completed | `{ format: string, size: number }` |
| `error` | Error occurred | Error object |

## Testing

### Unit Tests
Run the test suite:

```bash
# Open test page
python test_momentum_server.py
# Navigate to: http://localhost:8002/test_momentum_modules.html
```

### Integration Tests
Test integration with main application:

```bash
# Open integration test
http://localhost:8002/test_integration.html
```

## Performance Considerations

1. **Data Loading**: The module can handle up to 10,000 companies efficiently
2. **Rendering**: Virtual scrolling is implemented for large datasets
3. **Updates**: Debounced updates prevent excessive re-rendering
4. **Memory**: Unused data is automatically cleaned up

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Dependencies

- No external dependencies (vanilla JavaScript)
- Optional: Chart.js for advanced visualizations
- Optional: D3.js for heatmaps

## License

This module is part of the 100xFenok Stock Analyzer project.

## Support

For issues or questions, please refer to the main project documentation or create an issue in the project repository.