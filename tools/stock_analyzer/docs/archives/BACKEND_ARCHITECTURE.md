# Stock Analyzer - Backend Architecture Design Document

**Document Version**: 1.0
**Date**: 2025-10-17
**Status**: Architecture Design for Future Backend Implementation
**Author**: Backend Architect
**Current State**: Frontend-Only Application

---

## Executive Summary

This document outlines a comprehensive backend architecture strategy for the Stock Analyzer system, which currently operates as a frontend-only application with data loaded directly from JSON files. The architecture is designed to be **evolutionary**, allowing phased migration from the current static data approach to a full-stack system with API layers, database storage, real-time updates, and automated data processing pipelines.

### Current System State
- **Architecture**: Static file-based (CSV → JSON → Frontend)
- **Data Source**: Global Scouter XLSB files (weekly manual updates)
- **Data Volume**: 1,250+ companies, 39+ financial metrics per company
- **Processing**: Python scripts (automation_master.py, weekly_data_update.py)
- **Deployment**: Static site hosting (GitHub Pages compatible)
- **No Backend**: No server, no database, no API layer

### Strategic Goals
1. **Maintain Current Simplicity**: Keep frontend-only mode operational
2. **Enable Scalability**: Design for 10x data growth (1,250 → 12,500+ companies)
3. **Add Real-time Capabilities**: WebSocket-based live data updates (Sprint 12)
4. **Improve Data Quality**: Automated validation, correction, and auditing
5. **Support Multi-user Scenarios**: Authentication, authorization, user portfolios
6. **Preserve Performance**: Zero degradation in frontend performance

---

## Table of Contents

1. [Data Pipeline Architecture](#1-data-pipeline-architecture)
2. [Data Storage Strategy](#2-data-storage-strategy)
3. [API Design (Future Sprint 12)](#3-api-design-future-sprint-12)
4. [Automation Architecture](#4-automation-architecture)
5. [Scalability and Performance](#5-scalability-and-performance)
6. [Deployment Architecture](#6-deployment-architecture)
7. [Data Backup and Recovery](#7-data-backup-and-recovery)
8. [Migration Roadmap](#8-migration-roadmap)

---

## 1. Data Pipeline Architecture

### 1.1 Current Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  Current Pipeline (Phase 0)                   │
└─────────────────────────────────────────────────────────────┘

Global_Scouter XLSB Files (Weekly)
    │
    ↓ (Manual copy to C:/Users/.../Global_Scouter/)
┌──────────────────────────────────────────┐
│ Python ETL Pipeline                      │
│ - automation_master.py                   │
│ - weekly_data_update.py                  │
│ - WeeklyDataProcessor.py                 │
└──────────────────┬───────────────────────┘
                   ↓
         ┌─────────────────────┐
         │ Data Transformation  │
         │ 1. XLSB → CSV        │
         │ 2. CSV → JSON        │
         │ 3. Data Cleaning     │
         │ 4. Schema Validation │
         └─────────┬────────────┘
                   ↓
┌──────────────────────────────────────────┐
│ Output Files                             │
│ - enhanced_summary_data_full.json (6MB)  │
│ - global_scouter_integrated.json (12MB)  │
│ - Column configurations                  │
│ - Backup files (timestamped)             │
└──────────────────┬───────────────────────┘
                   ↓
┌──────────────────────────────────────────┐
│ Frontend (Static HTML + Vanilla JS)     │
│ - Loads JSON via fetch()                │
│ - Client-side filtering & analysis       │
│ - No backend required                    │
└──────────────────────────────────────────┘
```

### 1.2 Proposed Enhanced Pipeline (Phased Migration)

```
┌─────────────────────────────────────────────────────────────┐
│              Enhanced Pipeline (Phase 1-3)                    │
└─────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ Data Ingestion Layer (NEW)             │
│ - Automated file watcher               │
│ - S3/Cloud storage integration         │
│ - Event-driven pipeline triggers       │
└───────────────┬────────────────────────┘
                ↓
┌────────────────────────────────────────┐
│ ETL Processing Layer (ENHANCED)        │
│ - WeeklyDataProcessor (existing)      │
│ - DataValidator (39-field coverage)   │
│ - CorrectionEngine (auto-fix patterns)│
│ - SchemaRegistry (field definitions)  │
│ - Quality Gates (validation rules)    │
└───────────────┬────────────────────────┘
                ↓
       ┌────────────────────┐
       │ Data Quality Gate   │
       │ - Format validation │
       │ - Range checks      │
       │ - Anomaly detection │
       │ - Dry-run preview   │
       └────────┬────────────┘
                ↓
┌────────────────────────────────────────┐
│ Data Storage Layer (NEW)               │
│ Choice A: File-based (current)        │
│ Choice B: SQLite (Phase 1)            │
│ Choice C: PostgreSQL (Phase 2)        │
│ Choice D: Hybrid (static + dynamic)   │
└───────────────┬────────────────────────┘
                ↓
┌────────────────────────────────────────┐
│ Caching Layer (NEW)                    │
│ - Redis for hot data                   │
│ - CDN for static JSON files            │
│ - Browser IndexedDB for offline        │
└───────────────┬────────────────────────┘
                ↓
┌────────────────────────────────────────┐
│ API Layer (Sprint 12 - Real-time)     │
│ - REST API (CRUD operations)          │
│ - GraphQL (flexible queries)          │
│ - WebSocket (live updates)            │
└───────────────┬────────────────────────┘
                ↓
┌────────────────────────────────────────┐
│ Frontend (Unchanged Interface)        │
│ - DataSkeleton.js (data abstraction)  │
│ - Supports both static & API modes    │
└────────────────────────────────────────┘
```

### 1.3 Pipeline Component Specifications

#### 1.3.1 Data Ingestion Layer (Phase 1)

**Current**: Manual file copy
**Proposed**: Automated ingestion with monitoring

```python
# automation/data_ingestion_service.py
class DataIngestionService:
    """
    Automated data ingestion from multiple sources

    Features:
    - File watcher for local directory changes
    - S3/Cloud storage integration
    - FTP/SFTP support for remote sources
    - Event-driven triggers (SNS/SQS)
    - Retry logic with exponential backoff
    """

    def __init__(self, config):
        self.watch_dirs = config['watch_directories']
        self.cloud_buckets = config['cloud_storage']
        self.notification_queue = config['notification_queue']

    def watch_local_directory(self, path):
        """Monitor local directory for new XLSB files"""
        # Implementation with watchdog library
        pass

    def poll_cloud_storage(self):
        """Check S3/Azure Blob for new files"""
        # Implementation with boto3/azure-storage-blob
        pass

    def on_new_file_detected(self, file_path):
        """Trigger ETL pipeline when new file detected"""
        # 1. Validate file format (XLSB, CSV, JSON)
        # 2. Move to processing directory
        # 3. Trigger ETL pipeline via queue message
        # 4. Log ingestion event
        pass
```

**Configuration** (`config/ingestion_config.json`):
```json
{
  "sources": [
    {
      "type": "local",
      "path": "C:/Users/etlov/agents-workspace/fenomeno_projects/Global_Scouter/",
      "watch_enabled": true,
      "file_patterns": ["*.xlsb", "*.csv"]
    },
    {
      "type": "s3",
      "bucket": "stock-analyzer-data",
      "prefix": "global_scouter/",
      "poll_interval": 3600
    }
  ],
  "triggers": {
    "on_new_file": "pipeline.start_etl",
    "on_error": "notifications.send_alert"
  }
}
```

#### 1.3.2 Enhanced ETL Processing (Phase 1)

**Existing Components** (Keep):
- `WeeklyDataProcessor.py` - Core ETL logic
- `automation_master.py` - Orchestration
- `weekly_data_update.py` - Wrapper script

**New Components** (Add):

```python
# automation/data_quality_engine.py
class DataQualityEngine:
    """
    Comprehensive data quality validation and correction

    Based on ARCHITECTURE_BLUEPRINT.md Section 2: Data Validation
    """

    def __init__(self, schema_registry):
        self.schema = schema_registry
        self.validator = DataValidator(schema_registry)
        self.correction_engine = CorrectionEngine(self.validator)
        self.quality_report = None

    def validate_dataset(self, data):
        """
        Validate entire dataset against 39-field schema

        Returns:
            ValidationReport with:
            - Field coverage (target: 100%)
            - Format issues (ROE, OPM decimal errors)
            - Range violations
            - Missing required fields
        """
        return self.validator.validateDataset(data)

    def detect_format_issues(self, validation_report):
        """
        Detect percentage format issues (e.g., 1550 instead of 15.5)

        Critical Fields:
        - ROE (Fwd): Should be 15.5, not 1550
        - Operating Margin (Fwd): Should be 12.3, not 1230
        - All percentage fields with decimal format
        """
        return [
            issue for issue in validation_report.formatIssues
            if issue.type == 'percentage_basis_points'
        ]

    def auto_correct_with_approval(self, data, format_issues):
        """
        Auto-correct format issues with dry-run preview

        Workflow:
        1. Generate correction preview (dry-run)
        2. Display preview to user/admin
        3. Require explicit approval
        4. Apply corrections if approved
        5. Generate rollback snapshot
        """
        preview = self.correction_engine.dry_run(data, format_issues)

        # In CLI mode: print preview, ask for confirmation
        # In API mode: return preview, await approval endpoint

        if self.await_user_approval(preview):
            return self.correction_engine.apply(data, format_issues)
        else:
            return {'applied': False, 'reason': 'user_rejected'}

    def generate_quality_report(self, validation_report):
        """
        Generate comprehensive data quality report

        Metrics:
        - Field coverage percentage (target: 100%)
        - Companies with validation errors
        - Format issues detected and corrected
        - Historical quality trends
        """
        return {
            'timestamp': datetime.now().isoformat(),
            'field_coverage': '100%',  # 39/39 fields validated
            'total_companies': validation_report.totalCompanies,
            'valid_companies': validation_report.summary.validCompanies,
            'format_issues_found': len(validation_report.formatIssues),
            'format_issues_corrected': len([i for i in validation_report.formatIssues if i.corrected]),
            'quality_score': self.calculate_quality_score(validation_report)
        }
```

**Schema Registry** (`modules/validation/FieldSchema.py`):
```python
# Complete 39-field schema from ARCHITECTURE_BLUEPRINT.md
FIELD_SCHEMA = {
    # Identity Fields (6)
    'Ticker': {'type': 'string', 'required': True, 'pattern': r'^[A-Z0-9.-]+$'},
    'corpName': {'type': 'string', 'required': True, 'minLength': 1},
    'industry': {'type': 'string', 'required': False},
    'exchange': {'type': 'string', 'enum': ['NASDAQ', 'NYSE', 'KOSPI', 'KOSDAQ']},
    'Analyst': {'type': 'string'},
    'Rating': {'type': 'string', 'enum': ['Strong Buy', 'Buy', 'Hold', 'Underperform', 'Sell']},

    # Valuation Metrics (8)
    'PER (Oct-25)': {'type': 'number', 'format': 'decimal', 'min': 0, 'max': 1000},
    'PBR (Oct-25)': {'type': 'number', 'format': 'decimal', 'min': 0, 'max': 100},
    'EV/EBITDA (Fwd)': {'type': 'number', 'min': -50, 'max': 500},
    'EV/Sales (Fwd)': {'type': 'number', 'min': 0, 'max': 100},
    'Price/Sales (Oct-25)': {'type': 'number', 'min': 0, 'max': 100},
    'Price/Cash Flow (Oct-25)': {'type': 'number', 'min': 0, 'max': 200},
    'Dividend Yield (Fwd)': {'type': 'percentage', 'format': 'decimal', 'min': 0, 'max': 30},
    'Payout Ratio (Fwd)': {'type': 'percentage', 'format': 'decimal', 'min': 0, 'max': 200},

    # Profitability Metrics (6) - CRITICAL: Decimal format issues
    'ROE (Fwd)': {'type': 'percentage', 'format': 'decimal', 'min': -100, 'max': 200},  # 15.5 NOT 1550
    'ROA (Fwd)': {'type': 'percentage', 'format': 'decimal', 'min': -100, 'max': 100},
    'ROIC (Fwd)': {'type': 'percentage', 'format': 'decimal', 'min': -100, 'max': 200},
    'Gross Margin (Fwd)': {'type': 'percentage', 'format': 'decimal', 'min': -50, 'max': 100},
    'Operating Margin (Fwd)': {'type': 'percentage', 'format': 'decimal', 'min': -100, 'max': 100},  # Same issue
    'Net Margin (Fwd)': {'type': 'percentage', 'format': 'decimal', 'min': -100, 'max': 100},

    # Financial Health (7)
    'Debt/Equity (Fwd)': {'type': 'number', 'min': 0, 'max': 1000},
    'Current Ratio (Fwd)': {'type': 'number', 'min': 0, 'max': 50},
    'Quick Ratio (Fwd)': {'type': 'number', 'min': 0, 'max': 50},
    'Interest Coverage (Fwd)': {'type': 'number', 'min': -100, 'max': 1000},
    'Cash/Debt (Oct-25)': {'type': 'number', 'min': 0, 'max': 100},
    'Asset Turnover (Fwd)': {'type': 'number', 'min': 0, 'max': 10},
    'Inventory Turnover (Fwd)': {'type': 'number', 'min': 0, 'max': 100},

    # Performance Metrics (8)
    'Return (Y)': {'type': 'percentage', 'min': -99, 'max': 1000},
    'Return (3Y)': {'type': 'percentage', 'min': -99, 'max': 2000},
    'Return (5Y)': {'type': 'percentage', 'min': -99, 'max': 5000},
    'Beta (5Y)': {'type': 'number', 'min': -5, 'max': 5},
    '52W High': {'type': 'currency', 'min': 0, 'max': 100000},
    '52W Low': {'type': 'currency', 'min': 0, 'max': 100000},
    'Avg Volume (3M)': {'type': 'number', 'format': 'integer', 'min': 0},
    'Float Short (%)': {'type': 'percentage', 'min': 0, 'max': 100},

    # Fundamental Data (4)
    '(USD mn)': {'type': 'number', 'min': 0, 'max': 10000000},  # Market Cap
    'Revenue (Fwd)': {'type': 'number', 'min': 0, 'max': 1000000},
    'EBITDA (Fwd)': {'type': 'number', 'min': -100000, 'max': 500000},
    'EPS (Fwd)': {'type': 'currency', 'min': -1000, 'max': 10000}
}
```

### 1.4 Data Quality Metrics

**Target Metrics**:
- Field Coverage: 100% (39/39 fields validated)
- Validation Success Rate: >99%
- Format Issue Detection: 100% (ROE, OPM, percentages)
- Auto-Correction Accuracy: >95%
- Processing Time: <5 seconds for 1,250 companies

**Current Gaps** (from root cause analysis):
- Field Coverage: 26% (10/39 fields) → Need 100%
- Format Detection: Manual → Need automated detection
- Correction: Manual intervention → Need auto-correction with approval

---

## 2. Data Storage Strategy

### 2.1 Storage Evolution Path

```
Phase 0: File-Based (Current)
    ↓
Phase 1: Hybrid (File + SQLite)
    ↓
Phase 2: Database-First (PostgreSQL + CDN)
    ↓
Phase 3: Distributed (PostgreSQL + Redis + CDN)
```

### 2.1.1 Phase 0: File-Based Storage (Current)

**Pros**:
- ✅ Zero infrastructure cost
- ✅ Simple deployment (static hosting)
- ✅ Fast read performance (CDN-friendly)
- ✅ Easy version control (Git)
- ✅ No database maintenance

**Cons**:
- ❌ No real-time updates
- ❌ No data relationships
- ❌ Limited query capabilities
- ❌ Difficult to scale writes
- ❌ No concurrent user support

**Current File Structure**:
```
data/
├── enhanced_summary_data_full.json    # 6 MB, 1250 companies
├── global_scouter_integrated.json     # 12 MB, all CSVs combined
├── column_config.json                  # UI metadata
├── enhanced_column_config.json         # Extended metadata
└── backups/
    ├── backup_20251017_023105/
    │   ├── enhanced_summary_data.json
    │   └── enhanced_summary_data_full.json
    └── enhanced_summary_data_20251017T022547Z.json
```

**Recommendation**: Keep for MVP and static deployment scenarios

### 2.1.2 Phase 1: Hybrid Storage (File + SQLite)

**Architecture**:
```
┌──────────────────────────────────────┐
│ Frontend                             │
│ - Loads from JSON (fast initial)    │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Data Abstraction Layer               │
│ - DataSkeleton.js (unified interface)│
│ - Detects storage mode automatically │
└──────────┬───────────────────────────┘
           │
    ┌──────┴──────┐
    ↓             ↓
┌─────────┐  ┌─────────────────┐
│ Static  │  │ SQLite Database │
│ JSON    │  │ - Normalized    │
│ Files   │  │ - Indexed       │
│         │  │ - Queryable     │
└─────────┘  └─────────────────┘
```

**SQLite Schema Design**:

```sql
-- companies table (core entity)
CREATE TABLE companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT UNIQUE NOT NULL,
    corp_name TEXT NOT NULL,
    industry TEXT,
    exchange TEXT,
    analyst TEXT,
    rating TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- valuation_metrics table (8 fields)
CREATE TABLE valuation_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    per_oct25 REAL,
    pbr_oct25 REAL,
    ev_ebitda_fwd REAL,
    ev_sales_fwd REAL,
    price_sales_oct25 REAL,
    price_cashflow_oct25 REAL,
    dividend_yield_fwd REAL,  -- Decimal format: 5.25 not 525
    payout_ratio_fwd REAL,
    snapshot_date DATE NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- profitability_metrics table (6 fields) - CRITICAL
CREATE TABLE profitability_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    roe_fwd REAL,  -- CRITICAL: 15.5 not 1550
    roa_fwd REAL,
    roic_fwd REAL,
    gross_margin_fwd REAL,
    operating_margin_fwd REAL,  -- CRITICAL: Same issue
    net_margin_fwd REAL,
    snapshot_date DATE NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- financial_health table (7 fields)
CREATE TABLE financial_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    debt_equity_fwd REAL,
    current_ratio_fwd REAL,
    quick_ratio_fwd REAL,
    interest_coverage_fwd REAL,
    cash_debt_oct25 REAL,
    asset_turnover_fwd REAL,
    inventory_turnover_fwd REAL,
    snapshot_date DATE NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- performance_metrics table (8 fields)
CREATE TABLE performance_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    return_1y REAL,
    return_3y REAL,
    return_5y REAL,
    beta_5y REAL,
    week_52_high REAL,
    week_52_low REAL,
    avg_volume_3m BIGINT,
    float_short_pct REAL,
    snapshot_date DATE NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- fundamental_data table (4 fields)
CREATE TABLE fundamental_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    market_cap_usd_mn BIGINT,
    revenue_fwd BIGINT,
    ebitda_fwd BIGINT,
    eps_fwd REAL,
    snapshot_date DATE NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_companies_ticker ON companies(ticker);
CREATE INDEX idx_companies_industry ON companies(industry);
CREATE INDEX idx_companies_exchange ON companies(exchange);
CREATE INDEX idx_valuation_company_date ON valuation_metrics(company_id, snapshot_date);
CREATE INDEX idx_profitability_company_date ON profitability_metrics(company_id, snapshot_date);
CREATE INDEX idx_financial_company_date ON financial_health(company_id, snapshot_date);
CREATE INDEX idx_performance_company_date ON performance_metrics(company_id, snapshot_date);
CREATE INDEX idx_fundamental_company_date ON fundamental_data(company_id, snapshot_date);

-- View for denormalized data (compatible with current frontend)
CREATE VIEW companies_full AS
SELECT
    c.ticker,
    c.corp_name,
    c.industry,
    c.exchange,
    c.analyst,
    c.rating,
    v.per_oct25 AS 'PER (Oct-25)',
    v.pbr_oct25 AS 'PBR (Oct-25)',
    v.ev_ebitda_fwd AS 'EV/EBITDA (Fwd)',
    v.ev_sales_fwd AS 'EV/Sales (Fwd)',
    v.dividend_yield_fwd AS 'Dividend Yield (Fwd)',
    v.payout_ratio_fwd AS 'Payout Ratio (Fwd)',
    p.roe_fwd AS 'ROE (Fwd)',
    p.roa_fwd AS 'ROA (Fwd)',
    p.roic_fwd AS 'ROIC (Fwd)',
    p.gross_margin_fwd AS 'Gross Margin (Fwd)',
    p.operating_margin_fwd AS 'Operating Margin (Fwd)',
    p.net_margin_fwd AS 'Net Margin (Fwd)',
    fh.debt_equity_fwd AS 'Debt/Equity (Fwd)',
    fh.current_ratio_fwd AS 'Current Ratio (Fwd)',
    fh.quick_ratio_fwd AS 'Quick Ratio (Fwd)',
    pm.return_1y AS 'Return (Y)',
    pm.return_3y AS 'Return (3Y)',
    pm.return_5y AS 'Return (5Y)',
    pm.beta_5y AS 'Beta (5Y)',
    pm.week_52_high AS '52W High',
    pm.week_52_low AS '52W Low',
    pm.avg_volume_3m AS 'Avg Volume (3M)',
    pm.float_short_pct AS 'Float Short (%)',
    fd.market_cap_usd_mn AS '(USD mn)',
    fd.revenue_fwd AS 'Revenue (Fwd)',
    fd.ebitda_fwd AS 'EBITDA (Fwd)',
    fd.eps_fwd AS 'EPS (Fwd)'
FROM companies c
LEFT JOIN valuation_metrics v ON c.id = v.company_id
LEFT JOIN profitability_metrics p ON c.id = p.company_id
LEFT JOIN financial_health fh ON c.id = fh.company_id
LEFT JOIN performance_metrics pm ON c.id = pm.company_id
LEFT JOIN fundamental_data fd ON c.id = fd.company_id;
```

**Pros of Hybrid Approach**:
- ✅ Backward compatible (JSON still available)
- ✅ Enables complex queries (SQL)
- ✅ Normalized data (reduce redundancy)
- ✅ Historical snapshots (time-series data)
- ✅ Zero infrastructure cost (SQLite is file-based)
- ✅ Easy migration path

**Cons**:
- ❌ Single-writer limitation (SQLite)
- ❌ Not suitable for high concurrency
- ❌ Limited to single machine deployment

**Use Cases**:
- Development and testing
- Single-user desktop application
- Proof-of-concept for database-backed features

### 2.1.3 Phase 2: Database-First (PostgreSQL + CDN)

**Architecture**:
```
┌──────────────────────────────────────┐
│ Frontend                             │
│ - Fetches from API (dynamic)        │
│ - Caches in IndexedDB (offline)     │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ API Layer (Node.js/FastAPI)         │
│ - REST endpoints                     │
│ - GraphQL (optional)                 │
│ - WebSocket (Sprint 12)              │
└──────────────┬───────────────────────┘
               ↓
        ┌──────┴──────┐
        ↓             ↓
┌─────────────┐  ┌─────────────┐
│ PostgreSQL  │  │ Redis Cache │
│ - Primary   │  │ - Hot data  │
│ - ACID      │  │ - Sessions  │
│ - Indexing  │  │ - Real-time │
└─────────────┘  └─────────────┘
        ↓
┌──────────────────────────────────────┐
│ CDN (CloudFlare/AWS CloudFront)     │
│ - Static JSON files (fallback)      │
│ - API response caching               │
└──────────────────────────────────────┘
```

**PostgreSQL Schema** (Enhanced from SQLite):

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy search

-- companies table with full-text search
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticker VARCHAR(10) UNIQUE NOT NULL,
    corp_name TEXT NOT NULL,
    industry VARCHAR(100),
    exchange VARCHAR(50),
    analyst VARCHAR(100),
    rating VARCHAR(20) CHECK (rating IN ('Strong Buy', 'Buy', 'Hold', 'Underperform', 'Sell')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    search_vector TSVECTOR  -- Full-text search optimization
);

-- Create GIN index for full-text search
CREATE INDEX idx_companies_search ON companies USING GIN(search_vector);
CREATE INDEX idx_companies_ticker_trgm ON companies USING GIN(ticker gin_trgm_ops);
CREATE INDEX idx_companies_corp_name_trgm ON companies USING GIN(corp_name gin_trgm_ops);

-- Trigger to maintain search_vector
CREATE OR REPLACE FUNCTION companies_search_vector_update() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.ticker, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.corp_name, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.industry, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_search_vector_trigger
BEFORE INSERT OR UPDATE ON companies
FOR EACH ROW EXECUTE FUNCTION companies_search_vector_update();

-- Historical snapshots table (time-series)
CREATE TABLE metric_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL,  -- 'valuation', 'profitability', 'financial', 'performance', 'fundamental'
    metrics JSONB NOT NULL,  -- Store all metrics as JSON for flexibility
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(company_id, snapshot_date, metric_type)
);

-- Indexes for time-series queries
CREATE INDEX idx_snapshots_company_date ON metric_snapshots(company_id, snapshot_date DESC);
CREATE INDEX idx_snapshots_type ON metric_snapshots(metric_type);
CREATE INDEX idx_snapshots_metrics ON metric_snapshots USING GIN(metrics jsonb_path_ops);

-- Materialized view for latest metrics (fast queries)
CREATE MATERIALIZED VIEW latest_company_metrics AS
SELECT
    c.id AS company_id,
    c.ticker,
    c.corp_name,
    c.industry,
    c.exchange,
    c.analyst,
    c.rating,
    v.metrics AS valuation,
    p.metrics AS profitability,
    fh.metrics AS financial_health,
    pm.metrics AS performance,
    fd.metrics AS fundamental,
    GREATEST(v.snapshot_date, p.snapshot_date, fh.snapshot_date, pm.snapshot_date, fd.snapshot_date) AS as_of_date
FROM companies c
LEFT JOIN LATERAL (
    SELECT metrics, snapshot_date FROM metric_snapshots
    WHERE company_id = c.id AND metric_type = 'valuation'
    ORDER BY snapshot_date DESC LIMIT 1
) v ON TRUE
LEFT JOIN LATERAL (
    SELECT metrics, snapshot_date FROM metric_snapshots
    WHERE company_id = c.id AND metric_type = 'profitability'
    ORDER BY snapshot_date DESC LIMIT 1
) p ON TRUE
LEFT JOIN LATERAL (
    SELECT metrics, snapshot_date FROM metric_snapshots
    WHERE company_id = c.id AND metric_type = 'financial'
    ORDER BY snapshot_date DESC LIMIT 1
) fh ON TRUE
LEFT JOIN LATERAL (
    SELECT metrics, snapshot_date FROM metric_snapshots
    WHERE company_id = c.id AND metric_type = 'performance'
    ORDER BY snapshot_date DESC LIMIT 1
) pm ON TRUE
LEFT JOIN LATERAL (
    SELECT metrics, snapshot_date FROM metric_snapshots
    WHERE company_id = c.id AND metric_type = 'fundamental'
    ORDER BY snapshot_date DESC LIMIT 1
) fd ON TRUE;

-- Refresh materialized view automatically (use cron job or trigger)
CREATE INDEX ON latest_company_metrics(company_id);
CREATE INDEX ON latest_company_metrics(ticker);

-- User portfolios (multi-user support)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

CREATE TABLE portfolios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE portfolio_holdings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    shares DECIMAL(15, 4),
    avg_cost DECIMAL(15, 4),
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(portfolio_id, company_id)
);

-- Data quality audit log
CREATE TABLE data_quality_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pipeline_run_id UUID NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    total_companies INT NOT NULL,
    valid_companies INT NOT NULL,
    field_coverage_pct DECIMAL(5, 2),
    format_issues_found INT,
    format_issues_corrected INT,
    validation_report JSONB,
    CONSTRAINT chk_coverage CHECK (field_coverage_pct >= 0 AND field_coverage_pct <= 100)
);

CREATE INDEX idx_quality_logs_timestamp ON data_quality_logs(timestamp DESC);
```

**Pros**:
- ✅ Horizontal scalability
- ✅ Multi-user concurrency
- ✅ ACID transactions
- ✅ Advanced querying (full-text search, JSON)
- ✅ Time-series data (historical snapshots)
- ✅ Production-ready

**Cons**:
- ❌ Infrastructure cost (hosting, backups)
- ❌ Operational complexity (monitoring, maintenance)
- ❌ Deployment complexity

**Use Cases**:
- Multi-user production application
- Real-time data updates
- Advanced analytics and reporting
- User authentication and authorization

### 2.2 Storage Decision Matrix

| Scenario | Recommended Storage | Rationale |
|----------|---------------------|-----------|
| **MVP / Static Site** | File-based JSON | Zero cost, simple, fast |
| **Single User / Offline** | Hybrid (File + SQLite) | Local database, no server |
| **Multi-User / Production** | PostgreSQL + Redis + CDN | Scalability, concurrency |
| **Real-time Updates** | PostgreSQL + Redis + WebSocket | Low latency, live data |
| **10x Data Growth** | PostgreSQL + Partitioning | Horizontal scaling |

### 2.3 Client-Side Storage (IndexedDB)

**Use Case**: Offline-first PWA capability

```javascript
// core/DataSkeleton.js - Enhanced with IndexedDB
class DataSkeleton {
    constructor() {
        this.rawData = new Map();
        this.indexedDB = null;
        this.dbName = 'StockAnalyzerDB';
        this.storeName = 'companies';
        this.initIndexedDB();
    }

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.indexedDB = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object store for companies
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const objectStore = db.createObjectStore(this.storeName, {
                        keyPath: 'Ticker'
                    });

                    // Indexes for fast lookups
                    objectStore.createIndex('industry', 'industry', { unique: false });
                    objectStore.createIndex('exchange', 'exchange', { unique: false });
                    objectStore.createIndex('corpName', 'corpName', { unique: false });
                }
            };
        });
    }

    async saveToDB(data) {
        const transaction = this.indexedDB.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);

        for (const company of data) {
            objectStore.put(company);
        }

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async loadFromDB() {
        const transaction = this.indexedDB.transaction([this.storeName], 'readonly');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}
```

**Pros**:
- ✅ Offline capability (PWA)
- ✅ Fast local queries
- ✅ No network latency
- ✅ Large storage capacity (50MB+)

**Cons**:
- ❌ Browser-specific (no cross-device sync)
- ❌ Complex API
- ❌ Data staleness (manual sync required)

---

## 3. API Design (Future Sprint 12)

### 3.1 API Architecture Overview

```
┌──────────────────────────────────────┐
│ API Gateway (Kong/AWS API Gateway)  │
│ - Rate limiting                      │
│ - Authentication                     │
│ - Request routing                    │
└──────────────┬───────────────────────┘
               ↓
        ┌──────┴──────┐
        ↓             ↓
┌─────────────┐  ┌─────────────┐
│ REST API    │  │ GraphQL     │
│ (CRUD)      │  │ (Flexible)  │
└──────┬──────┘  └──────┬──────┘
       │                │
       └────────┬───────┘
                ↓
┌──────────────────────────────────────┐
│ WebSocket Server (Sprint 12)        │
│ - Real-time price updates            │
│ - Live data streaming                │
│ - Push notifications                 │
└──────────────┬───────────────────────┘
               ↓
        ┌──────┴──────┐
        ↓             ↓
┌─────────────┐  ┌─────────────┐
│ PostgreSQL  │  │ Redis Cache │
│ (Primary)   │  │ (Hot data)  │
└─────────────┘  └─────────────┘
```

### 3.2 REST API Endpoints

**Base URL**: `https://api.stock-analyzer.com/v1`

#### 3.2.1 Company Endpoints

```
GET    /companies                 # List all companies (paginated, filtered)
GET    /companies/:ticker         # Get single company details
POST   /companies                 # Create new company (admin only)
PUT    /companies/:ticker         # Update company data (admin only)
DELETE /companies/:ticker         # Delete company (admin only)
GET    /companies/search          # Search companies (fuzzy)
```

**Request/Response Examples**:

```http
GET /companies?page=1&limit=50&industry=Semiconductor&exchange=NASDAQ
```

```json
{
  "data": [
    {
      "ticker": "NVDA",
      "corpName": "NVIDIA Corporation",
      "industry": "Semiconductor",
      "exchange": "NASDAQ",
      "metrics": {
        "valuation": {
          "PER (Oct-25)": 45.2,
          "PBR (Oct-25)": 12.5,
          "EV/EBITDA (Fwd)": 35.8
        },
        "profitability": {
          "ROE (Fwd)": 115.3,  // CORRECT: Not 11530
          "Operating Margin (Fwd)": 62.1  // CORRECT: Not 6210
        },
        "performance": {
          "Return (Y)": 238.5,
          "Return (3Y)": 891.2
        }
      },
      "asOfDate": "2025-10-17"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1250,
    "totalPages": 25
  },
  "meta": {
    "dataQuality": {
      "fieldCoverage": "100%",
      "lastValidation": "2025-10-17T02:31:05Z"
    }
  }
}
```

#### 3.2.2 Metrics Endpoints

```
GET    /companies/:ticker/metrics                    # Latest metrics
GET    /companies/:ticker/metrics/history           # Historical snapshots
GET    /companies/:ticker/metrics/:category         # Category-specific (valuation, profitability, etc.)
```

```http
GET /companies/NVDA/metrics/history?from=2025-01-01&to=2025-10-17
```

```json
{
  "ticker": "NVDA",
  "category": "profitability",
  "history": [
    {
      "snapshotDate": "2025-10-17",
      "ROE (Fwd)": 115.3,
      "Operating Margin (Fwd)": 62.1,
      "Net Margin (Fwd)": 55.8
    },
    {
      "snapshotDate": "2025-10-10",
      "ROE (Fwd)": 112.5,
      "Operating Margin (Fwd)": 61.2,
      "Net Margin (Fwd)": 54.9
    }
  ]
}
```

#### 3.2.3 Portfolio Endpoints (Multi-User)

```
GET    /portfolios                        # User's portfolios
POST   /portfolios                        # Create portfolio
GET    /portfolios/:id                    # Portfolio details
PUT    /portfolios/:id                    # Update portfolio
DELETE /portfolios/:id                    # Delete portfolio
POST   /portfolios/:id/holdings           # Add holding
DELETE /portfolios/:id/holdings/:ticker  # Remove holding
GET    /portfolios/:id/performance        # Portfolio analytics
```

#### 3.2.4 Data Quality Endpoints (Admin)

```
GET    /admin/data-quality/reports        # Validation reports
GET    /admin/data-quality/latest         # Latest quality metrics
POST   /admin/data-quality/trigger        # Trigger validation pipeline
GET    /admin/data-quality/corrections    # Correction history
```

### 3.3 GraphQL API (Optional)

**Schema**:

```graphql
type Company {
  id: ID!
  ticker: String!
  corpName: String!
  industry: String
  exchange: String
  analyst: String
  rating: String
  valuation: ValuationMetrics
  profitability: ProfitabilityMetrics
  financialHealth: FinancialHealthMetrics
  performance: PerformanceMetrics
  fundamental: FundamentalData
  asOfDate: Date!
}

type ValuationMetrics {
  per: Float
  pbr: Float
  evEbitda: Float
  evSales: Float
  dividendYield: Float
  payoutRatio: Float
}

type ProfitabilityMetrics {
  roe: Float  # CORRECT: 15.5 not 1550
  roa: Float
  roic: Float
  grossMargin: Float
  operatingMargin: Float  # CORRECT: 12.3 not 1230
  netMargin: Float
}

type Query {
  companies(
    page: Int
    limit: Int
    industry: String
    exchange: String
    minPER: Float
    maxPER: Float
    minROE: Float
    maxROE: Float
  ): CompanyConnection!

  company(ticker: String!): Company

  search(query: String!): [Company!]!

  topPerformers(metric: String!, limit: Int): [Company!]!
}

type Mutation {
  createPortfolio(name: String!, description: String): Portfolio!
  addHolding(portfolioId: ID!, ticker: String!, shares: Float!, avgCost: Float!): Holding!
  removeHolding(portfolioId: ID!, ticker: String!): Boolean!
}

type Subscription {
  priceUpdate(tickers: [String!]!): PriceUpdate!
  dataQualityAlert: DataQualityAlert!
}
```

**Query Examples**:

```graphql
# Flexible filtering with nested metrics
query GetHighROECompanies {
  companies(
    minROE: 20
    maxPER: 30
    industry: "Semiconductor"
    limit: 10
  ) {
    edges {
      node {
        ticker
        corpName
        profitability {
          roe
          operatingMargin
        }
        valuation {
          per
          pbr
        }
        performance {
          returnY
          return3Y
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### 3.4 WebSocket API (Sprint 12 - Real-time Updates)

**Connection**:
```javascript
const ws = new WebSocket('wss://api.stock-analyzer.com/v1/realtime');

ws.onopen = () => {
    // Subscribe to specific tickers
    ws.send(JSON.stringify({
        action: 'subscribe',
        tickers: ['NVDA', 'AAPL', 'TSLA']
    }));
};

ws.onmessage = (event) => {
    const update = JSON.parse(event.data);
    console.log('Real-time update:', update);

    /*
    {
      "type": "price_update",
      "ticker": "NVDA",
      "price": 485.23,
      "change": +2.15,
      "changePct": +0.44,
      "volume": 42580000,
      "timestamp": "2025-10-17T14:32:15Z"
    }
    */
};
```

**WebSocket Message Types**:
- `price_update`: Real-time price changes
- `metric_update`: Weekly metric refreshes
- `alert`: Custom alerts (price thresholds, rating changes)
- `data_quality`: Data pipeline completion notifications

### 3.5 Authentication & Authorization

**Strategy**: JWT (JSON Web Tokens)

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password"
}

Response:
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe"
  }
}
```

**Permissions**:
- `public`: Read-only access to company data
- `user`: Create/manage portfolios
- `admin`: Trigger data pipelines, view quality reports

### 3.6 API Rate Limiting

**Strategy**: Token bucket algorithm

```
Free Tier:
- 100 requests/minute
- 1000 requests/day

Pro Tier:
- 1000 requests/minute
- Unlimited daily

Admin:
- Unlimited
```

---

## 4. Automation Architecture

### 4.1 Weekly Data Update Workflow

**Current Manual Process**:
1. User copies new Global_Scouter XLSB files to directory
2. User runs `python weekly_data_update.py`
3. Script processes CSV → JSON
4. User manually deploys updated JSON files

**Proposed Automated Workflow**:

```
┌──────────────────────────────────────┐
│ Trigger: Weekly Schedule (Cron)     │
│ OR: File watcher detects new XLSB   │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Step 1: Data Ingestion               │
│ - Fetch from S3/FTP/Local            │
│ - Validate file format               │
│ - Move to processing directory       │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Step 2: ETL Processing               │
│ - XLSB → CSV → JSON                  │
│ - DataValidator (39-field check)     │
│ - CorrectionEngine (format fixes)    │
│ - Quality report generation          │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Step 3: Quality Gate                 │
│ - Check field coverage ≥99%          │
│ - Check format issues <5%            │
│ - Review auto-corrections            │
│ - Require admin approval if needed   │
└──────────────┬───────────────────────┘
               ↓ (Pass)
┌──────────────────────────────────────┐
│ Step 4: Data Storage                 │
│ - Update PostgreSQL (if Phase 2)     │
│ - Generate static JSON (backward)    │
│ - Create backup snapshot             │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Step 5: Cache Invalidation           │
│ - Flush Redis cache                  │
│ - Invalidate CDN cache               │
│ - Refresh materialized views         │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Step 6: Notification                 │
│ - Email admin (summary)              │
│ - Slack webhook (alert)              │
│ - WebSocket broadcast (live users)   │
│ - Log completion to audit trail      │
└──────────────────────────────────────┘
```

### 4.2 Error Handling and Retry Logic

**Implementation** (`automation/pipeline_orchestrator.py`):

```python
class PipelineOrchestrator:
    """
    Orchestrates weekly data update pipeline with error handling
    """

    def __init__(self, config):
        self.config = config
        self.max_retries = 3
        self.retry_delay = 60  # seconds
        self.notification_service = NotificationService(config)
        self.logger = logging.getLogger(__name__)

    async def run_pipeline(self):
        """
        Main pipeline execution with error handling
        """
        pipeline_id = uuid.uuid4()
        start_time = datetime.now()

        try:
            # Step 1: Ingestion
            files = await self.ingest_data()
            self.logger.info(f"Ingested {len(files)} files")

            # Step 2: ETL Processing
            processed_data = await self.process_data(files)
            self.logger.info(f"Processed {len(processed_data)} companies")

            # Step 3: Quality Gate
            quality_report = await self.validate_quality(processed_data)

            if not self.passes_quality_gate(quality_report):
                raise QualityGateFailure(quality_report)

            # Step 4: Storage
            await self.store_data(processed_data)

            # Step 5: Cache Invalidation
            await self.invalidate_caches()

            # Step 6: Notification
            await self.notify_success(pipeline_id, quality_report)

            self.logger.info(f"Pipeline {pipeline_id} completed in {datetime.now() - start_time}")

        except QualityGateFailure as e:
            self.logger.error(f"Quality gate failed: {e}")
            await self.notify_quality_failure(pipeline_id, e)

        except Exception as e:
            self.logger.error(f"Pipeline failed: {e}", exc_info=True)
            await self.handle_pipeline_failure(pipeline_id, e)

    async def ingest_data(self):
        """Ingest with retry"""
        for attempt in range(self.max_retries):
            try:
                return await self.data_ingestion_service.fetch_files()
            except Exception as e:
                if attempt < self.max_retries - 1:
                    self.logger.warning(f"Ingestion attempt {attempt + 1} failed: {e}")
                    await asyncio.sleep(self.retry_delay * (2 ** attempt))
                else:
                    raise

    async def process_data(self, files):
        """Process with validation"""
        processor = WeeklyDataProcessor(self.config)
        results = []

        for file in files:
            try:
                result = processor.process_weekly_data(file)
                if result['success']:
                    results.append(result['data'])
                else:
                    self.logger.error(f"Failed to process {file}: {result['error']}")
            except Exception as e:
                self.logger.error(f"Error processing {file}: {e}", exc_info=True)
                # Continue with other files

        return results

    def passes_quality_gate(self, report):
        """
        Quality gate validation

        Pass criteria:
        - Field coverage ≥99%
        - Format issues <5%
        - Required fields present for all companies
        """
        return (
            float(report['field_coverage'].strip('%')) >= 99.0 and
            (report['format_issues_found'] / report['total_companies']) < 0.05 and
            report['valid_companies'] == report['total_companies']
        )

    async def notify_success(self, pipeline_id, report):
        """Send success notification"""
        await self.notification_service.send(
            channel='email',
            recipients=['admin@stock-analyzer.com'],
            subject=f'✅ Data Pipeline Completed - {pipeline_id}',
            body=self.format_success_report(report)
        )

        await self.notification_service.send(
            channel='slack',
            webhook_url=self.config['slack_webhook'],
            message=f'✅ Weekly data update completed. {report["total_companies"]} companies updated.'
        )
```

### 4.3 Monitoring and Alerting

**Metrics to Track**:
- Pipeline execution time
- Data volume (companies, fields)
- Validation success rate
- Format issue frequency
- Storage usage
- API response times (if Phase 2)

**Alerting Rules**:

```yaml
# monitoring/alerts.yml
alerts:
  - name: DataQualityLow
    condition: field_coverage < 99%
    severity: high
    action: notify_admin

  - name: PipelineFailure
    condition: pipeline_status == 'failed'
    severity: critical
    action: notify_admin + page_oncall

  - name: FormatIssueSurge
    condition: format_issues_pct > 10%
    severity: medium
    action: notify_admin

  - name: ProcessingTimeout
    condition: processing_time > 600s
    severity: high
    action: notify_admin
```

**Monitoring Stack** (Optional):
- **Prometheus**: Metrics collection
- **Grafana**: Visualization dashboards
- **AlertManager**: Alert routing
- **CloudWatch/Datadog**: Managed monitoring (if cloud-hosted)

---

## 5. Scalability and Performance

### 5.1 Scalability Plan: 10x Data Growth

**Current**: 1,250 companies, 39 fields = 48,750 data points
**Target**: 12,500 companies, 50 fields = 625,000 data points (13x growth)

**Bottlenecks**:
1. **Frontend Rendering**: Client-side table rendering 12,500 rows
2. **Data Loading**: Fetch 50MB+ JSON file
3. **Filtering Performance**: Client-side JavaScript filtering
4. **Memory Usage**: Hold entire dataset in browser RAM

**Solutions**:

#### 5.1.1 Server-Side Pagination

**Current** (Client-side):
```javascript
// Load all 1,250 companies into memory
const allCompanies = await fetch('data/enhanced_summary_data_full.json');
// Filter and paginate in browser
```

**Improved** (Server-side):
```javascript
// Load only 50 companies per page from API
const page1 = await fetch('/api/companies?page=1&limit=50');
// Server does filtering, sorting, pagination
```

**Performance Impact**:
- Initial load: 6MB → 200KB (97% reduction)
- Time-to-interactive: 2s → 0.3s (85% faster)
- Memory usage: 50MB → 5MB (90% reduction)

#### 5.1.2 Virtual Scrolling

**Implementation** (`modules/VirtualScroll.js`):

```javascript
class VirtualScrollTable {
    constructor(config) {
        this.totalRows = config.totalRows;
        this.rowHeight = config.rowHeight || 50;
        this.visibleRows = Math.ceil(window.innerHeight / this.rowHeight);
        this.buffer = 10;  // Extra rows above/below viewport

        this.viewport = {
            start: 0,
            end: this.visibleRows + this.buffer
        };
    }

    render() {
        // Only render visible rows + buffer
        const rows = this.getVisibleRows();

        // Create spacer divs for non-rendered rows
        const topSpacer = document.createElement('div');
        topSpacer.style.height = `${this.viewport.start * this.rowHeight}px`;

        const bottomSpacer = document.createElement('div');
        const remainingRows = this.totalRows - this.viewport.end;
        bottomSpacer.style.height = `${remainingRows * this.rowHeight}px`;

        return { topSpacer, rows, bottomSpacer };
    }

    onScroll(scrollTop) {
        const newStart = Math.floor(scrollTop / this.rowHeight);
        const newEnd = newStart + this.visibleRows + this.buffer;

        if (newStart !== this.viewport.start || newEnd !== this.viewport.end) {
            this.viewport.start = newStart;
            this.viewport.end = newEnd;
            this.render();
        }
    }
}
```

**Performance Impact**:
- DOM nodes: 12,500 → 30 (99.8% reduction)
- Rendering time: 5s → 0.1s (98% faster)
- Scroll performance: 60 FPS maintained

#### 5.1.3 Data Streaming (For Real-time)

**WebSocket Streaming**:

```javascript
const ws = new WebSocket('wss://api.stock-analyzer.com/v1/stream');

ws.onopen = () => {
    ws.send(JSON.stringify({
        action: 'stream_companies',
        filters: { industry: 'Semiconductor' },
        chunk_size: 100
    }));
};

ws.onmessage = (event) => {
    const chunk = JSON.parse(event.data);

    if (chunk.type === 'data_chunk') {
        // Append chunk to table (incremental rendering)
        appendRowsToTable(chunk.companies);
    } else if (chunk.type === 'stream_complete') {
        console.log(`Loaded ${chunk.total_companies} companies in ${chunk.duration}ms`);
    }
};
```

### 5.2 Caching Strategy

```
┌──────────────────────────────────────┐
│ Layer 1: Browser Cache (304 Headers)│
│ - Static JSON files (1 hour TTL)    │
│ - Column configs (24 hour TTL)      │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Layer 2: IndexedDB (Offline)        │
│ - Last loaded dataset                │
│ - User portfolios                    │
│ - User preferences                   │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Layer 3: CDN (CloudFlare/CloudFront)│
│ - Static JSON files (global edge)   │
│ - API responses (5 min TTL)         │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Layer 4: Redis (Application Cache)  │
│ - Hot company data (1 hour TTL)     │
│ - Aggregated metrics (10 min TTL)   │
│ - User sessions (24 hour TTL)       │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Layer 5: PostgreSQL (Source of Truth│
│ - Materialized views (1 hour refresh)│
│ - Query result cache (pg_stat)      │
└──────────────────────────────────────┘
```

**Cache Invalidation Strategy**:
- On weekly data update: Invalidate all layers
- On user portfolio change: Invalidate Layer 2 + Layer 4 (user-specific)
- On real-time price update: Invalidate Layer 4 (specific ticker)

### 5.3 Database Optimization

**PostgreSQL Tuning**:

```sql
-- Partition large tables by date
CREATE TABLE metric_snapshots_202510 PARTITION OF metric_snapshots
FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

-- Index optimization
ANALYZE metric_snapshots;
REINDEX TABLE metric_snapshots;

-- Vacuum regularly
VACUUM ANALYZE companies;

-- Connection pooling
-- Configure pgBouncer: max_client_conn=100, default_pool_size=25
```

**Query Optimization**:

```sql
-- Bad: Full table scan
SELECT * FROM companies WHERE corp_name LIKE '%Apple%';

-- Good: Use GIN index with trgm
SELECT * FROM companies WHERE corp_name % 'Apple';  -- Fuzzy match

-- Bad: N+1 queries
-- Load company, then load each metric category separately

-- Good: Single JOIN query with view
SELECT * FROM latest_company_metrics WHERE ticker = 'AAPL';
```

### 5.4 Performance Targets

| Metric | Current | Target (Phase 2) | Target (10x Data) |
|--------|---------|------------------|-------------------|
| **Initial Load** | 2s (6MB JSON) | 0.3s (paginated) | 0.5s (optimized) |
| **Filter Response** | 500ms (client) | 100ms (server) | 200ms (indexed) |
| **Table Render** | 1s (1,250 rows) | 0.1s (virtual) | 0.15s (virtual) |
| **Search Latency** | N/A (client-only) | 50ms (PostgreSQL) | 80ms (full-text) |
| **Data Freshness** | Weekly (manual) | Daily (automated) | Real-time (WS) |

---

## 6. Deployment Architecture

### 6.1 Current Deployment (Phase 0)

**Static Site Hosting**:
- GitHub Pages (free)
- Netlify/Vercel (free tier)
- S3 + CloudFront (AWS)

**Pros**:
- ✅ Zero cost
- ✅ Simple CI/CD (git push)
- ✅ Global CDN
- ✅ High availability

**Cons**:
- ❌ No backend
- ❌ No dynamic content
- ❌ Manual data updates

### 6.2 Proposed Deployment (Phase 2)

```
┌──────────────────────────────────────────────────────────┐
│                    Production Architecture                 │
└──────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │ DNS (Route53)│
                    └──────┬───────┘
                           ↓
              ┌────────────────────────┐
              │ CDN (CloudFlare)       │
              │ - Static assets        │
              │ - API response caching │
              └────────┬───────────────┘
                       ↓
        ┌──────────────────────────────┐
        │ Load Balancer (ALB/Nginx)    │
        │ - SSL termination            │
        │ - Health checks              │
        └──────┬───────────────────────┘
               ↓
    ┌──────────────────────┐
    │ Application Servers  │
    │ (Auto-scaling group) │
    │ - Node.js/FastAPI    │
    │ - 2-10 instances     │
    └──────┬───────────────┘
           │
    ┌──────┴──────┐
    ↓             ↓
┌─────────┐  ┌─────────────┐
│Redis    │  │ PostgreSQL  │
│(Cache)  │  │ (Primary DB)│
│1 node   │  │ RDS Multi-AZ│
└─────────┘  └──────┬──────┘
                    ↓
            ┌───────────────┐
            │ S3 (Backups)  │
            │ Daily snapshots│
            └───────────────┘
```

### 6.3 Environment Management

**Three-tier architecture**:

```yaml
# Development Environment
dev:
  frontend_url: http://localhost:3000
  api_url: http://localhost:8000
  database: stock_analyzer_dev (SQLite)
  cache: localhost:6379
  data_refresh: manual

# Staging Environment
staging:
  frontend_url: https://staging.stock-analyzer.com
  api_url: https://api-staging.stock-analyzer.com
  database: stock_analyzer_staging (PostgreSQL RDS)
  cache: staging-redis.cache.amazonaws.com
  data_refresh: daily (automated)

# Production Environment
production:
  frontend_url: https://stock-analyzer.com
  api_url: https://api.stock-analyzer.com
  database: stock_analyzer_prod (PostgreSQL RDS Multi-AZ)
  cache: prod-redis-cluster.cache.amazonaws.com
  data_refresh: daily (automated) + real-time (Sprint 12)
```

### 6.4 CI/CD Pipeline

```
┌─────────────────────────────────────────────────────┐
│ Developer → Git Push                                 │
└──────────────┬──────────────────────────────────────┘
               ↓
┌──────────────────────────────────────────────────────┐
│ GitHub Actions (CI Pipeline)                         │
│ 1. Lint (ESLint, Black)                             │
│ 2. Unit Tests (Jest, Pytest)                        │
│ 3. Integration Tests (Playwright)                   │
│ 4. Build (Webpack, Docker)                          │
│ 5. Security Scan (Snyk, OWASP)                      │
└──────────────┬───────────────────────────────────────┘
               ↓
┌──────────────────────────────────────────────────────┐
│ Artifact Storage (Docker Registry/S3)               │
└──────────────┬───────────────────────────────────────┘
               ↓
        ┌──────┴──────┐
        ↓             ↓
┌──────────────┐ ┌──────────────┐
│ Staging      │ │ Production   │
│ Deploy       │ │ Deploy       │
│ (Auto)       │ │ (Manual)     │
└──────────────┘ └──────────────┘
```

**GitHub Actions Workflow** (`.github/workflows/deploy.yml`):

```yaml
name: Deploy Stock Analyzer

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run unit tests
        run: npm test

      - name: Run integration tests
        run: npm run test:integration

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build frontend
        run: npm run build

      - name: Build Docker image
        run: docker build -t stock-analyzer:${{ github.sha }} .

      - name: Push to registry
        run: docker push stock-analyzer:${{ github.sha }}

  deploy-staging:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to staging
        run: |
          aws ecs update-service --cluster staging --service stock-analyzer --force-new-deployment

  deploy-production:
    needs: deploy-staging
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: |
          aws ecs update-service --cluster production --service stock-analyzer --force-new-deployment
```

### 6.5 Infrastructure as Code (Terraform)

**Example** (`infrastructure/main.tf`):

```hcl
# AWS Provider
provider "aws" {
  region = "us-east-1"
}

# VPC Configuration
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"

  name = "stock-analyzer-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["us-east-1a", "us-east-1b"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]

  enable_nat_gateway = true
  enable_vpn_gateway = false
}

# RDS PostgreSQL
resource "aws_db_instance" "postgres" {
  identifier     = "stock-analyzer-db"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.t3.medium"

  allocated_storage     = 100
  max_allocated_storage = 1000
  storage_encrypted     = true

  db_name  = "stock_analyzer"
  username = var.db_username
  password = var.db_password

  multi_az               = true
  backup_retention_period = 7

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
}

# ElastiCache Redis
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "stock-analyzer-cache"
  engine               = "redis"
  node_type            = "cache.t3.medium"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379

  subnet_group_name   = aws_elasticache_subnet_group.main.name
  security_group_ids  = [aws_security_group.redis.id]
}

# ECS Fargate for API
resource "aws_ecs_cluster" "main" {
  name = "stock-analyzer-cluster"
}

resource "aws_ecs_task_definition" "api" {
  family                   = "stock-analyzer-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"

  container_definitions = jsonencode([
    {
      name  = "api"
      image = "stock-analyzer-api:latest"
      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "DATABASE_URL"
          value = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/stock_analyzer"
        },
        {
          name  = "REDIS_URL"
          value = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
        }
      ]
    }
  ])
}

# S3 Bucket for static assets
resource "aws_s3_bucket" "frontend" {
  bucket = "stock-analyzer-frontend"

  website {
    index_document = "index.html"
    error_document = "error.html"
  }
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "cdn" {
  origin {
    domain_name = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id   = "S3-stock-analyzer"
  }

  enabled             = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-stock-analyzer"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }
}
```

---

## 7. Data Backup and Recovery

### 7.1 Backup Strategy

**Three-tier backup approach**:

```
Tier 1: Version Control (Git)
├─ JSON files tracked in Git
├─ Configuration files versioned
└─ Rollback: git revert <commit>

Tier 2: Local Backups (File System)
├─ data/backups/ directory
├─ Timestamped snapshots
└─ Retention: 30 days (automatic cleanup)

Tier 3: Cloud Backups (S3/Azure)
├─ Daily automated uploads
├─ Versioning enabled
└─ Retention: 90 days (lifecycle policy)
```

### 7.2 Backup Automation

**Script** (`scripts/backup_manager.py`):

```python
#!/usr/bin/env python3
"""
Automated backup management for Stock Analyzer data

Features:
- Local backups with timestamped directories
- S3 uploads with versioning
- Automatic cleanup of old backups
- Integrity verification (checksums)
"""

import os
import json
import shutil
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
import boto3

class BackupManager:
    def __init__(self, config):
        self.data_dir = Path(config['data_directory'])
        self.backup_dir = self.data_dir / 'backups'
        self.s3_bucket = config.get('s3_bucket')
        self.retention_days = config.get('retention_days', 30)

        self.backup_dir.mkdir(exist_ok=True)

        if self.s3_bucket:
            self.s3_client = boto3.client('s3')

    def create_backup(self):
        """
        Create timestamped backup of all data files

        Returns:
            dict: Backup metadata (path, size, checksum)
        """
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = self.backup_dir / f'backup_{timestamp}'
        backup_path.mkdir(exist_ok=True)

        files_backed_up = []
        total_size = 0

        # Backup JSON data files
        for json_file in self.data_dir.glob('*.json'):
            if 'backup' not in str(json_file):  # Skip existing backups
                dest = backup_path / json_file.name
                shutil.copy2(json_file, dest)

                file_size = dest.stat().st_size
                file_hash = self.calculate_checksum(dest)

                files_backed_up.append({
                    'filename': json_file.name,
                    'size': file_size,
                    'checksum': file_hash
                })

                total_size += file_size

        # Create backup manifest
        manifest = {
            'timestamp': timestamp,
            'backup_path': str(backup_path),
            'files': files_backed_up,
            'total_size': total_size,
            'created_at': datetime.now().isoformat()
        }

        manifest_path = backup_path / 'manifest.json'
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)

        print(f'✅ Backup created: {backup_path}')
        print(f'   Files: {len(files_backed_up)}')
        print(f'   Total size: {total_size / 1024 / 1024:.2f} MB')

        return manifest

    def upload_to_s3(self, backup_manifest):
        """Upload backup to S3 with versioning"""
        if not self.s3_bucket:
            print('⚠️ S3 bucket not configured, skipping upload')
            return

        backup_path = Path(backup_manifest['backup_path'])

        for file_info in backup_manifest['files']:
            local_path = backup_path / file_info['filename']
            s3_key = f"backups/{backup_manifest['timestamp']}/{file_info['filename']}"

            self.s3_client.upload_file(
                str(local_path),
                self.s3_bucket,
                s3_key,
                ExtraArgs={'Metadata': {'checksum': file_info['checksum']}}
            )

            print(f'☁️ Uploaded to S3: {s3_key}')

    def cleanup_old_backups(self):
        """Delete local backups older than retention period"""
        cutoff_date = datetime.now() - timedelta(days=self.retention_days)

        for backup_dir in self.backup_dir.glob('backup_*'):
            # Parse timestamp from directory name
            timestamp_str = backup_dir.name.replace('backup_', '')
            try:
                backup_date = datetime.strptime(timestamp_str, '%Y%m%d_%H%M%S')

                if backup_date < cutoff_date:
                    shutil.rmtree(backup_dir)
                    print(f'🗑️ Deleted old backup: {backup_dir.name}')
            except ValueError:
                # Invalid directory name format, skip
                pass

    def calculate_checksum(self, file_path):
        """Calculate SHA256 checksum for integrity verification"""
        sha256 = hashlib.sha256()

        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b''):
                sha256.update(chunk)

        return sha256.hexdigest()

    def verify_backup(self, backup_manifest):
        """
        Verify backup integrity by checking checksums

        Returns:
            bool: True if all files pass verification
        """
        backup_path = Path(backup_manifest['backup_path'])

        for file_info in backup_manifest['files']:
            file_path = backup_path / file_info['filename']

            if not file_path.exists():
                print(f'❌ File missing: {file_info["filename"]}')
                return False

            actual_checksum = self.calculate_checksum(file_path)
            expected_checksum = file_info['checksum']

            if actual_checksum != expected_checksum:
                print(f'❌ Checksum mismatch: {file_info["filename"]}')
                print(f'   Expected: {expected_checksum}')
                print(f'   Actual: {actual_checksum}')
                return False

        print('✅ Backup verification passed')
        return True

    def restore_backup(self, backup_timestamp):
        """
        Restore data from a specific backup

        Args:
            backup_timestamp: Timestamp string (YYYYMMDD_HHMMSS)

        Returns:
            bool: Success status
        """
        backup_path = self.backup_dir / f'backup_{backup_timestamp}'

        if not backup_path.exists():
            print(f'❌ Backup not found: {backup_timestamp}')
            return False

        # Load manifest
        manifest_path = backup_path / 'manifest.json'
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)

        # Verify backup before restoring
        if not self.verify_backup(manifest):
            print('❌ Backup verification failed, aborting restore')
            return False

        # Create backup of current data before restore
        print('📦 Creating backup of current data before restore...')
        current_backup = self.create_backup()

        # Restore files
        for file_info in manifest['files']:
            source = backup_path / file_info['filename']
            dest = self.data_dir / file_info['filename']

            shutil.copy2(source, dest)
            print(f'✅ Restored: {file_info["filename"]}')

        print(f'✅ Restore completed from backup: {backup_timestamp}')
        print(f'💾 Pre-restore backup saved: {current_backup["backup_path"]}')

        return True

def main():
    config = {
        'data_directory': 'C:/Users/etlov/agents-workspace/projects/100xFenok/tools/stock_analyzer/data',
        's3_bucket': 'stock-analyzer-backups',  # Optional
        'retention_days': 30
    }

    backup_manager = BackupManager(config)

    # Create backup
    manifest = backup_manager.create_backup()

    # Verify backup
    backup_manager.verify_backup(manifest)

    # Upload to S3 (if configured)
    backup_manager.upload_to_s3(manifest)

    # Cleanup old backups
    backup_manager.cleanup_old_backups()

if __name__ == '__main__':
    main()
```

### 7.3 Disaster Recovery Plan

**Recovery Time Objective (RTO)**: 1 hour
**Recovery Point Objective (RPO)**: 24 hours (daily backups)

**Disaster Scenarios**:

| Scenario | Impact | Recovery Steps | RTO |
|----------|--------|----------------|-----|
| **Data corruption** | Invalid JSON files | 1. Identify last valid backup<br>2. Run `restore_backup(timestamp)`<br>3. Verify data integrity<br>4. Restart application | 15 min |
| **Accidental deletion** | Missing data files | 1. Check Git history<br>2. If not in Git, restore from S3<br>3. Verify checksums<br>4. Restart pipeline | 30 min |
| **Database failure** (Phase 2) | No data access | 1. Restore PostgreSQL from RDS snapshot<br>2. Regenerate static JSON files<br>3. Invalidate caches<br>4. Restart application | 1 hour |
| **Complete system failure** | Total data loss | 1. Restore infrastructure (Terraform)<br>2. Restore database from S3 backup<br>3. Restore static files from S3<br>4. Re-run ETL pipeline<br>5. Validate data quality | 2-4 hours |

**Backup Testing Schedule**:
- Weekly: Automated backup verification (checksums)
- Monthly: Test restore process on staging environment
- Quarterly: Full disaster recovery drill

---

## 8. Migration Roadmap

### 8.1 Phased Migration Strategy

```
Phase 0: Current State (Completed)
├─ Frontend-only application
├─ Static JSON data files
├─ Python ETL scripts (manual execution)
└─ GitHub Pages deployment

Phase 1: Enhanced Data Quality (Sprint 1-2, Weeks 1-4)
├─ Implement DataValidator (39-field coverage)
├─ Add CorrectionEngine (auto-fix with approval)
├─ Automate ETL pipeline (file watcher)
├─ Implement backup automation
└─ Deliverable: Validated, audited data pipeline

Phase 2: Database Layer (Sprint 3-4, Weeks 5-8)
├─ Deploy PostgreSQL database
├─ Implement hybrid storage (File + DB)
├─ Build API layer (REST endpoints)
├─ Add authentication & authorization
└─ Deliverable: Database-backed application

Phase 3: Real-time Capabilities (Sprint 12, Weeks 23-24)
├─ Implement WebSocket server
├─ Add Redis caching layer
├─ Build real-time price streaming
├─ Integrate with live data feeds
└─ Deliverable: Real-time data updates

Phase 4: Scale & Optimize (Sprint 13+, Ongoing)
├─ Horizontal scaling (multi-instance)
├─ Advanced caching (CDN, Redis cluster)
├─ Performance optimization (virtual scrolling)
├─ Multi-user features (portfolios, alerts)
└─ Deliverable: Production-grade, scalable system
```

### 8.2 Sprint-by-Sprint Breakdown

**Sprint 1: Data Validation Foundation** (Week 1-2)
- Task 1.1: Create FieldSchema.js (39 fields)
- Task 1.2: Implement DataValidator class
- Task 1.3: Implement CorrectionEngine with dry-run
- Task 1.4: Integrate with WeeklyDataProcessor
- Task 1.5: Create validation reports and metrics
- **Gate**: 100% field coverage validation

**Sprint 2: Automation & Quality** (Week 3-4)
- Task 2.1: Build DataIngestionService (file watcher)
- Task 2.2: Implement PipelineOrchestrator
- Task 2.3: Add error handling and retry logic
- Task 2.4: Implement BackupManager
- Task 2.5: Setup monitoring and alerting
- **Gate**: Automated pipeline with quality gates

**Sprint 3: Database Setup** (Week 5-6)
- Task 3.1: Deploy PostgreSQL (RDS or local)
- Task 3.2: Design and create schema (39 fields)
- Task 3.3: Build data migration scripts (JSON → DB)
- Task 3.4: Create materialized views
- Task 3.5: Test data integrity and performance
- **Gate**: Database operational with historical data

**Sprint 4: API Layer** (Week 7-8)
- Task 4.1: Setup API framework (Node.js/FastAPI)
- Task 4.2: Implement REST endpoints (companies, metrics)
- Task 4.3: Add authentication (JWT)
- Task 4.4: Implement pagination and filtering
- Task 4.5: Deploy API to staging
- **Gate**: API fully functional with documentation

**Sprint 12: Real-time Updates** (Week 23-24)
- Task 12.1: Setup WebSocket server
- Task 12.2: Implement price streaming
- Task 12.3: Add Redis for real-time caching
- Task 12.4: Integrate frontend with WebSocket
- Task 12.5: Load testing and optimization
- **Gate**: Real-time data streaming operational

### 8.3 Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Data quality degradation** | Medium | High | - Automated validation<br>- Quality gates<br>- Monitoring alerts |
| **Performance regression** | Low | Medium | - Load testing before deployment<br>- Rollback plan<br>- Caching strategy |
| **Database migration failure** | Low | High | - Dry-run on staging<br>- Keep file-based fallback<br>- Detailed runbook |
| **User disruption** | Low | High | - Backward compatibility<br>- Gradual rollout<br>- Feature flags |
| **Infrastructure cost overrun** | Medium | Medium | - Start with managed services (RDS, ElastiCache)<br>- Monitor costs<br>- Auto-scaling limits |

### 8.4 Rollback Strategy

**Rollback Decision Criteria**:
- Critical bugs affecting >10% of users
- Data corruption or loss
- Performance degradation >50%
- Security vulnerabilities discovered

**Rollback Process**:
1. **Immediate**: Switch traffic to previous version (load balancer)
2. **Short-term**: Restore database from last known good snapshot
3. **Validation**: Verify data integrity after rollback
4. **Communication**: Notify users of incident and resolution
5. **Post-mortem**: Analyze root cause and prevent recurrence

---

## Conclusion

This backend architecture design provides a comprehensive, phased approach to evolving the Stock Analyzer from a frontend-only application to a full-stack, scalable, real-time financial data platform.

### Key Takeaways

1. **Evolutionary, Not Revolutionary**: Each phase builds on the previous, maintaining backward compatibility and minimizing disruption.

2. **Data Quality First**: Phase 1 focuses on automated validation and correction, addressing the critical 26% → 100% field coverage gap.

3. **Flexible Storage**: Hybrid approach allows file-based simplicity for MVP while enabling database-backed features for advanced use cases.

4. **Scalability by Design**: Architecture supports 10x data growth through pagination, virtual scrolling, caching, and database partitioning.

5. **Automation-Driven**: Weekly data updates, quality checks, backups, and deployments are automated for reliability and efficiency.

6. **Observability**: Comprehensive monitoring, alerting, and data quality metrics ensure system health and data integrity.

### Next Steps

1. **Review and Approval**: Stakeholder review of proposed architecture
2. **Phase 1 Planning**: Detailed sprint planning for data validation enhancement
3. **Prototype Development**: Build proof-of-concept for hybrid storage (SQLite)
4. **Infrastructure Setup**: Provision development and staging environments
5. **Documentation**: Create API specifications and deployment runbooks

**Last Updated**: 2025-10-17
**Document Version**: 1.0
**Author**: Backend Architect
**Status**: Awaiting approval for Phase 1 implementation
