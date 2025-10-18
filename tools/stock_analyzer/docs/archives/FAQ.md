# Frequently Asked Questions (FAQ)

**Version**: 1.0
**Last Updated**: October 17, 2025

## Table of Contents

1. [Getting Started](#getting-started)
2. [Data & Metrics](#data--metrics)
3. [Features & Functionality](#features--functionality)
4. [Troubleshooting](#troubleshooting)
5. [Performance & Optimization](#performance--optimization)
6. [Investment Questions](#investment-questions)

---

## Getting Started

### Q: How do I start using the Stock Analyzer?

**A**: Simple 3-step process:
1. Open `stock_analyzer.html` in your browser (Chrome recommended)
2. Wait for data to load (5-10 seconds first time)
3. Start exploring: Use search bar or apply filters

No installation, no login required. Works entirely in your browser.

---

### Q: Do I need to install anything?

**A**: No installation needed. Requirements:
- Modern browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- JavaScript enabled
- Internet connection for first load
- After first visit, works offline (PWA feature)

---

### Q: Why is the first load taking long?

**A**: First load includes:
- 21 CSV files (~15MB total data)
- 6,175+ companies
- Building search indexes
- Calculating metrics

**Normal loading time**: 5-10 seconds on broadband

**If taking >30 seconds**:
- Check internet connection
- Try different browser
- Clear browser cache
- Disable browser extensions

---

### Q: Can I use this offline?

**A**: Yes, with Progressive Web App (PWA) feature:

**How to enable**:
1. Visit site while online (loads all data)
2. Browser installs service worker automatically
3. Click "앱 설치" button if prompted
4. Disconnect internet
5. Reload page → cached data loads

**Limitations**:
- Data won't update until back online
- Some features require live connection (e.g., live prices if implemented)

---

### Q: Is my data private?

**A**: Yes, completely:
- All processing in your browser (client-side)
- No data sent to servers
- No tracking, no cookies
- Portfolios saved in browser local storage only

**To clear data**: Browser settings → Clear site data

---

## Data & Metrics

### Q: How many companies are covered?

**A**: Two levels:
- **Full database**: 6,175+ companies (M_Company.csv)
- **Analyzed dataset**: 1,252 companies (T_Growth, T_Rank, etc.)

The 1,252 analyzed companies have complete fundamental data. The remaining companies have basic info but may lack detailed metrics.

---

### Q: What exchanges are covered?

**A**: Global coverage:
- **US**: NASDAQ (2,847), NYSE (2,103), AMEX
- **Korea**: KOSPI (689), KOSDAQ (312)
- **Other**: LSE, TSE, and more

Filter by exchange in the screening tab.

---

### Q: How often is data updated?

**A**: Update schedule varies:
- **Weekly**: Fundamentals, growth, rankings, EPS, cash flow
- **Daily**: Prices, technical indicators (when available)
- **Monthly**: Historical data, economic indicators
- **Quarterly**: Distributions, valuations

Check header for "Last Updated" date.

---

### Q: Why do some companies show "N/A"?

**A**: Several reasons:
1. **Not applicable**: E.g., no dividend for growth stocks
2. **Insufficient data**: Recent IPOs, small companies
3. **Data quality**: Metric excluded as unreliable
4. **Calculation error**: Denominator zero, negative roots

**Solution**: Use filters to exclude N/A values, or accept that not all data is available for all companies.

---

### Q: Can financial ratios be negative?

**A**: Yes, some can:
- **PER**: Negative if company has losses (negative earnings)
- **ROE**: Negative if equity negative (more debt than assets)
- **EPS**: Negative for loss-making companies
- **Cash Flow**: Negative if burning cash

**Interpretation**: Negative values often signal financial distress, but can also indicate turnaround candidates or growth investments.

---

### Q: What does "Quality Score" mean?

**A**: Data completeness metric:
```
Quality Score = (1 - Null Rate) × 100%
```

**Interpretation**:
- **90-100%**: Excellent (S Tier) - Rely on this
- **70-89%**: Good (A Tier) - Generally reliable
- **50-69%**: Moderate (B Tier) - Use with caution
- **<50%**: Poor (C/D Tier) - Needs cleaning

See each file's quality score in Data Dictionary.

---

### Q: What's the difference between 7-year and 3-year growth?

**A**: Time period perspective:
- **7-year**: Long-term trend, smooths out cyclicality
- **3-year**: Recent trend, shows acceleration/deceleration

**How to interpret**:
- **3y > 7y**: Growth accelerating (positive sign)
- **3y < 7y**: Growth decelerating (caution)
- **Both positive**: Consistent grower
- **Both negative**: Secular decline

---

### Q: How are sector averages calculated?

**A**: By WI26 classification:
1. Group all companies by WI26 sector (26 sectors)
2. Calculate mean or median for each metric
3. Filter outliers (>3 std dev)
4. Weight by market cap (optional)

Used for relative valuation and benchmarking.

---

## Features & Functionality

### Q: How do I compare multiple companies?

**A**: Use DeepCompare feature:
1. Click "기업 비교 (DeepCompare)" button
2. Search for companies in left panel
3. Drag companies to comparison slots (max 4)
4. View comparison table and charts below

**Comparison includes**: 79 metrics, radar chart, bar chart, bubble chart, strength/weakness analysis.

---

### Q: Can I save my screening filters?

**A**: Yes, two ways:

**Built-in presets**:
- Use predefined filters (NASDAQ Tech, Value Stocks, etc.)
- Click button to apply

**Custom presets**:
1. Configure filters as desired
2. Click "현재 필터 저장" (Save Current Filters)
3. Name your preset
4. Access from saved presets dropdown

Presets saved in browser local storage.

---

### Q: How do I export data?

**A**: Multiple export options:

**Screening Table**:
- Select rows → Copy to clipboard → Paste in Excel
- Or use browser print to PDF

**Charts**:
- Click "내보내기" (Export) button on chart cards
- Saves as PNG image
- Or right-click chart → Save image

**Analysis Reports**:
- Click "분석 결과 내보내기" in company modal
- Exports detailed report as JSON or PDF

---

### Q: What does the AI Smart Analytics do?

**A**: AI-powered insights:

**Features**:
1. **Momentum Scoring**: Quantify price/volume momentum (0-100)
2. **Pattern Recognition**: Detect breakouts, reversals, consolidations
3. **Anomaly Detection**: Flag unusual behavior (price spikes, margin compression)
4. **Clustering**: Group similar companies for comparison

**How to use**:
- Click "AI 스마트 분석" button
- Select companies or leave blank for all
- View momentum scores and insights

**Note**: AI insights are informational only, not investment advice.

---

### Q: How does the Portfolio Builder work?

**A**: Four-step process:

**1. Add Holdings**:
- Drag companies from screening
- Or click "포트폴리오에 추가"
- Or bulk import tickers

**2. Set Allocations**:
- Manual % entry
- Or "Equal Weight" button
- Or "Cap Weight" button

**3. Optimize** (optional):
- Choose optimization method (Sharpe, Min Variance, Risk Parity)
- Set constraints (min/max per holding)
- Click "최적화"

**4. Monitor**:
- Track performance
- View risk metrics
- Get rebalancing alerts

---

### Q: Can I analyze sectors instead of individual stocks?

**A**: Yes, in DeepCompare:
1. Switch to "업종 비교" (Sector Comparison) mode
2. Select up to 4 sectors
3. View aggregated sector metrics
4. Compare on same 79 metrics as companies

Shows median, mean, or market-cap-weighted sector values.

---

### Q: What's the difference between view modes?

**A**: Column presets for table display:

| Mode | Columns | Use Case |
|------|---------|----------|
| 기본 지표 | 8 | Quick overview, mobile-friendly |
| 밸류에이션 | 8 | Focus on valuation (PER, PBR, etc.) |
| 수익성 | 6 | Focus on profitability (ROE, margins) |
| 수익률 | 8 | Focus on returns (1M, 3M, 6M, 1Y) |
| 종합 지표 | 15 | Balanced view |
| 전체 지표 | 32 | All available metrics |

More columns = more scrolling. Start with "기본 지표" (Basic).

---

## Troubleshooting

### Q: The application won't load. What should I do?

**A**: Troubleshooting checklist:

**1. Check Browser**:
- Use Chrome 90+ (most tested)
- Ensure JavaScript enabled
- Disable ad blockers temporarily
- Try incognito/private mode

**2. Check Connection**:
- Test internet connection
- Try different network (Wi-Fi vs mobile data)
- Check firewall settings

**3. Clear Cache**:
- Browser settings → Clear site data
- Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

**4. Try Different Browser**:
- If Chrome fails, try Firefox or Edge

**5. Check Console**:
- Press F12 → Console tab
- Look for error messages
- Report errors to support

---

### Q: Filters aren't working. No results shown.

**A**: Common causes:

**Too restrictive filters**:
- Check filter status bar
- Reset one filter at a time
- Use "전체 초기화" (Reset All) button

**Conflicting filters**:
- Example: PER 10-15 AND Growth >30% (may have zero matches)
- Relax one constraint

**Data availability**:
- Some metrics have limited coverage
- Try different metrics

**Bug**:
- Refresh page
- Clear filters and reapply
- Report if persists

---

### Q: Charts are not displaying.

**A**: Solutions:

**1. Browser Compatibility**:
- Charts use HTML5 Canvas
- Ensure browser supports Canvas (all modern browsers do)
- Update browser to latest version

**2. JavaScript Issues**:
- Check browser console (F12) for errors
- Ensure Chart.js library loaded (should be automatic)
- Hard refresh page (Ctrl+Shift+R)

**3. Data Issues**:
- If no data for chart, shows "No data available"
- Check if filtered results include companies with required data

**4. Performance**:
- Too many data points can slow rendering
- Reduce number of companies in chart
- Close other browser tabs

---

### Q: Application is slow on my computer.

**A**: Performance optimization tips:

**Reduce Data Load**:
- Use filters to narrow results
- Enable pagination (25-50 rows)
- Choose "기본 지표" view mode (fewer columns)

**Browser Optimization**:
- Close unused tabs
- Clear browser cache
- Disable browser extensions
- Use Chrome (fastest performance)

**Hardware**:
- Close background applications
- Ensure 4GB+ RAM available
- Consider upgrading to SSD

**Expected Performance**:
- Initial load: 5-10 seconds
- Filtering: <1 second
- Sorting: <500ms
- Chart rendering: 1-2 seconds

---

### Q: Can I use this on mobile?

**A**: Yes, responsive design supports mobile:

**Features**:
- Touch-friendly controls
- Swipe to scroll tables
- Optimized layouts
- Simplified views

**Best Practices**:
- Use portrait orientation
- Use preset filters (easier than custom)
- View fewer columns (기본 지표 mode)
- Use card view if available

**Limitations**:
- Smaller screen = less data visible
- Some complex features better on desktop (DeepCompare, Portfolio Builder)

---

### Q: I found a bug. How do I report it?

**A**: Bug reporting process:

**Information to Include**:
1. **Browser & Version**: Chrome 120, Firefox 118, etc.
2. **Operating System**: Windows 11, macOS 14, etc.
3. **Steps to Reproduce**:
   - What you did
   - What you expected
   - What actually happened
4. **Screenshot**: If applicable
5. **Console Errors**: F12 → Console tab → copy errors

**Where to Report**:
- GitHub Issues (if open source)
- Email: support@example.com
- In-app feedback button

---

## Performance & Optimization

### Q: How can I make filtering faster?

**A**: Optimization strategies:

**Filter Efficiently**:
- Use preset filters (pre-optimized)
- Apply category filters first (exchange, sector)
- Then add range filters
- Avoid very wide ranges

**Reduce Result Set**:
- More filters = faster (smaller result set)
- Pagination helps (25-50 rows)

**Technical**:
- Application uses indexed filtering (<100ms for 6,175 companies)
- Client-side caching for repeat queries
- Lazy loading for large result sets

---

### Q: Why do some features take longer to load?

**A**: Feature complexity varies:

**Fast** (<1 second):
- Basic filtering
- Sorting
- Search
- Pagination

**Moderate** (1-3 seconds):
- Chart generation
- Company detail modal
- Sector averages

**Slow** (3-10 seconds):
- DeepCompare (complex calculations)
- Portfolio optimization (algorithms)
- Smart Analytics (AI processing)
- Momentum scoring (all 1,252 companies)

**First-time load**: Always slower (building indexes)
**Subsequent**: Cached, much faster

---

### Q: Can I speed up the initial data load?

**A**: Limited options (data must load):

**Browser**:
- Use Chrome (fastest JavaScript engine)
- Disable browser extensions
- Close unused tabs

**Network**:
- Use broadband (not mobile data)
- Avoid VPN if possible
- Download during off-peak hours

**Progressive Enhancement** (planned Sprint 15):
- Core features load first
- Advanced features load in background
- Better perceived performance

**Current**: 15MB JSON file (all data)
**Future**: Lazy load modules, reduce initial payload

---

## Investment Questions

### Q: Can I use this for day trading?

**A**: Not recommended:
- Data updated weekly (not real-time)
- Focus on fundamental analysis (not technical)
- Best for swing trading or long-term investing

**For day trading**: Need tick-by-tick data, real-time quotes, Level 2 data. This is a fundamental analysis tool.

---

### Q: How should I interpret momentum scores?

**A**: Momentum score (0-100):

**Score Ranges**:
- **90-100**: Extreme bullish (overbought risk)
- **70-89**: Strong momentum (trend following)
- **50-69**: Moderate momentum (neutral)
- **30-49**: Weak momentum (caution)
- **0-29**: Negative momentum (avoid or short)

**Strategy**:
- **Momentum Trading**: Buy >70, sell <30
- **Contrarian**: Buy <30 (oversold), sell >90 (overbought)
- **Combined**: Use with fundamentals for confirmation

**Components**:
- Price trend (30%): Short-term and long-term
- Volume (20%): Relative volume, increasing volume
- Fundamentals (25%): ROE, margin trends
- Sector (15%): Relative sector performance
- Sentiment (10%): Beta, volatility

---

### Q: What's a good PER for a stock?

**A**: Context-dependent:

**General Ranges**:
- **<10**: Very cheap (value or distress)
- **10-15**: Reasonable valuation
- **15-20**: Fair value
- **20-25**: Slightly expensive (growth premium)
- **>25**: Expensive (high growth expectations)

**By Sector**:
- Technology: 25-35 (high growth)
- Utilities: 12-18 (low growth, stable)
- Finance: 10-15 (cyclical)
- Consumer Staples: 15-22 (defensive)

**Better Metric**: PEG Ratio (PER / Growth Rate)
- <1.0: Undervalued relative to growth
- 1.0-1.5: Fair value
- >2.0: Overvalued relative to growth

**Pro Tip**: Always compare to:
1. Historical PER (is it cheap vs its own history?)
2. Sector average (cheap vs peers?)
3. Growth rate (PEG ratio)

---

### Q: How do I find undervalued stocks?

**A**: Multi-step screening process:

**Step 1 - Value Filters**:
- PER < 15 (or < sector average)
- PBR < 3
- PEG < 1.5
- Dividend yield > 2%

**Step 2 - Quality Check**:
- ROE > 10% (profitable)
- Positive cash flow
- Debt/Equity < 2.0 (manageable debt)
- Pass >50 quality checks (T_Chk)

**Step 3 - Growth Verification**:
- Sales growth > 5% (not declining)
- Consistent earnings
- Improving margins

**Step 4 - Manual Review**:
- Read latest earnings report
- Check industry trends
- Understand why it's cheap (value trap vs opportunity)

**Preset Filter**: Use "💎 저PER 가치주" button for quick value screening.

---

### Q: What's the difference between Quality, Value, and Momentum investing?

**A**: Three investment styles:

**Quality Investing**:
- Focus: Business quality (ROE, margins, consistency)
- Filters: ROE >15%, stable earnings, low debt
- Risk: Moderate
- Returns: Steady, long-term
- Examples: Blue chips, industry leaders

**Value Investing**:
- Focus: Price (buy undervalued)
- Filters: Low PER/PBR, high dividend, discount to intrinsic value
- Risk: Higher (value traps exist)
- Returns: Lumpy, requires patience
- Examples: Turnarounds, cyclicals, mature companies

**Momentum Investing**:
- Focus: Trend (buy what's going up)
- Filters: High momentum score, price above MAs, increasing volume
- Risk: High (reversal risk)
- Returns: Can be very high or very low
- Examples: Growth stocks, breakouts, sector rotation

**Combined Approach** (Recommended):
- Quality Value: High ROE + Low PER
- Quality Momentum: High ROE + Strong trend
- Value Momentum: Cheap + Technical reversal

Use QVM filters to combine strategies.

---

### Q: Should I diversify or concentrate my portfolio?

**A**: Depends on goals and risk tolerance:

**Diversification** (15-30 stocks):
- **Pros**: Reduces company-specific risk, smoother returns, easier to sleep at night
- **Cons**: Harder to outperform, requires more research, dilutes winners
- **Best for**: Most investors, especially beginners

**Concentration** (5-10 stocks):
- **Pros**: Easier to research deeply, bigger impact from winners, higher potential returns
- **Cons**: Higher volatility, significant risk if wrong, requires conviction
- **Best for**: Experienced investors with high risk tolerance

**Guidelines**:
1. **Minimum**: 10-15 stocks for adequate diversification
2. **Maximum**: 30-40 stocks (beyond this, you're an index fund)
3. **Per Position**: 3-10% each (no more than 10% in one stock for most investors)
4. **Sectors**: At least 5-6 sectors represented
5. **Review**: Quarterly rebalancing

**Portfolio Builder** tool can help optimize allocation.

---

### Q: How often should I rebalance my portfolio?

**A**: Rebalancing frequency trade-offs:

**Quarterly** (Recommended):
- Good balance between discipline and transaction costs
- Captures significant drifts
- Aligns with earnings season

**Monthly**:
- More active approach
- Higher transaction costs
- Better for volatile portfolios

**Annually**:
- Passive approach
- Minimizes costs
- Risk of excessive drift

**Trigger-Based**:
- Rebalance when any position drifts >5% from target
- Example: Target 20%, current 26% → rebalance

**Tax Considerations**:
- Rebalancing triggers capital gains
- Consider tax-loss harvesting
- Use tax-advantaged accounts when possible

**Portfolio Builder** provides rebalancing alerts and suggestions.

---

### Q: Are the stock recommendations on this site reliable?

**A**: Important disclaimers:

**This Application Does NOT Provide**:
- Investment recommendations (Buy/Hold/Sell)
- Financial advice
- Personalized guidance
- Real-time trading signals

**What It Provides**:
- Data and metrics
- Analysis tools
- Educational resources
- Screening capabilities

**Your Responsibility**:
- Do your own due diligence
- Consult financial advisor if needed
- Understand risks
- Make informed decisions

**AI Insights**:
- Informational only
- Not predictions or recommendations
- Should be one input among many
- Test strategies before implementing

**Disclaimer**: Past performance doesn't guarantee future results. Invest at your own risk.

---

### Q: Can I trust the data accuracy?

**A**: Data quality measures:

**Quality Assurance**:
- Sourced from reputable provider (Global Scouter)
- Weekly updates for most metrics
- Automated validation checks
- User reporting system

**Limitations**:
- Data lags (not real-time)
- Some metrics estimated (forward-looking)
- Quality varies by file (see Quality Scores)
- Errors possible (always verify critical decisions)

**Best Practices**:
1. Cross-check critical data with official sources (company filings)
2. Use high-quality files (S/A Tier)
3. Report discrepancies
4. Understand metrics (read Data Dictionary)

**Official Sources for Verification**:
- Company websites (investor relations)
- SEC filings (10-K, 10-Q for US)
- Exchange websites
- Financial news terminals

---

**Document Version**: 1.0
**Questions Answered**: 50+
**Last Review**: October 17, 2025
**Community Contributions**: Submit your questions via GitHub Issues
