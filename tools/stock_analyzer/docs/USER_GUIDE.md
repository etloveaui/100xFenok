# Stock Analyzer User Guide

**Version**: 1.0
**Last Updated**: October 17, 2025
**Application**: 100xFenok Stock Analyzer

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Screening Stocks](#screening-stocks)
4. [Analytics Modules](#analytics-modules)
5. [Portfolio Management](#portfolio-management)
6. [Best Practices](#best-practices)
7. [Tips & Tricks](#tips--tricks)

---

## Getting Started

### System Requirements

**Supported Browsers**:
- Chrome 90+ (Recommended)
- Firefox 88+
- Safari 14+
- Edge 90+

**Network**:
- Stable internet connection for initial data load
- Offline mode available after first load (PWA feature)

**Screen Resolution**:
- Minimum: 1280x720
- Recommended: 1920x1080 or higher

### First Launch

1. **Open the Application**
   - Navigate to `stock_analyzer.html` in your browser
   - Or access via deployed URL if available

2. **Initial Data Load**
   - Wait for the loading indicator to complete
   - The system loads 6,175+ companies with 21 CSV datasets
   - First load may take 5-10 seconds depending on connection

3. **Verify Data Load**
   - Check the header shows "1,250 companies" (analyzed dataset)
   - Confirm "Last Updated" date is current
   - Look for data in the screening table

### Navigation Overview

The application has three main tabs:

- **스크리닝** (Screening): Find and filter stocks
- **대시보드** (Dashboard): Visual analytics and insights
- **포트폴리오** (Portfolio): Build and manage portfolios

---

## Dashboard Overview

### Header Statistics

The header displays key metrics:

- **총 기업 수** (Total Companies): 1,250 analyzed companies
- **분석 지표** (Metrics): 32 financial indicators
- **데이터 소스** (Data Source): Global Scouter

### Main Sections

**Screening Tab**:
- Advanced filtering system
- Company comparison tools
- Smart analytics

**Dashboard Tab**:
- Economic indicators
- Momentum heatmap
- Market overview cards
- Sector performance
- Top/Worst performers

**Portfolio Tab**:
- Portfolio builder
- Risk analysis
- Optimization tools

---

## Screening Stocks

### Basic Search

**Search Bar Features**:
1. Enter ticker symbols (e.g., "NVDA")
2. Company names (e.g., "Apple")
3. Sectors (e.g., "반도체" - Semiconductors)
4. Exchanges (e.g., "NASDAQ")

**Auto-Complete**:
- Suggestions appear as you type
- Click suggestion or press Enter to select
- Press "X" button to clear search

### Filter System

#### Investment Strategy Filters (QVM)

Pre-configured filters for common strategies:

**Quality Filters**:
- High ROE (>15%)
- Strong profit margins
- Consistent earnings

**Value Filters**:
- Low PER (<15)
- Low PBR (1-3)
- Undervalued stocks

**Momentum Filters**:
- High price momentum
- Volume increases
- Technical strength

**How to Use**:
1. Click filter button in QVM section
2. Filter activates immediately
3. Results update in table below
4. Combine multiple filters for refined results

#### Range Filters

**Market Cap** (시가총액):
- Small Cap: <$2B
- Mid Cap: $2B-$10B
- Large Cap: >$10B

**PER Range**:
- Growth: >25
- Reasonable: 15-25
- Value: <15

**PBR Range**:
- Deep Value: <1
- Fair Value: 1-3
- Premium: >3

**ROE Range**:
- Excellent: >20%
- Good: 15-20%
- Average: 10-15%
- Poor: <10%

**How to Use Range Filters**:
1. Enter minimum value in left field
2. Enter maximum value in right field
3. Leave blank for no limit
4. Click "필터 적용" (Apply Filters)

#### Category Filters

**Exchange** (거래소):
- NASDAQ: US tech-heavy exchange
- NYSE: US traditional exchange
- KOSPI: Korean main market
- KOSDAQ: Korean tech market

**Sector** (업종):
- Technology: Software, Hardware, Semiconductors
- Finance: Banks, Insurance, Investment
- Healthcare: Pharma, Biotech, Medical Devices
- Industrial: Manufacturing, Construction
- Consumer: Retail, Food & Beverage

**Multi-Select Feature**:
1. Click dropdown box
2. Check multiple options
3. Selected items appear as tags
4. Click "X" on tag to remove
5. Dropdown stays open for multiple selections

### Preset Filters

Quick access to popular strategies:

**📱 나스닥 기술주** (NASDAQ Tech):
- Exchange: NASDAQ
- Sector: Technology, Software, Semiconductors
- Market Cap: >$1B

**💎 저PER 가치주** (Low PER Value):
- PER: <15
- PBR: <3
- ROE: >10%

**💰 고배당 주식** (High Dividend):
- Dividend Yield: >3%
- Payout sustainable
- Stable earnings

**🏢 대형주 안정성** (Large Cap Stability):
- Market Cap: >$10B
- Consistent performance
- Lower volatility

**🚀 고성장 주식** (High Growth):
- Revenue growth: >20%
- EPS growth: >15%
- Strong momentum

**How to Use Presets**:
1. Click preset button
2. Filters apply automatically
3. Modify filters as needed
4. Save custom preset with "현재 필터 저장"

### Advanced Filtering

#### Combining Filters

**AND Logic** (All conditions must match):
- Multiple filters narrow results
- Example: NASDAQ + PER<15 + ROE>15%

**Best Practices**:
- Start broad, refine gradually
- Use presets as starting points
- Monitor result count
- Save successful combinations

#### Filter Status

The filter status bar shows:
- Active filter count
- Result count
- Applied conditions
- Reset option

**Color Coding**:
- Blue: No filters (default)
- Green: Filters active
- Orange: Results limited (<10)
- Red: No results (adjust filters)

---

## Analytics Modules

### Growth Analytics

**Purpose**: Analyze company growth rates over multiple periods

**Available Metrics**:
- Sales Growth (7-year, 3-year)
- Operating Profit Growth (7-year, 3-year)
- EPS Growth (7-year, 3-year)
- ROE Forward
- OPM Forward

**How to Access**:
1. Open company detail modal
2. Navigate to Growth tab
3. View growth chart and metrics

**Interpreting Results**:
- **High Growth** (>20%): Strong expansion
- **Moderate Growth** (10-20%): Steady progress
- **Low Growth** (<10%): Mature company
- **Negative Growth**: Declining business

**Sector Comparison**:
- Compare company vs sector average
- Identify outperformers
- Spot sector trends

### Ranking System

**Purpose**: Rank companies by multiple metrics

**Ranking Methods**:
1. **Single Metric**: Rank by one indicator
2. **Multi-Metric**: Weighted combination
3. **Sector Relative**: Rank within sector
4. **Custom Weighted**: User-defined weights

**Available Rankings**:
- ROE Ranking
- Growth Ranking
- Value Ranking (PER/PBR)
- Momentum Ranking
- Quality Ranking

**How to Use**:
1. Select ranking method
2. Choose metrics (multi-metric mode)
3. Set weights (optional)
4. View ranked results
5. Export to CSV/Excel

### Deep Compare

**Purpose**: Side-by-side comparison of up to 4 companies

**Comparison Features**:
- Financial metrics table
- Visual charts (radar, bar)
- Strength/weakness analysis
- Recommendation scores

**How to Compare**:
1. Click "기업 비교 (DeepCompare)" button
2. Search for companies in left panel
3. Drag companies to comparison slots
4. View comparison results below

**Comparison Modes**:
- **Companies**: Compare individual stocks
- **Sectors**: Compare industry averages
- **Markets**: Compare exchanges/countries

**Chart Types**:
- **Radar Chart**: Multi-dimensional comparison
- **Bar Chart**: Metric-by-metric comparison
- **Bubble Chart**: Size = Market Cap, Color = Performance

### Smart Analytics (AI)

**Purpose**: AI-powered insights and recommendations

**Features**:
- Momentum scoring algorithm
- Pattern recognition
- Anomaly detection
- Predictive indicators

**How to Access**:
1. Click "AI 스마트 분석" button
2. Select companies or sectors
3. Choose analysis type
4. View AI-generated insights

**Momentum Score**:
- Scale: 0-100
- >70: Strong momentum
- 30-70: Neutral
- <30: Weak momentum

**Factors in Momentum**:
- Price trend (30%)
- Volume trend (20%)
- Financial strength (25%)
- Sector performance (15%)
- Market sentiment (10%)

---

## Portfolio Management

### Portfolio Builder

**Purpose**: Create and optimize investment portfolios

**Features**:
- Drag-and-drop interface
- Allocation optimization
- Risk analysis
- Rebalancing suggestions

**Creating a Portfolio**:

1. **Add Holdings**:
   - Search for companies
   - Drag to portfolio area
   - Set allocation percentages
   - Total must equal 100%

2. **Set Parameters**:
   - Risk tolerance (Conservative/Moderate/Aggressive)
   - Time horizon (Short/Medium/Long)
   - Investment goal (Growth/Income/Balanced)

3. **Optimize**:
   - Click "최적화" (Optimize) button
   - System suggests allocations
   - Review risk metrics
   - Accept or modify

### Risk Analysis

**Risk Metrics**:

**Portfolio Volatility**:
- Standard deviation of returns
- Lower = Less risky
- Compare to benchmark

**Sharpe Ratio**:
- Risk-adjusted returns
- Higher = Better risk/reward
- >1.0 is good, >2.0 is excellent

**Beta**:
- Market correlation
- 1.0 = Moves with market
- <1.0 = Less volatile
- >1.0 = More volatile

**Diversification Score**:
- Sector concentration
- Geographic spread
- Asset correlation
- Higher = More diversified

**How to Interpret**:
- Red indicators: High risk areas
- Yellow indicators: Moderate concern
- Green indicators: Acceptable risk

### Portfolio Monitoring

**Performance Tracking**:
- Total return
- Individual holding performance
- Sector contributions
- Time-weighted returns

**Rebalancing Alerts**:
- Drift from target allocation
- Sector overweight/underweight
- Risk level changes
- Rebalancing suggestions

---

## Best Practices

### Stock Screening

**Start Broad, Refine Gradually**:
1. Begin with sector or exchange
2. Add valuation filters
3. Layer quality filters
4. Review manageable results (20-50 stocks)

**Use Multiple Perspectives**:
- Value: PER, PBR, Dividend
- Growth: Revenue, EPS growth
- Quality: ROE, margins, cash flow
- Momentum: Price trends, volume

**Save Successful Screens**:
- Document filter combinations
- Save as custom presets
- Review periodically
- Adapt to market conditions

### Data Analysis

**Compare Within Context**:
- Compare to sector averages
- Consider company size
- Account for business cycle
- Review historical trends

**Look for Consistency**:
- Stable ROE over time
- Predictable earnings
- Consistent growth
- Reliable dividends

**Watch for Red Flags**:
- Declining margins
- Negative cash flow
- High debt levels
- Earnings volatility

### Portfolio Construction

**Diversification Principles**:
- 15-30 stocks for retail investors
- Maximum 5-10% per position
- Spread across 6+ sectors
- Mix of large/mid/small cap

**Risk Management**:
- Set stop-loss levels
- Limit sector concentration
- Monitor correlations
- Rebalance quarterly

**Regular Review**:
- Weekly: Price movements, news
- Monthly: Performance vs benchmark
- Quarterly: Rebalancing needs
- Annually: Strategy adjustment

---

## Tips & Tricks

### Keyboard Shortcuts

- **Enter**: Apply search/filters
- **Esc**: Close modals
- **Tab**: Navigate form fields
- **Ctrl+F**: Browser find in table

### Performance Tips

**Faster Loading**:
- Use preset filters instead of custom
- Limit visible columns ("기본 지표" mode)
- Enable pagination (25-50 rows)
- Close unused modals

**Browser Performance**:
- Use Chrome for best performance
- Clear cache if issues occur
- Disable browser extensions
- Close unused tabs

### Data Quality

**Understanding Data Gaps**:
- "N/A": Data not available
- "-": Not applicable
- "0": Actual zero value
- Blank: Calculation error

**Data Reliability**:
- M_Company: 91% quality (high)
- T_Growth: 93% quality (high)
- T_Rank: 94% quality (high)
- Some datasets have lower quality (see Data Dictionary)

### Troubleshooting

**No Results Showing**:
1. Check filter status bar
2. Reset all filters
3. Verify data loaded (header stats)
4. Refresh browser

**Charts Not Displaying**:
1. Verify browser supports Canvas
2. Check JavaScript enabled
3. Clear browser cache
4. Try different browser

**Slow Performance**:
1. Reduce visible columns
2. Decrease pagination size
3. Clear browser cache
4. Close background applications

**Offline Mode**:
1. Visit site once while online
2. Service worker installs
3. Disconnect internet
4. Reload page (cached data loads)

### Mobile Usage

**Responsive Features**:
- Touch-friendly controls
- Swipe to navigate tables
- Optimized chart sizes
- Simplified layouts

**Mobile Best Practices**:
- Use preset filters
- View fewer columns
- Enable card view (if available)
- Portrait orientation recommended

### Exporting Data

**Export Options**:
1. **Chart Export**:
   - Click "내보내기" on chart cards
   - Saves as PNG image
   - Right-click for more options

2. **Table Export**:
   - Select rows
   - Copy to clipboard
   - Paste in Excel/Sheets

3. **Analysis Export**:
   - "분석 결과 내보내기" button
   - Saves detailed report
   - JSON or PDF format

---

## Getting Help

### Documentation

- **USER_GUIDE.md**: This guide
- **FEATURE_DOCUMENTATION.md**: Detailed feature specs
- **DATA_DICTIONARY.md**: All metrics explained
- **FAQ.md**: Common questions

### Support Resources

**Issue Reporting**:
- Describe problem clearly
- Include browser/version
- Attach screenshot if possible
- Note steps to reproduce

**Feature Requests**:
- Explain use case
- Describe expected behavior
- Suggest implementation (optional)

---

## Next Steps

1. **Learn the Basics**: Complete screening tutorial
2. **Explore Analytics**: Try each module
3. **Build Portfolio**: Create sample portfolio
4. **Master Filters**: Develop custom strategies
5. **Advanced Features**: Deep dive into AI analytics

**Recommended Learning Path**:
1. Week 1: Screening and basic filters
2. Week 2: Growth analytics and ranking
3. Week 3: Deep compare and AI features
4. Week 4: Portfolio builder and optimization

---

**Document Version**: 1.0
**Application Version**: Sprint 4
**Last Review**: October 17, 2025
