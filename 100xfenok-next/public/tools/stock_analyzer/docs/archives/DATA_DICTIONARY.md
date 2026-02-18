# Data Dictionary

**Version**: 1.0
**Last Updated**: October 17, 2025
**Total Files**: 21 CSV files
**Total Records**: 18,721 rows
**Data Source**: Global Scouter

## Table of Contents

1. [File Categories](#file-categories)
2. [Main Files](#main-files-m_)
3. [Technical Files](#technical-files-t_)
4. [Analysis Files](#analysis-files-a_)
5. [Market Files](#market-files-s_)
6. [Economic Indicators](#economic-indicators-e_)
7. [Data Quality Reference](#data-quality-reference)
8. [Column Naming Conventions](#column-naming-conventions)

---

## File Categories

### Main (M_) - Core Company Data
- M_Company.csv: Primary company dataset (6,178 companies)
- M_ETFs.csv: Momentum ETF data (30 records)

### Technical (T_) - Technical Analysis & Metrics
- 9 files covering growth, EPS, cash flow, rankings, etc.
- 1,252-1,266 companies per file

### Analysis (A_) - Comparative Analysis
- 4 files for company comparisons, distributions, contrasts
- 115-1,252 records per file

### Market (S_) - Market & Screener Data
- 4 files for valuations, charts, watch lists
- 21-121 records per file

### Economic (E_) - Economic Indicators
- 1 file with 1,032 economic metrics

---

## Main Files (M_)

### M_Company.csv

**Description**: Primary company database with fundamental financial metrics and market data

**Records**: 6,178 companies
**Columns**: 34
**Quality Score**: 91.0/100
**Update Frequency**: Weekly

**Column Definitions**:

| Column | Type | Description | Example | Unit |
|--------|------|-------------|---------|------|
| Ticker | String | Stock ticker symbol | "AAPL" | - |
| Corp | String | Company name | "Apple Inc." | - |
| corpName | String | Full legal name | "Apple Inc." | - |
| Exchange | String | Listing exchange | "NASDAQ" | - |
| WI26 | String | Sector (26 categories) | "Technology" | - |
| Price | Float | Current stock price | 178.50 | USD |
| (USD mn) | Float | Market capitalization | 2847500 | Million USD |
| PER | Float | Price to Earnings Ratio | 28.4 | Ratio |
| PBR | Float | Price to Book Ratio | 7.2 | Ratio |
| PSR | Float | Price to Sales Ratio | 7.8 | Ratio |
| PFCR | Float | Price to Free Cash Flow | 24.5 | Ratio |
| PCR | Float | Price to Cash Flow Ratio | 22.1 | Ratio |
| PEG | Float | PEG Ratio (PER/Growth) | 1.8 | Ratio |
| EV/EBITDA | Float | Enterprise Value to EBITDA | 24.2 | Ratio |
| ROE | Float | Return on Equity | 147.4 | Percent (%) |
| ROA | Float | Return on Assets | 27.5 | Percent (%) |
| ROIC | Float | Return on Invested Capital | 45.2 | Percent (%) |
| OPM | Float | Operating Profit Margin | 30.2 | Percent (%) |
| NPM | Float | Net Profit Margin | 25.3 | Percent (%) |
| GPM | Float | Gross Profit Margin | 43.8 | Percent (%) |
| Div Yield | Float | Dividend Yield | 0.52 | Percent (%) |
| Payout | Float | Dividend Payout Ratio | 15.2 | Percent (%) |
| Debt/Equity | Float | Debt to Equity Ratio | 1.74 | Ratio |
| Current Ratio | Float | Current Assets / Current Liabilities | 0.94 | Ratio |
| Quick Ratio | Float | (Current Assets - Inventory) / Current Liabilities | 0.82 | Ratio |
| Interest Coverage | Float | EBIT / Interest Expense | 85.4 | Ratio |
| Asset Turnover | Float | Sales / Total Assets | 1.09 | Ratio |
| Beta | Float | Market correlation coefficient | 1.24 | Coefficient |
| 52W High | Float | 52-week high price | 199.62 | USD |
| 52W Low | Float | 52-week low price | 124.17 | USD |
| Volume | Int | Average daily volume | 50234567 | Shares |
| Shares Out | Float | Shares outstanding | 15728700000 | Shares |
| Float | Float | Free float shares | 15500000000 | Shares |
| Momentum | Float | Proprietary momentum score | 72.5 | 0-100 scale |

**Data Quality Notes**:
- 9% missing values (typical for smaller companies)
- PER can be negative (loss-making companies)
- Very high/low values may be outliers
- Momentum score calculated weekly

**Common Values**:
- Exchange: NASDAQ (2,847), NYSE (2,103), KOSPI (689), KOSDAQ (312)
- WI26 Sectors: 26 unique sectors (see Technical Files section)

---

### M_ETFs.csv

**Description**: Momentum-based ETF tracking data

**Records**: 30 ETFs
**Columns**: 44
**Quality Score**: 66.5/100
**Update Frequency**: Weekly

**Key Columns**:
- ETF Ticker
- Name
- Assets Under Management (AUM)
- Expense Ratio
- Holdings Count
- Top 10 Holdings
- Sector Allocation
- Performance Metrics (1M, 3M, 6M, 1Y, 3Y)
- Momentum Score

**Use Cases**:
- Sector ETF comparison
- Passive investment options
- Benchmark construction
- Market trends

---

## Technical Files (T_)

### T_Growth_C.csv

**Description**: Current period growth rates (7-year and 3-year)

**Records**: 1,252 companies
**Columns**: 50
**Quality Score**: 92.8/100
**Update Frequency**: Weekly
**Implementation**: Sprint 4 (Completed)

**Key Metrics**:

| Column | Description | Period | Interpretation |
|--------|-------------|--------|----------------|
| Sales (7) | Sales CAGR | 7 years | Long-term revenue growth |
| Sales (3) | Sales CAGR | 3 years | Recent revenue growth |
| OP (7) | Operating Profit CAGR | 7 years | Long-term profit growth |
| OP (3) | Operating Profit CAGR | 3 years | Recent profit growth |
| EPS (7) | Earnings Per Share CAGR | 7 years | Long-term earnings growth |
| EPS (3) | Earnings Per Share CAGR | 3 years | Recent earnings growth |
| ROE (Fwd) | Forward ROE | Next year | Expected profitability |
| OPM (Fwd) | Forward Operating Margin | Next year | Expected margin |

**Growth Rate Scale**:
- **>30%**: Exceptional (high-growth tech)
- **20-30%**: Strong (growth stocks)
- **10-20%**: Moderate (quality companies)
- **5-10%**: Steady (mature businesses)
- **<5%**: Slow (value stocks)
- **Negative**: Declining (turnaround candidates)

**Additional Columns**:
- Asset Growth (7y, 3y)
- Book Value Growth (7y, 3y)
- Sales Growth by segment
- Geographic revenue growth
- Margin expansion rates

---

### T_Growth_H.csv

**Description**: Historical growth rates (time series)

**Records**: 55 companies
**Columns**: 21
**Quality Score**: 51.2/100
**Update Frequency**: Monthly
**Implementation**: Sprint 4 (Time series charts)

**Structure**:
- Annual growth rates for past 10 years
- Rolling 3-year and 5-year averages
- Growth acceleration/deceleration indicators

**Use Cases**:
- Trend analysis
- Growth consistency evaluation
- Forecast validation
- Historical context

---

### T_Rank.csv

**Description**: Multi-metric ranking data

**Records**: 1,252 companies
**Columns**: 38
**Quality Score**: 93.6/100
**Update Frequency**: Weekly
**Implementation**: Sprint 4 (Planned)

**Ranking Metrics**:

| Rank Type | Description | Range | Best |
|-----------|-------------|-------|------|
| ROE Rank | Return on Equity ranking | 1-1252 | 1 |
| Growth Rank | Composite growth score | 1-1252 | 1 |
| Value Rank | Valuation attractiveness | 1-1252 | 1 |
| Quality Rank | Business quality score | 1-1252 | 1 |
| Momentum Rank | Price & volume momentum | 1-1252 | 1 |
| Dividend Rank | Dividend quality & yield | 1-1252 | 1 |
| Sector Rank | Rank within sector | 1-N | 1 |
| Size Decile | Market cap grouping | 1-10 | - |
| Value Decile | Valuation grouping | 1-10 | 1 |
| Growth Decile | Growth rate grouping | 1-10 | 10 |

**Composite Scores**:
- Overall Rank: Weighted combination of all metrics
- Investment Score: Risk-adjusted ranking
- Factor Scores: Value, Growth, Quality, Momentum

**Usage**:
- Top performers by category
- Multi-factor screening
- Relative valuation analysis
- Portfolio construction

---

### T_EPS_C.csv

**Description**: Current EPS metrics and forecasts

**Records**: 1,252 companies
**Columns**: 41
**Quality Score**: 93.4/100
**Update Frequency**: Weekly
**Implementation**: Sprint 5 (Planned)

**Key Metrics**:

| Column | Description | Unit | Notes |
|--------|-------------|------|-------|
| EPS (TTM) | Trailing 12-month EPS | USD/share | Actual earnings |
| EPS (FY0) | Current fiscal year EPS | USD/share | Estimate |
| EPS (FY1) | Next fiscal year EPS | USD/share | Estimate |
| EPS (FY2) | Two years forward EPS | USD/share | Estimate |
| EPS Growth (TTM) | YoY growth rate | Percent | Historical |
| EPS Growth (FY1) | Expected growth | Percent | Forecast |
| EPS Surprise | Actual vs estimate | Percent | Beat/miss |
| EPS Consistency | Earnings stability | Score 0-100 | Higher = more stable |
| EPS Quality | Earnings quality score | Score 0-100 | Cash vs accrual |

**Advanced Metrics**:
- Core EPS (excluding one-time items)
- Diluted EPS (fully diluted shares)
- Normalized EPS (adjusted for cycles)
- Free Cash Flow per share
- Dividend per share

**Forecast Data**:
- Consensus estimates (mean, median)
- Analyst count
- Estimate dispersion (standard deviation)
- Recent estimate revisions

---

### T_EPS_H.csv

**Description**: Historical EPS time series

**Records**: 55 companies
**Columns**: 22
**Quality Score**: 54.9/100
**Update Frequency**: Quarterly
**Implementation**: Sprint 5

**Structure**:
- Quarterly EPS for past 10 years (40 quarters)
- Annual EPS for past 10 years
- Rolling metrics

**Use Cases**:
- Earnings trend analysis
- Seasonal patterns
- Earnings surprise history
- Growth consistency

---

### T_CFO.csv

**Description**: Cash Flow from Operations metrics

**Records**: 1,266 companies
**Columns**: 36
**Quality Score**: 92.9/100
**Update Frequency**: Quarterly
**Implementation**: Sprint 5 (Planned)

**Key Metrics**:

| Metric | Description | Formula | Importance |
|--------|-------------|---------|------------|
| CFO | Cash from Operations | From cash flow statement | Core cash generation |
| FCF | Free Cash Flow | CFO - CapEx | Available for distribution |
| CFO Margin | CFO / Sales | CFO / Revenue × 100 | Cash conversion efficiency |
| FCF Yield | FCF / Market Cap | FCF / Market Cap × 100 | Valuation metric |
| CFO/NI | Cash vs accrual earnings | CFO / Net Income | Earnings quality |
| Working Capital | Current Assets - Current Liabilities | From balance sheet | Liquidity |
| Cash Conversion Cycle | DSO + DIO - DPO | Days | Efficiency |

**Growth Metrics**:
- CFO Growth (1y, 3y, 5y, 7y)
- FCF Growth (1y, 3y, 5y, 7y)
- CapEx as % of sales
- Maintenance vs growth CapEx

**Quality Indicators**:
- CFO/NI Ratio: >1.0 is good (cash > accrual)
- FCF Consistency: Positive FCF in 8/10 years
- CFO Margin: >15% is excellent
- Cash Conversion: <60 days is good

---

### T_Chk.csv

**Description**: Investment checklist (78 quality criteria)

**Records**: 1,252 companies
**Columns**: 78
**Quality Score**: 86.2/100
**Update Frequency**: Monthly
**Implementation**: Sprint 7 (Planned)

**Checklist Categories**:

**1. Profitability** (15 checks):
- ROE > 15%
- ROE > Industry average
- Positive net income (3 consecutive years)
- Improving margins
- ROIC > WACC

**2. Growth** (12 checks):
- Sales growth > 10%
- EPS growth > 10%
- Growth acceleration (3y > 7y)
- Market share gains
- Geographic expansion

**3. Financial Strength** (18 checks):
- Debt/Equity < 2.0
- Current ratio > 1.5
- Interest coverage > 5x
- Positive FCF
- Increasing cash balance

**4. Valuation** (10 checks):
- PER < Industry average
- PEG < 1.5
- PBR < 3.0
- Discount to intrinsic value > 20%
- Improving valuation (PER decreasing)

**5. Dividend** (8 checks):
- Dividend yield > 2%
- Payout ratio < 70%
- Dividend growth > 5% annually
- Consistent dividends (no cuts in 10 years)

**6. Management** (8 checks):
- Insider ownership > 1%
- Share buybacks (value-accretive)
- Low management turnover
- Aligned compensation

**7. Competitive Position** (7 checks):
- Market leadership
- Brand strength
- Pricing power
- Barriers to entry

**Usage**:
- Quality filter: Pass ≥50 checks
- High quality: Pass ≥60 checks
- Institutional grade: Pass ≥65 checks

---

### T_Correlation.csv

**Description**: Inter-company correlation matrix

**Records**: 1,251 companies
**Columns**: 42
**Quality Score**: 13.9/100 ⚠️ (Low quality)
**Update Frequency**: Monthly
**Implementation**: Sprint 6 (After data cleaning)

**Metrics**:
- Price correlation (daily, weekly, monthly)
- Return correlation (1M, 3M, 6M, 12M)
- Volatility correlation

**Use Cases**:
- Portfolio diversification
- Hedging strategies
- Pair trading
- Risk management

**Data Quality Issues**:
- 86.1% missing values
- Requires data cleaning before use
- Limited to liquid stocks

---

### T_Chart.csv

**Description**: Technical chart data points

**Records**: 90 companies
**Columns**: 80
**Quality Score**: 25.8/100 ⚠️ (Low quality)
**Update Frequency**: Daily
**Implementation**: Sprint 10+ (Optional)

**Data Includes**:
- OHLC (Open, High, Low, Close) prices
- Volume data
- Technical indicators (MA, RSI, MACD, Bollinger Bands)
- Support/resistance levels

---

## Analysis Files (A_)

### A_Company.csv

**Description**: Analysis subset of companies (premium dataset)

**Records**: 1,252 companies
**Columns**: 52
**Quality Score**: 93.8/100
**Update Frequency**: Weekly
**Implementation**: Sprint 6

**Additional Data vs M_Company**:
- Detailed segment breakdowns
- Geographic revenue split
- Product line analysis
- Customer concentration
- Supplier relationships
- Regulatory environment
- ESG scores
- Analyst coverage

**Use Cases**:
- Deep fundamental analysis
- Investment reports
- Due diligence
- Competitive intelligence

---

### A_Compare.csv

**Description**: Side-by-side company comparison data

**Records**: 495 comparison pairs
**Columns**: 79
**Quality Score**: 9.1/100 ⚠️ (Very low quality)
**Update Frequency**: Weekly
**Implementation**: Sprint 7 (After data cleaning)

**Comparison Metrics** (when data available):
All 79 metrics from DeepCompare feature
- Valuation: PER, PBR, PSR, EV/EBITDA, etc.
- Profitability: ROE, ROA, margins
- Growth: Sales, EPS, asset growth
- Financial strength: Debt, liquidity, coverage
- Efficiency: Turnover ratios
- Market data: Price, volume, momentum

**Data Quality Issues**:
- 90.9% missing values
- Requires significant data cleaning
- Use M_Company as primary source

---

### A_Contrast.csv

**Description**: Contrast analysis (strengths vs weaknesses)

**Records**: 115 companies
**Columns**: 98
**Quality Score**: 50.2/100
**Update Frequency**: Monthly
**Implementation**: Sprint 7

**Analysis Framework**:
- Strengths matrix (40 metrics)
- Weaknesses matrix (40 metrics)
- Peer comparison (18 metrics)

**Strength Indicators**:
- Market position (market share, brand)
- Financial performance (margins, returns)
- Growth trajectory
- Innovation (R&D, patents)
- Management quality

**Weakness Indicators**:
- Competitive threats
- Financial risks (debt, liquidity)
- Operational challenges
- Regulatory issues
- Market headwinds

---

### A_Distribution.csv

**Description**: Statistical distributions of financial metrics

**Records**: 1,177 companies
**Columns**: 61
**Quality Score**: 23.7/100 ⚠️ (Low quality)
**Update Frequency**: Monthly
**Implementation**: Sprint 8 (After data cleaning)

**Distribution Metrics**:

For each key metric (PER, PBR, ROE, etc.):
- Percentiles: 1st, 5th, 10th, 25th, 50th, 75th, 90th, 95th, 99th
- Mean, Median, Mode
- Standard Deviation
- Skewness, Kurtosis
- Min, Max
- Outlier detection

**Use Cases**:
- Relative valuation (where does company fall in distribution?)
- Outlier identification
- Fair value estimation
- Benchmarking

---

### A_ETFs.csv

**Description**: ETF holdings and characteristics

**Records**: 491 ETFs
**Columns**: 151
**Quality Score**: 0.0/100 ⚠️ (No valid data)
**Update Frequency**: Weekly
**Implementation**: Under review (data source issue)

**Expected Data** (when fixed):
- ETF details (name, ticker, AUM, expense ratio)
- Holdings (top 10-50 stocks)
- Sector/geographic allocation
- Performance metrics
- Risk metrics
- Tracking error vs benchmark

---

## Market Files (S_)

### S_Mylist.csv

**Description**: User watch list / screener results

**Records**: 21 companies
**Columns**: 59
**Quality Score**: 92.6/100
**Update Frequency**: User-defined

**Contents**:
- Selected company fundamentals
- Custom notes/tags
- Target prices
- Alerts/triggers
- Research links

**Use Cases**:
- Personal stock watch list
- Saved screening results
- Investment ideas tracking

---

### S_Valuation.csv

**Description**: Valuation analysis models

**Records**: 36 companies
**Columns**: 48
**Quality Score**: 90.9/100
**Update Frequency**: Monthly

**Valuation Methods**:

**1. DCF (Discounted Cash Flow)**:
- FCF projections (5-10 years)
- Terminal value
- WACC (Weighted Average Cost of Capital)
- Fair value estimate

**2. Relative Valuation**:
- PER vs peers
- PBR vs peers
- EV/EBITDA vs sector
- PEG ratio analysis

**3. Asset-Based**:
- Book value
- Tangible book value
- Replacement value
- Liquidation value

**4. Dividend Discount Model**:
- Expected dividends
- Growth rate
- Required return
- Intrinsic value

**Outputs**:
- Fair value range (low, base, high)
- Upside/downside %
- Margin of safety
- Recommendation (Buy/Hold/Sell)

---

### S_Chart.csv

**Description**: Chart snapshots for key companies

**Records**: 121 companies
**Columns**: 82
**Quality Score**: 44.0/100
**Update Frequency**: Daily

**Technical Data**:
- Price action (OHLC)
- Volume profile
- Moving averages (20, 50, 100, 200 day)
- Momentum indicators (RSI, MACD, Stochastic)
- Volatility (Bollinger Bands, ATR)
- Pattern recognition flags

---

## Economic Indicators (E_)

### E_Indicators.csv

**Description**: Macroeconomic indicators database

**Records**: 1,032 indicators
**Columns**: 68
**Quality Score**: 33.5/100 ⚠️ (Low quality)
**Update Frequency**: Monthly/Quarterly
**Implementation**: Sprint 10 (After data cleaning)

**Indicator Categories**:

**1. Economic Growth** (120 indicators):
- GDP (nominal, real, per capita)
- Industrial production
- Manufacturing PMI
- Retail sales
- Consumer spending

**2. Inflation** (85 indicators):
- CPI (headline, core)
- PPI (producer prices)
- PCE (personal consumption)
- Import/export prices
- Wage growth

**3. Employment** (95 indicators):
- Unemployment rate
- Job creation
- Labor force participation
- Average hourly earnings
- Initial claims

**4. Interest Rates** (110 indicators):
- Federal Funds Rate
- Treasury yields (2Y, 5Y, 10Y, 30Y)
- Corporate bond yields
- Mortgage rates
- Swap rates

**5. Credit Markets** (98 indicators):
- Credit spreads
- Junk bond yields
- Bank lending standards
- Loan growth
- Debt levels

**6. Currencies** (87 indicators):
- USD Index
- Major currency pairs (EUR/USD, USD/JPY, etc.)
- Real effective exchange rates
- Currency volatility

**7. Commodities** (95 indicators):
- Oil (WTI, Brent)
- Gold, silver, copper
- Agricultural commodities
- Commodity indices (CRB, GSCI)

**8. Housing** (76 indicators):
- Home prices (Case-Shiller, FHFA)
- Housing starts
- Building permits
- Existing home sales
- Mortgage applications

**9. Consumer Sentiment** (54 indicators):
- Conference Board Consumer Confidence
- University of Michigan Sentiment
- Expectations indices

**10. International** (212 indicators):
- Global GDP
- Emerging market indicators
- Country-specific data
- Trade balances
- Current account

**Data Quality Notes**:
- 66.5% missing values (many indicators have limited history)
- Different update frequencies
- Revisions common
- Use only well-populated indicators initially

**Use Cases**:
- Macro dashboard
- Economic cycle analysis
- Sector allocation (cyclical vs defensive)
- Risk-on/risk-off signals
- Correlation with stock performance

---

## Data Quality Reference

### Quality Tiers Summary

| Tier | Score Range | Files | Reliability | Usage |
|------|-------------|-------|-------------|-------|
| S | 90-100% | 6 files | Excellent | All analysis |
| A | 70-89% | 2 files | Good | Most analysis |
| B | 50-69% | 5 files | Moderate | With caution |
| C | 30-49% | 3 files | Low | Limited use |
| D | 0-29% | 5 files | Poor | Needs cleaning |

### Data Update Schedule

| Frequency | Files | Last Update Shown |
|-----------|-------|-------------------|
| Daily | S_Chart, T_Chart | In application header |
| Weekly | M_Company, T_Growth_C, T_Rank, T_EPS_C, T_CFO | Header + file metadata |
| Bi-weekly | Rankings, Sector averages | Computed on-demand |
| Monthly | T_Growth_H, T_EPS_H, E_Indicators | File timestamp |
| Quarterly | A_Distribution, S_Valuation | File timestamp |

### Missing Value Handling

**Application Logic**:
1. **Display**: Show as "N/A" or "-"
2. **Calculations**: Exclude from averages, min/max
3. **Filtering**: Treat as "no match" (excluded)
4. **Sorting**: Place at end (ascending) or beginning (descending)
5. **Charts**: Skip data point or interpolate (user setting)

### Data Sources

**Primary Source**: Global Scouter (Bloomberg terminal alternative)
**Supplementary Sources**:
- Company filings (10-K, 10-Q, 8-K)
- Exchange data feeds
- Economic databases (FRED, IMF, World Bank)
- Analyst estimates (consensus)

### Data Validation

**Automated Checks**:
- Range validation (e.g., PBR shouldn't be negative)
- Consistency checks (Market Cap = Price × Shares Out)
- Outlier detection (>3 std dev from mean)
- Time series coherence (no sudden unexplained jumps)

**Quality Monitoring**:
- Weekly quality score recalculation
- Null value tracking
- Data completeness dashboard
- User-reported issues

---

## Column Naming Conventions

### Abbreviations

| Abbreviation | Full Term | Description |
|--------------|-----------|-------------|
| Corp | Corporation | Company name |
| Ticker | Stock Symbol | Exchange ticker |
| WI26 | MSCI World Industry (26 sectors) | Sector classification |
| PER | Price to Earnings Ratio | Valuation metric |
| PBR | Price to Book Ratio | Valuation metric |
| PSR | Price to Sales Ratio | Valuation metric |
| PFCR | Price to Free Cash Flow Ratio | Valuation metric |
| PCR | Price to Cash Flow Ratio | Valuation metric |
| PEG | Price/Earnings to Growth | Growth-adjusted valuation |
| EV | Enterprise Value | Market cap + debt - cash |
| EBITDA | Earnings Before Interest, Tax, Depreciation, Amortization | Operating profitability |
| ROE | Return on Equity | Profitability metric |
| ROA | Return on Assets | Asset efficiency |
| ROIC | Return on Invested Capital | Capital efficiency |
| OPM | Operating Profit Margin | Operating efficiency |
| NPM | Net Profit Margin | Bottom-line profitability |
| GPM | Gross Profit Margin | Production efficiency |
| Div Yield | Dividend Yield | Income return |
| CapEx | Capital Expenditures | Investment in assets |
| CFO | Cash Flow from Operations | Operating cash generation |
| FCF | Free Cash Flow | Cash available for distribution |
| TTM | Trailing Twelve Months | Last 12 months of data |
| FY0/FY1/FY2 | Fiscal Year 0/1/2 | Current/next/following year |
| YoY | Year over Year | Annual comparison |
| QoQ | Quarter over Quarter | Quarterly comparison |

### Suffixes

| Suffix | Meaning | Example |
|--------|---------|---------|
| (7) | 7-year metric | Sales (7) = 7-year CAGR |
| (3) | 3-year metric | EPS (3) = 3-year CAGR |
| (Fwd) | Forward/future | ROE (Fwd) = Next year estimate |
| (TTM) | Trailing 12 months | EPS (TTM) = Last 12 months |
| _H | Historical | T_Growth_H = Historical growth |
| _C | Current | T_Growth_C = Current growth |
| _Avg | Average | Sector_Avg = Sector average |
| _Rank | Ranking | ROE_Rank = ROE ranking |
| _Score | Calculated score | Momentum_Score |

### Units

| Unit | Display | Example |
|------|---------|---------|
| USD | Dollar amount | Price: $178.50 |
| USD mn | Million dollars | Market Cap: $2,847,500 mn |
| % | Percentage | ROE: 28.5% |
| Ratio | Pure number | PER: 22.4 |
| Shares | Share count | Volume: 50,234,567 |
| bps | Basis points | Yield: 250 bps (2.5%) |

---

## FAQ Data Questions

**Q: Why are some metrics shown as "N/A"?**
A: Data may be unavailable for several reasons:
- Company doesn't report this metric
- Metric not applicable (e.g., dividend for non-dividend stock)
- Data quality issue (excluded as unreliable)
- Recent IPO (insufficient history)

**Q: Can PER be negative?**
A: Yes, if the company has negative earnings (loss). A negative PER means the company is unprofitable. Some investors filter these out; others seek turnaround opportunities.

**Q: How often is data updated?**
A: See Data Update Schedule table above. Most critical data (M_Company, growth, rankings) updated weekly.

**Q: Which data files should I rely on most?**
A: S Tier files (Quality >90%):
- M_Company: Primary source
- T_Growth_C: Growth analysis
- T_Rank: Rankings
- T_EPS_C: Earnings analysis
- T_CFO: Cash flow analysis
- A_Company: Deep analysis

**Q: What should I do if I find incorrect data?**
A: Report via:
1. Flag icon in application
2. Email to data@example.com
3. Include ticker, metric, expected value, and source

**Q: Are analyst estimates included?**
A: Yes, in T_EPS_C (forward EPS), S_Valuation (DCF assumptions), and A_Company (coverage data).

**Q: Can I export raw data?**
A: Yes, use Export function in screening table. Exports to CSV with all visible columns.

---

**Document Version**: 1.0
**Total Metrics Documented**: 500+
**Last Review**: October 17, 2025
