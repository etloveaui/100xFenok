# Feature Documentation

**Version**: 1.0
**Last Updated**: October 17, 2025

## Table of Contents

1. [Growth Analytics](#growth-analytics)
2. [Ranking System](#ranking-system)
3. [Data Quality Assessment](#data-quality-assessment)
4. [Advanced Filters](#advanced-filters)
5. [Deep Compare](#deep-compare)
6. [Smart Analytics](#smart-analytics)
7. [Portfolio Builder](#portfolio-builder)

---

## Growth Analytics

### Overview

Growth Analytics module analyzes company growth rates across multiple time periods and metrics, enabling investors to identify high-growth opportunities and assess business momentum.

**Data Source**: T_Growth_C.csv (1,252 companies, Quality Score: 92.8/100)

### Features

#### 1. Growth Rate Analysis

**Available Metrics**:

| Metric | 7-Year | 3-Year | Description |
|--------|--------|--------|-------------|
| Sales | Sales (7) | Sales (3) | Revenue compound annual growth rate |
| Operating Profit | OP (7) | OP (3) | Operating income growth rate |
| EPS | EPS (7) | EPS (3) | Earnings per share growth rate |
| ROE | ROE (Fwd) | - | Return on equity (forward) |
| OPM | OPM (Fwd) | - | Operating profit margin (forward) |

**Growth Rate Interpretation**:
- **>30%**: Exceptional growth (high-growth tech)
- **20-30%**: Strong growth (growth stocks)
- **10-20%**: Moderate growth (quality companies)
- **5-10%**: Steady growth (mature businesses)
- **0-5%**: Slow growth (value stocks)
- **<0%**: Declining (turnaround candidates)

#### 2. Company Growth Profile

**How to Access**:
1. Click on any company in the screening table
2. Navigate to Growth Analytics tab
3. View growth chart and detailed metrics

**Chart Visualization**:
- Bar chart comparing 6 growth metrics
- Color-coded by metric type
- Interactive tooltips with exact values
- Export to PNG functionality

**Data Display**:
```
Sales (7y): +25.3%  |  Sales (3y): +28.1%
OP (7y):    +18.7%  |  OP (3y):    +22.4%
EPS (7y):   +31.2%  |  EPS (3y):   +35.6%
ROE (Fwd):  +16.8%  |  OPM (Fwd):  +21.3%
```

#### 3. Sector Average Comparison

**Functionality**:
- Calculates average growth by sector (WI26 classification)
- Compares individual company vs sector average
- Identifies sector leaders and laggards

**Sector Growth Dashboard**:
```
Sector: Semiconductors
- Companies: 47
- Avg Sales Growth (7y): 22.4%
- Avg OP Growth (7y): 18.9%
- Avg EPS Growth (7y): 24.1%
```

**Chart Type**: Grouped bar chart
- Top 10 sectors by company count
- Three metrics per sector
- Sortable by any metric

#### 4. High-Growth Filtering

**Filter Parameters**:
- **Threshold**: Minimum growth rate (%)
- **Metric**: sales, op, or eps
- **Period**: 7-year or 3-year

**Example Usage**:
```javascript
getHighGrowthCompanies(threshold=20, metric='sales', period='7y')
// Returns companies with 7-year sales growth >20%
```

**Results Include**:
- Ticker symbol
- Company name
- Sector classification
- Growth rate
- Market capitalization
- Sorted by growth rate (highest first)

### Use Cases

**1. Growth Stock Screening**:
- Filter companies with EPS growth >20%
- Compare 7-year vs 3-year trends
- Identify accelerating growth

**2. Sector Rotation**:
- Find highest growth sectors
- Compare sector averages
- Identify sector winners

**3. Fundamental Analysis**:
- Verify growth consistency
- Check profit margin expansion
- Assess quality of growth

**4. Due Diligence**:
- Compare company claims vs data
- Verify management guidance
- Check growth sustainability

### Limitations

**Data Coverage**:
- 1,252 companies (subset of full database)
- Growth rates are historical (not predictive)
- Forward metrics (ROE, OPM) are estimates

**Data Quality Considerations**:
- Some companies have incomplete data (shown as N/A)
- Growth rates >100% may indicate base effects
- Negative growth requires context (restructuring, one-time charges)

### Best Practices

**Interpreting Growth Rates**:
1. Compare 7-year vs 3-year for trends
2. Check all three metrics (Sales, OP, EPS)
3. Verify growth quality (margins improving?)
4. Consider sector context

**Red Flags**:
- Sales growth but declining margins
- EPS growth faster than sales (unsustainable)
- Inconsistent growth (volatile)
- High growth with high debt

**Green Flags**:
- Consistent growth across all metrics
- Expanding margins (OP > Sales)
- Growth acceleration (3y > 7y)
- Sector-leading performance

---

## Ranking System

### Overview

Multi-metric ranking engine that scores and sorts companies based on various financial indicators, enabling systematic stock screening.

**Implementation Status**: Sprint 4 (Planned)

### Ranking Methods

#### 1. Single Metric Ranking

**Available Metrics**:
- ROE (Return on Equity)
- ROA (Return on Assets)
- OPM (Operating Profit Margin)
- Sales Growth (7y, 3y)
- EPS Growth (7y, 3y)
- PER (Price to Earnings Ratio)
- PBR (Price to Book Ratio)
- Dividend Yield
- Market Cap

**How It Works**:
1. Select metric from dropdown
2. Choose ascending or descending order
3. System ranks all 1,250 companies
4. Display top N (configurable: 10, 25, 50, 100)

**Example Output**:
```
ROE Ranking (Top 10):
1. Company A - 32.5%
2. Company B - 28.7%
3. Company C - 26.3%
...
```

#### 2. Multi-Metric Ranking

**Composite Scoring**:
- Combine multiple metrics
- Assign weights to each metric
- Calculate weighted composite score
- Rank by composite score

**Default Weights** (Quality Score):
- ROE: 25%
- OPM: 20%
- Sales Growth (3y): 20%
- EPS Growth (3y): 20%
- PBR: 15% (inverted - lower is better)

**Custom Weights**:
Users can create custom ranking formulas:
```
Value Score = (ROE × 0.3) + (1/PER × 0.4) + (Div Yield × 0.3)
Growth Score = (Sales 3y × 0.4) + (EPS 3y × 0.6)
```

#### 3. Sector-Relative Ranking

**Concept**: Rank companies within their sector

**Why It Matters**:
- Different sectors have different norms
- Tech has higher PER, utilities have higher dividend
- Fair comparison within peer group

**Implementation**:
```
1. Group companies by WI26 sector
2. Calculate sector average for each metric
3. Score = (Company Value - Sector Avg) / Sector StdDev
4. Rank by normalized score
```

**Example**:
```
Technology Sector ROE Ranking:
1. NVDA - ROE: 35% (2.3 std dev above avg)
2. AAPL - ROE: 28% (1.8 std dev above avg)
3. MSFT - ROE: 25% (1.5 std dev above avg)
```

#### 4. Decile Ranking

**Purpose**: Divide universe into 10 equal groups (deciles)

**Use Case**: Portfolio construction, factor investing

**Methodology**:
1. Sort companies by metric
2. Divide into 10 groups (each ~125 companies)
3. Decile 1 = Top 10%, Decile 10 = Bottom 10%

**Application**:
- Long-short strategies (buy D1, short D10)
- Factor exposure analysis
- Risk stratification

### Ranking Dashboard

**UI Components**:

1. **Ranking Selector**:
   - Dropdown: Choose ranking method
   - Checkboxes: Select metrics (multi-metric mode)
   - Sliders: Set weights
   - Button: Calculate rankings

2. **Results Table**:
   - Rank | Ticker | Company | Score | Metrics
   - Color-coded by decile
   - Sortable columns
   - Export to CSV

3. **Visualization**:
   - Bar chart: Top 20 companies
   - Histogram: Score distribution
   - Scatter plot: Score vs Market Cap

### Industry Ranking

**Purpose**: Compare sectors/industries on aggregate metrics

**Aggregation Methods**:
- Mean: Average of all companies
- Median: Middle value (less affected by outliers)
- Weighted: By market cap

**Sector Comparison**:
```
Sector          | Avg ROE | Avg Growth | Avg PER
----------------|---------|------------|--------
Semiconductors  | 22.3%   | 18.5%      | 28.4
Software        | 18.7%   | 24.1%      | 35.2
Healthcare      | 14.2%   | 12.3%      | 22.1
```

### Custom Ranking Creation

**Step-by-Step**:

1. **Select Metrics** (2-5 recommended):
   - Click checkboxes for desired metrics
   - Mix valuation, growth, quality

2. **Set Weights**:
   - Drag sliders or enter percentages
   - Must sum to 100%
   - Higher weight = more importance

3. **Preview Top 10**:
   - System shows immediate results
   - Adjust weights if needed

4. **Save Ranking**:
   - Name your ranking formula
   - Save for future use
   - Share with others (export JSON)

5. **Apply to Screening**:
   - Use ranking as filter
   - Example: "Top 50 by my custom score"

### Use Cases

**Value Investing**:
- Rank by low PER + high dividend + ROE
- Find undervalued quality stocks

**Growth Investing**:
- Rank by EPS growth + Sales growth + ROE
- Identify fastest growing companies

**Quality Investing**:
- Rank by ROE + OPM + consistent earnings
- Find business quality leaders

**Momentum Investing**:
- Rank by price momentum + volume + growth
- Capture trending stocks

---

## Data Quality Assessment

### Overview

Systematic evaluation of data completeness, accuracy, and reliability across all 21 CSV files.

**Quality Score Formula**:
```
Quality Score = (1 - Null Rate) × 100
Where Null Rate = (Null Values / Total Values)
```

### Quality Tiers

**S Tier (90-100%)**: Excellent quality, reliable for all analysis
- M_Company: 91.0%
- T_Growth_C: 92.8%
- T_Rank: 93.6%
- T_EPS_C: 93.4%
- T_CFO: 92.9%
- A_Company: 93.8%

**A Tier (70-89%)**: Good quality, minor gaps acceptable
- T_Chk: 86.2%
- M_ETFs: 66.5%

**B Tier (50-69%)**: Moderate quality, use with caution
- T_Growth_H: 51.2%
- T_EPS_H: 54.9%
- A_Contrast: 50.2%

**C Tier (30-49%)**: Low quality, significant gaps
- E_Indicators: 33.5%
- UP_&_Down: 31.6%
- S_Chart: 44.0%

**D Tier (<30%)**: Poor quality, major data issues
- A_Compare: 9.1%
- T_Correlation: 13.9%
- A_Distribution: 23.7%
- T_Chart: 25.8%
- A_ETFs: 0.0%

### Data Reliability Indicators

**In the UI**:
- **Green checkmark**: High quality data (>90%)
- **Yellow warning**: Moderate quality (50-90%)
- **Red alert**: Low quality (<50%)
- **"N/A"**: Data not available for this company

**Tooltip Information**:
Hover over data cells to see:
- Data source file
- Last update date
- Quality score
- Missing value count

### Handling Missing Data

**Application Strategy**:

1. **Exclude from Calculations**:
   - N/A values don't affect averages
   - Filters skip missing data
   - Rankings only use available data

2. **Interpolation** (where appropriate):
   - Time series: Forward fill
   - Cross-sectional: Sector average
   - Conservative approach

3. **User Notification**:
   - Warning icon on incomplete profiles
   - Footnote on charts with missing data
   - Data quality badge on company cards

**Example**:
```
Company A Profile:
✅ Financial Metrics (28/32 available)
⚠️ Growth Metrics (4/6 available - missing OP 7y, EPS 7y)
❌ Correlation Data (0/42 available)
```

### Data Update Frequency

**Update Schedule**:
- Weekly: M_Company, T_Growth_C, T_Rank, T_EPS_C
- Bi-weekly: Sector averages, rankings
- Monthly: Historical data (T_Growth_H, T_EPS_H)
- Quarterly: Economic indicators

**Last Update Display**:
- Header shows global last update
- Individual metrics show specific dates
- Update log available in settings

---

## Advanced Filters

### Overview

Sophisticated filtering system supporting complex queries with multiple conditions, logical operators, and saved presets.

### Filter Types

#### 1. Range Filters

**Numeric Ranges**:
- Market Cap: $0 - $1T+
- PER: -100 to 500
- PBR: 0 to 50
- ROE: -50% to 100%
- Dividend Yield: 0% to 20%
- Price: $0 to $10,000

**How to Use**:
```
Min: [___]  Max: [___]
Examples:
- PER between 10 and 20: Min=10, Max=20
- Market Cap > $1B: Min=1000, Max=(blank)
- ROE > 15%: Min=15, Max=(blank)
```

**Special Values**:
- Blank Min = No lower limit
- Blank Max = No upper limit
- Both blank = No filter on this metric

#### 2. Category Filters

**Multi-Select Dropdowns**:

**Exchange** (12 options):
- NASDAQ, NYSE, AMEX (US)
- LSE, FTSE (UK)
- TSE (Japan)
- KOSPI, KOSDAQ (Korea)
- And more...

**Sector** (26 WI26 categories):
- Technology (Software, Hardware, Semiconductors)
- Finance (Banks, Insurance, Real Estate)
- Healthcare (Pharma, Biotech, Devices)
- Consumer (Retail, Food, Automotive)
- Industry (Manufacturing, Construction)
- Energy (Oil, Gas, Renewables)
- Materials (Chemicals, Metals, Mining)
- Telecom, Utilities, and more...

**How to Use**:
1. Click dropdown to open
2. Check boxes for desired options
3. Selected items appear as tags below
4. Click X on tag to remove
5. Select "All" to include everything

#### 3. Boolean Filters

**On/Off Toggles**:
- Profitable Only (Net Income > 0)
- Positive Cash Flow (CFO > 0)
- Dividend Paying (Yield > 0)
- Large Cap Only (Market Cap > $10B)

**How It Works**:
- Toggle ON: Filter applied
- Toggle OFF: No filter
- Combines with other filters using AND logic

#### 4. Composite Filters (QVM)

**Quality**:
- ROE > 15%
- Debt/Equity < 2.0
- Consistent earnings (positive 3 years)
- Operating margin > 10%

**Value**:
- PER < 15
- PBR < 3
- EV/EBITDA < 10
- Dividend yield > 2%

**Momentum**:
- 52-week high proximity > 80%
- Volume increasing
- Price above 200-day MA
- Positive price momentum

**How to Activate**:
- Click Q, V, or M button
- Multiple can be active simultaneously
- Shows number of companies matching

### Filter Logic

**AND Operator** (Default):
```
Exchange=NASDAQ AND PER<15 AND ROE>15%
Returns: Companies meeting ALL three conditions
```

**Combining Categories**:
```
(Exchange=NASDAQ OR Exchange=NYSE) AND Sector=Technology
Returns: Tech stocks on NASDAQ or NYSE
```

**Range Combinations**:
```
PER: 10-20 AND PBR: 1-3 AND ROE: >15%
Returns: Reasonably valued, quality companies
```

### Preset Filters

**Built-In Presets**:

1. **NASDAQ Tech Leaders**:
   - Exchange: NASDAQ
   - Sector: Technology, Software, Semiconductors
   - Market Cap: >$1B
   - ROE: >15%

2. **Value Stocks**:
   - PER: <15
   - PBR: <3
   - Dividend Yield: >2%
   - ROE: >10%

3. **High Growth**:
   - Sales Growth (3y): >20%
   - EPS Growth (3y): >15%
   - ROE: >15%

4. **Dividend Aristocrats**:
   - Dividend Yield: >3%
   - Payout Ratio: <70%
   - Dividend growth: Consistent

5. **Large Cap Stable**:
   - Market Cap: >$10B
   - Beta: 0.7-1.3
   - ROE: >12%
   - Dividend Yield: >1%

**Custom Presets**:
1. Configure filters as desired
2. Click "현재 필터 저장" (Save Current Filters)
3. Name your preset
4. Access from dropdown

**Sharing Presets**:
- Export as JSON file
- Import others' presets
- Community preset library (planned)

### Filter Performance

**Optimization**:
- Indexed filtering (<100ms for 6,175 companies)
- Lazy loading for large result sets
- Client-side caching
- Progressive rendering

**Result Limits**:
- Display top 1,000 matches
- Pagination: 25, 50, 100 per page
- Full export available (CSV)

### Advanced Techniques

**Negative Screening**:
- Exclude sectors: Deselect in dropdown
- Exclude exchange: Leave unchecked
- Exclude range: Set narrow bounds

**Relative Filtering**:
- Above sector average: Use sector comparison
- Top decile: Use ranking filter
- Relative valuation: PER < Sector Avg PER

**Time-Based Filtering** (Planned):
- 52-week high/low proximity
- Recent performance (1M, 3M, 6M)
- Trend analysis (improving/declining)

---

## Deep Compare

### Overview

Interactive comparison tool for detailed side-by-side analysis of up to 4 companies, sectors, or markets.

**Features**:
- Drag-and-drop interface
- 79 comparison metrics
- Visual charts (radar, bar, bubble)
- Strength/weakness analysis
- Export reports

### Getting Started

**How to Access**:
1. Click "기업 비교 (DeepCompare)" button
2. Or right-click company → "Add to comparison"
3. Or select multiple in table → "Compare selected"

**Interface Layout**:
- Left Panel: Search and selection
- Center Panel: Comparison slots (max 4)
- Bottom Panel: Comparison results

### Comparison Modes

#### 1. Company Comparison

**Purpose**: Compare individual stocks

**Process**:
1. Search for company (name or ticker)
2. Drag company card to comparison slot
3. Repeat for up to 4 companies
4. View comparison results below

**Metrics Compared** (79 total):

**Valuation** (8):
- PER, PBR, PSR, EV/EBITDA
- Price to Cash Flow, Price to Free Cash Flow
- PEG Ratio, Dividend Yield

**Profitability** (12):
- ROE, ROA, ROIC
- Operating Margin, Net Margin, Gross Margin
- Asset Turnover, Inventory Turnover
- And more...

**Growth** (12):
- Sales Growth (1y, 3y, 5y, 7y)
- EPS Growth (1y, 3y, 5y, 7y)
- Book Value Growth, Asset Growth

**Financial Strength** (10):
- Debt/Equity, Current Ratio, Quick Ratio
- Interest Coverage, Debt/EBITDA
- Cash Flow/Debt, And more...

**Others** (37):
- Market data, sector position, momentum
- Technical indicators, analyst ratings
- Ownership structure, etc.

#### 2. Sector Comparison

**Purpose**: Compare industry performance

**How It Works**:
1. Select "업종 비교" (Sector Comparison) mode
2. Choose sectors from dropdown (up to 4)
3. System calculates sector aggregates
4. Compare on same 79 metrics

**Aggregation Methods**:
- **Median**: Typical company in sector
- **Mean**: Average of all companies
- **Weighted**: By market cap (favors large caps)

**Example Output**:
```
Technology vs Healthcare vs Finance vs Energy

ROE:        22.3%    14.2%     12.1%    8.5%
PER:        28.4     22.1      13.2     11.3
Growth 3y:  18.5%    12.3%     8.7%     -2.1%
Companies:  247      156       389      92
```

#### 3. Market Comparison

**Purpose**: Compare exchanges or geographic markets

**Markets Available**:
- US (NASDAQ, NYSE, AMEX combined)
- Korea (KOSPI, KOSDAQ combined)
- Japan (TSE)
- UK (LSE, FTSE)
- Europe (aggregated)
- China (Shanghai, Shenzhen)

**Comparison Insights**:
- Valuation differences (US premium vs Korea)
- Growth rates by region
- Dividend policies
- Market maturity indicators

### Visualization

#### 1. Comparison Table

**Layout**:
```
Metric         | Company A | Company B | Company C | Company D
---------------|-----------|-----------|-----------|----------
PER            | 25.3      | 18.7      | 32.1      | 12.4
ROE            | 22.5%     | 18.3%     | 28.7%     | 14.2%
Growth (3y)    | 18.2%     | 12.1%     | 24.5%     | 8.3%
```

**Features**:
- Color coding (green = best, red = worst)
- Sortable by any metric
- Click metric for definition
- Expandable categories

#### 2. Radar Chart

**Purpose**: Multi-dimensional comparison

**Dimensions** (customizable, default 6):
- Valuation (lower PER = better)
- Growth (higher = better)
- Profitability (ROE, margins)
- Financial Strength (low debt, high cash)
- Dividend (yield, growth)
- Momentum (price trend)

**Interpretation**:
- Larger area = Better overall
- Lopsided shape = Specialized strength
- Overlap = Similar profiles

#### 3. Bar Chart

**Purpose**: Metric-by-metric comparison

**Layout**: Grouped bars
- Each metric = group of 4 bars (one per company)
- Color-coded by company
- Hover for exact values

**Use Case**: Identify specific strengths/weaknesses

#### 4. Bubble Chart

**Purpose**: Visualize 3 dimensions simultaneously

**Axes** (customizable):
- X-axis: Valuation (PER, PBR)
- Y-axis: Growth (Sales, EPS)
- Size: Market Cap
- Color: Sector or Performance

**Example**:
- Find high-growth, reasonably-valued stocks (top-left)
- Identify value traps (bottom-left)
- Spot overvalued growth (top-right)

### Analysis Features

#### Strength/Weakness Matrix

**Automated Analysis**:
System identifies for each company:
- **Top 3 Strengths**: Metrics where company excels
- **Top 3 Weaknesses**: Metrics lagging peers
- **Unique Advantages**: Only this company has it

**Example Output**:
```
Company A:
Strengths:
  1. ROE (28.7% vs avg 18.2%) - Top 10%
  2. EPS Growth (24.5% vs avg 15.3%)
  3. Operating Margin (32.1% vs avg 22.7%)

Weaknesses:
  1. PER (32.1 vs avg 22.4) - Overvalued?
  2. Debt/Equity (1.8 vs avg 1.2)
  3. Dividend Yield (0.5% vs avg 2.1%)
```

#### Recommendation Score

**Calculation**:
```
Score = Σ (Metric Score × Metric Weight)
Where:
  Metric Score = (Company Value - Peer Avg) / Peer StdDev
  Weights sum to 100%
```

**Categories**:
- **Strong Buy**: Score > 2.0
- **Buy**: Score 1.0 to 2.0
- **Hold**: Score -1.0 to 1.0
- **Sell**: Score < -1.0

**Customization**:
- Adjust metric weights
- Choose comparison peer group
- Set scoring thresholds

### Use Cases

**Investment Decision**:
1. Add finalist stocks to comparison
2. Review all 79 metrics
3. Identify best risk/reward
4. Make informed decision

**Due Diligence**:
1. Compare company claims vs peers
2. Verify "industry-leading" assertions
3. Check for hidden weaknesses
4. Validate investment thesis

**Portfolio Rebalancing**:
1. Compare current holdings
2. Identify redundant positions
3. Find better alternatives
4. Optimize allocation

**Sector Rotation**:
1. Compare sector metrics
2. Identify top-performing sectors
3. Allocate to sector leaders
4. Monitor relative performance

---

## Smart Analytics

### Overview

AI-powered analytics module using machine learning algorithms for pattern recognition, momentum scoring, and predictive insights.

**Status**: Sprint 3 (Implemented)
**Algorithms**: Momentum scoring, anomaly detection, clustering

### Momentum Scoring

**Purpose**: Quantify stock price and volume momentum

**Algorithm**:
```
Momentum Score = Weighted Average of:
  - Price Trend (30%): 1M, 3M, 6M, 12M returns
  - Volume Trend (20%): Relative volume vs average
  - Financial Strength (25%): ROE, margin trends
  - Sector Performance (15%): Relative to sector
  - Market Sentiment (10%): Beta, volatility
```

**Score Range**: 0-100
- **90-100**: Extreme bullish momentum
- **70-89**: Strong momentum
- **50-69**: Moderate momentum
- **30-49**: Weak momentum
- **0-29**: Negative momentum

**Use Cases**:
- Identify trending stocks
- Momentum trading strategies
- Breakout detection
- Reversal warnings

**How to Access**:
1. Click "AI 스마트 분석" button
2. Select companies or leave blank for all
3. View momentum scores and rankings
4. Click company for detailed breakdown

**Detailed Breakdown**:
```
Company A - Momentum Score: 78

Price Trend (30%):     85 → Strong uptrend
  - 1M:  +8.2%
  - 3M:  +18.5%
  - 6M:  +32.1%
  - 12M: +45.7%

Volume Trend (20%):    72 → Increasing interest
  - Rel Volume: 1.4x average
  - Volume MA: Rising

Financial Strength (25%): 82 → Improving fundamentals
  - ROE Trend: +2.3 pp YoY
  - Margin Trend: +1.5 pp YoY

Sector Performance (15%): 65 → Sector neutral
  - vs Sector: +5.2%

Market Sentiment (10%): 70 → Positive
  - Beta: 1.15 (slightly aggressive)
  - Volatility: 22% (moderate)
```

### Pattern Recognition

**Detected Patterns**:

1. **Breakout**:
   - Price above 52-week high
   - Volume surge (>2x average)
   - Strong momentum score (>75)

2. **Reversal**:
   - Momentum divergence (price up, momentum down)
   - Volume climax
   - Overbought/oversold indicators

3. **Consolidation**:
   - Narrow price range
   - Decreasing volatility
   - Building base

4. **Trend Continuation**:
   - Higher highs, higher lows
   - Increasing volume on up days
   - Strong momentum maintained

**How to View**:
- Pattern badge on company cards
- Pattern filter in screening
- Pattern alerts (planned)

### Anomaly Detection

**Purpose**: Identify unusual behavior requiring attention

**Anomalies Detected**:

1. **Price Anomalies**:
   - Sudden spike (>10% in one day)
   - Gap up/down (>5%)
   - Unusual volatility

2. **Volume Anomalies**:
   - Volume spike (>3x average)
   - Unusually low volume (<0.3x average)
   - Volume divergence

3. **Financial Anomalies**:
   - Margin compression
   - ROE decline
   - Debt increase
   - Cash burn acceleration

4. **Valuation Anomalies**:
   - PER disconnect from growth (PEG > 2 or < 0.5)
   - Sector relative extremes (>2 std dev)
   - Historical valuation extremes

**Alerts**:
- ⚠️ Yellow: Moderate anomaly, monitor
- 🚨 Red: Significant anomaly, investigate

**Example**:
```
🚨 Company B - Price Anomaly Detected
Price surge: +15.3% on 3.5x volume
No news catalyst identified
PER expanded from 22 to 25
Action: Review fundamentals for justification
```

### Clustering Analysis

**Purpose**: Group similar companies for comparison and insights

**Clustering Methods**:

1. **Fundamental Clustering**:
   - K-means on financial metrics
   - Groups by valuation, growth, quality
   - Identify peer companies

2. **Performance Clustering**:
   - Cluster by return patterns
   - Correlation analysis
   - Portfolio diversification insights

3. **Sector Micro-Clustering**:
   - Sub-sector identification
   - Niche player detection
   - Competitive positioning

**Use Cases**:
- Find comparable companies
- Diversification analysis
- Sector sub-group analysis
- Peer group construction

**How to Access**:
1. Smart Analytics → Clustering tab
2. Choose clustering method
3. View cluster map
4. Explore companies in each cluster

**Output Example**:
```
Cluster 1: High Growth Tech (32 companies)
- Avg Growth: 28.5%
- Avg PER: 35.2
- Avg ROE: 22.7%
- Representative: Company A, Company B

Cluster 2: Value Industrials (47 companies)
- Avg Growth: 8.3%
- Avg PER: 12.4
- Avg ROE: 14.2%
- Representative: Company C, Company D
```

### Predictive Indicators (Planned - Sprint 11)

**Feature Overview**:
- Machine learning models
- Price movement prediction
- Earnings surprise forecasting
- Bankruptcy risk scoring

**Disclaimer**: All AI insights are informational only, not investment advice

---

## Portfolio Builder

### Overview

Comprehensive portfolio construction and management tool with optimization algorithms, risk analysis, and performance tracking.

**Status**: Sprint 3 (Implemented)
**Features**: Drag-and-drop, optimization, rebalancing, risk metrics

### Creating a Portfolio

**Step 1: Add Holdings**

**Method A - Drag and Drop**:
1. Search for companies in screening tab
2. Drag company cards to portfolio area
3. Drop to add holding

**Method B - Direct Add**:
1. Click "포트폴리오에 추가" button in company modal
2. Or right-click company → "Add to portfolio"

**Method C - Bulk Import**:
1. Click "Import" in portfolio tab
2. Paste tickers (one per line or comma-separated)
3. System adds all valid tickers

**Step 2: Set Allocations**

**Manual Allocation**:
- Enter percentage for each holding
- Must sum to 100%
- Real-time validation

**Equal Weight**:
- Click "Equal Weight" button
- Automatically distributes 100% / N holdings

**Market Cap Weight**:
- Click "Cap Weight" button
- Allocates by market capitalization

**Custom Weight**:
- Set min/max constraints per holding
- Click "Optimize" for best allocation

**Step 3: Set Parameters**

**Risk Tolerance**:
- Conservative: Lower volatility, higher cash
- Moderate: Balanced approach
- Aggressive: Higher volatility, growth focus

**Time Horizon**:
- Short (<1 year): Liquidity, low volatility
- Medium (1-5 years): Balanced
- Long (>5 years): Growth focus, accept volatility

**Investment Goal**:
- Growth: Capital appreciation
- Income: Dividend yield
- Balanced: Mix of growth and income

**Step 4: Review and Save**

- Review portfolio summary
- Check risk metrics (see Risk Analysis section)
- Save portfolio with name
- Export to CSV/PDF

### Optimization

**Purpose**: Find optimal allocation to maximize returns for given risk level

**Optimization Algorithms**:

1. **Mean-Variance Optimization** (Markowitz):
   - Maximize return for target volatility
   - Or minimize volatility for target return
   - Classic modern portfolio theory

2. **Risk Parity**:
   - Equal risk contribution from each holding
   - Diversification focus
   - Reduced concentration risk

3. **Maximum Sharpe Ratio**:
   - Best risk-adjusted returns
   - Optimal growth portfolio
   - Standard benchmark

4. **Minimum Variance**:
   - Lowest possible volatility
   - Conservative approach
   - Capital preservation

**How to Optimize**:
1. Add holdings to portfolio
2. Set any constraints (min/max % per holding)
3. Choose optimization method
4. Click "최적화" (Optimize)
5. Review suggested allocations
6. Accept or modify

**Example Output**:
```
Optimization: Maximum Sharpe Ratio
Expected Return: 12.3% annually
Expected Volatility: 15.2%
Sharpe Ratio: 0.81

Suggested Allocations:
- Company A: 25% (was 20%)
- Company B: 22% (was 25%)
- Company C: 18% (was 20%)
- Company D: 15% (was 15%)
- Company E: 20% (was 20%)

Changes: Increased A, decreased B, kept others
```

### Risk Analysis

**Portfolio Risk Metrics**:

**1. Volatility** (Standard Deviation):
- Measures portfolio return fluctuation
- Annualized percentage
- Lower = Less risk
- Typical range: 10-30% for stock portfolios

**2. Sharpe Ratio**:
```
Sharpe = (Portfolio Return - Risk Free Rate) / Volatility
```
- Measures risk-adjusted return
- Higher = Better risk/reward
- >1.0 is good, >2.0 is excellent
- Compare to benchmark

**3. Beta**:
- Market correlation (typically S&P 500)
- 1.0 = Moves with market
- <1.0 = Less volatile (defensive)
- >1.0 = More volatile (aggressive)

**4. Correlation Matrix**:
- Shows correlation between holdings
- -1 = Perfect negative correlation
- 0 = No correlation
- +1 = Perfect positive correlation
- Goal: Low correlation for diversification

**5. Value at Risk (VaR)**:
- Maximum loss at confidence level
- Example: "95% VaR = -5%" means 95% chance loss won't exceed 5%
- Helps set stop-loss levels

**6. Maximum Drawdown**:
- Largest peak-to-trough decline
- Historical worst-case scenario
- Psychological preparation

**Diversification Metrics**:

**1. Sector Concentration**:
```
Technology:    35% ⚠️ High concentration
Finance:       25%
Healthcare:    20%
Consumer:      15%
Industrial:    5% ⚠️ Under-represented
```
- Goal: No sector >30%
- At least 5-6 sectors

**2. Geographic Diversification**:
```
US:            70%
Europe:        15%
Asia:          10%
Emerging:      5%
```
- Reduces country-specific risk
- Currency diversification

**3. Market Cap Diversification**:
```
Large Cap:     60%
Mid Cap:       30%
Small Cap:     10%
```
- Balance stability and growth
- Reduce size bias

**4. Herfindahl Index**:
- Measures concentration
- 0 = Perfect diversification
- 1 = Single holding (maximum concentration)
- Target: <0.15 for well-diversified portfolio

### Rebalancing

**Purpose**: Maintain target allocations as prices change

**Rebalancing Triggers**:
1. **Drift Threshold**:
   - Any holding > 5% from target
   - Example: Target 20%, Current 26%
   - Action: Sell 6% to rebalance

2. **Time-Based**:
   - Quarterly (recommended)
   - Semi-annually
   - Annually

3. **Volatility Trigger**:
   - Portfolio vol exceeds target
   - Major market moves
   - Risk level change

**Rebalancing Process**:
1. Click "Rebalance" button
2. System calculates drift
3. Shows buy/sell suggestions
4. Review transaction costs
5. Execute trades

**Tax Considerations** (Informational):
- Rebalancing triggers capital gains
- Consider tax-advantaged accounts
- Harvest losses opportunistically
- Defer gains when possible

### Performance Tracking

**Performance Metrics**:

**1. Total Return**:
- Capital gains + dividends
- Time-weighted return
- Money-weighted return (IRR)

**2. Benchmark Comparison**:
- vs S&P 500
- vs custom benchmark
- Alpha (excess return)
- Information ratio

**3. Contribution Analysis**:
```
Company A:  +2.5% (30% of total return)
Company B:  +1.8% (22% of total return)
Company C:  -0.5% (-6% of total return)
```
- Identify best/worst performers
- Understand return sources

**4. Risk-Adjusted Return**:
- Sharpe Ratio over time
- Sortino Ratio (downside deviation)
- Treynor Ratio (beta-adjusted)

**Charts and Reports**:
- Equity curve (portfolio value over time)
- Drawdown chart
- Rolling returns (3M, 6M, 1Y, 3Y)
- Sector attribution
- Performance vs benchmark

**Export Options**:
- CSV: Holdings, transactions, performance
- PDF: Full portfolio report
- JSON: Portfolio configuration

---

**Document Version**: 1.0
**Last Updated**: October 17, 2025
**Application Version**: Sprint 4
