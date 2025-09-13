# Database Migration Guide

## Overview

This guide provides step-by-step instructions for migrating the Miyakojima POI system from JSON file storage to a database-backed solution, enabling spreadsheet integration and external API connectivity.

## Prerequisites

- ✅ Phase 4 completion (100 POIs in JSON format)
- ✅ Database integration framework installed
- Python 3.8+ with required packages
- Database server (PostgreSQL recommended)
- Admin access to deployment environment

## Migration Components

### Core Files
- `database_config.py` - Database connection management
- `data_sync_utils.py` - JSON ↔ Database synchronization
- `api_endpoints.py` - REST API framework
- `schema_validator.py` - Universal validation system

### Data Files
- `data/miyakojima_pois.json` - Source data (100 POIs)
- `backups/` - Backup files for rollback
- `config/database_config.json` - Database configuration

## Step-by-Step Migration

### Phase 1: Database Setup

#### 1.1 Database Installation
```bash
# PostgreSQL (Recommended)
# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib

# CentOS/RHEL
sudo yum install postgresql-server postgresql-contrib

# macOS (Homebrew)
brew install postgresql

# Windows
# Download from https://www.postgresql.org/download/windows/
```

#### 1.2 Database Creation
```sql
-- Connect as postgres user
sudo -u postgres psql

-- Create database and user
CREATE DATABASE miyakojima_pois;
CREATE USER miyako_user WITH PASSWORD 'secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE miyakojima_pois TO miyako_user;

-- Connect to the new database
\c miyakojima_pois;

-- Create POI table
CREATE TABLE pois (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    category VARCHAR(20) NOT NULL,
    rating DECIMAL(2,1) CHECK (rating >= 1.0 AND rating <= 5.0),
    lat DECIMAL(8,6) NOT NULL,
    lng DECIMAL(9,6) NOT NULL,
    description TEXT,
    features JSONB,
    open_hours VARCHAR(100),
    estimated_time VARCHAR(50),
    cost_min INTEGER DEFAULT 0,
    cost_max INTEGER DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'JPY',
    tips TEXT,
    accessibility VARCHAR(200),
    weather_conditions JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_pois_category ON pois(category);
CREATE INDEX idx_pois_rating ON pois(rating);
CREATE INDEX idx_pois_coordinates ON pois(lat, lng);
CREATE INDEX idx_pois_features ON pois USING GIN(features);

-- Create categories table for reference
CREATE TABLE poi_categories (
    id VARCHAR(20) PRIMARY KEY,
    name_korean VARCHAR(50) NOT NULL,
    name_english VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert category data
INSERT INTO poi_categories (id, name_korean, name_english, description) VALUES
('beaches', '해변', 'Beaches', '미야코지마의 아름다운 해변들'),
('activities', '액티비티', 'Activities', '다양한 체험 활동과 투어'),
('restaurants', '음식점', 'Restaurants', '현지 음식점과 카페'),
('culture', '문화', 'Culture', '문화 유적지와 박물관'),
('nature', '자연', 'Nature', '자연 명소와 전망대'),
('shopping', '쇼핑', 'Shopping', '기념품점과 쇼핑 센터');

-- Create sync log table
CREATE TABLE sync_logs (
    id SERIAL PRIMARY KEY,
    operation VARCHAR(20) NOT NULL,
    source VARCHAR(20) NOT NULL,
    target VARCHAR(20) NOT NULL,
    records_processed INTEGER,
    records_success INTEGER,
    records_failed INTEGER,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
```

#### 1.3 Configuration Setup
```bash
# Create database configuration
python database_config.py

# This creates config/database_config.json.example
# Copy and customize it
cp config/database_config.json.example config/database_config.json
```

Edit `config/database_config.json`:
```json
{
  "database": {
    "database_type": "postgresql",
    "host": "localhost",
    "port": 5432,
    "database": "miyakojima_pois",
    "username": "miyako_user",
    "password": "secure_password_here",
    "ssl_enabled": true,
    "min_connections": 1,
    "max_connections": 10,
    "schema_name": "public",
    "table_prefix": "miyako_"
  },
  "spreadsheet": {
    "google_sheets_enabled": false,
    "google_credentials_path": "credentials/google_service_account.json",
    "excel_enabled": true,
    "excel_file_path": "data/miyakojima_pois.xlsx",
    "sync_interval_minutes": 30,
    "auto_sync_enabled": false,
    "conflict_resolution": "database_wins"
  }
}
```

### Phase 2: Data Migration

#### 2.1 Pre-Migration Validation
```bash
# Validate current JSON data
python schema_validator.py validate-file data/miyakojima_pois.json

# Expected output:
# File: data/miyakojima_pois.json
# Valid: True
# Errors: 0
# Warnings: 0
```

#### 2.2 Migration Execution
```bash
# Create migration script
python -c "
from data_sync_utils import SyncManager
import json

# Initialize sync manager
coordinate_bounds = {
    'lat_min': 24.6, 'lat_max': 24.9,
    'lng_min': 125.1, 'lng_max': 125.5
}

sync_manager = SyncManager(
    json_file_path='data/miyakojima_pois.json',
    database_config=None,  # Will load from config file
    coordinate_bounds=coordinate_bounds
)

# Execute migration
result = sync_manager.sync_json_to_db()
print(f'Migration result: {result.success}')
print(f'Records processed: {result.records_processed}')
print(f'Records added: {result.records_added}')
"
```

#### 2.3 Migration Verification
```sql
-- Verify data migration
SELECT 
    COUNT(*) as total_pois,
    COUNT(DISTINCT category) as categories,
    MIN(rating) as min_rating,
    MAX(rating) as max_rating,
    AVG(rating) as avg_rating
FROM pois;

-- Expected results:
-- total_pois: 100
-- categories: 6
-- min_rating: 3.8
-- max_rating: 5.0
-- avg_rating: ~4.2

-- Check category distribution
SELECT 
    category,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM pois), 1) as percentage
FROM pois 
GROUP BY category 
ORDER BY count DESC;

-- Verify coordinate bounds
SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE lat BETWEEN 24.6 AND 24.9) as valid_lat,
    COUNT(*) FILTER (WHERE lng BETWEEN 125.1 AND 125.5) as valid_lng
FROM pois;
```

### Phase 3: API Deployment

#### 3.1 Install Dependencies
```bash
# Install required packages
pip install flask fastapi sqlalchemy psycopg2-binary python-dotenv

# Or using requirements.txt
echo "flask>=2.0.0
fastapi>=0.68.0
sqlalchemy>=1.4.0
psycopg2-binary>=2.9.0
python-dotenv>=0.19.0" > requirements_db.txt

pip install -r requirements_db.txt
```

#### 3.2 Create API Server
```python
# Create api_server.py
from flask import Flask, request, jsonify
from sqlalchemy import create_engine, text
import json

app = Flask(__name__)

# Database connection
engine = create_engine('postgresql://miyako_user:password@localhost/miyakojima_pois')

@app.route('/api/v1/pois', methods=['GET'])
def get_pois():
    """Get all POIs with optional filtering"""
    category = request.args.get('category')
    rating_min = request.args.get('rating_min', type=float)
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    
    query = "SELECT * FROM pois WHERE 1=1"
    params = {}
    
    if category:
        query += " AND category = %(category)s"
        params['category'] = category
    
    if rating_min:
        query += " AND rating >= %(rating_min)s"
        params['rating_min'] = rating_min
    
    query += " ORDER BY rating DESC LIMIT %(limit)s OFFSET %(offset)s"
    params.update({'limit': limit, 'offset': offset})
    
    with engine.connect() as conn:
        result = conn.execute(text(query), params)
        pois = [dict(row) for row in result]
    
    return jsonify({
        'success': True,
        'data': {
            'pois': pois,
            'total': len(pois),
            'limit': limit,
            'offset': offset
        },
        'message': 'POIs retrieved successfully'
    })

@app.route('/api/v1/pois/<poi_id>', methods=['GET'])
def get_poi(poi_id):
    """Get specific POI by ID"""
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM pois WHERE id = %(id)s"), {'id': poi_id})
        poi = result.fetchone()
    
    if poi:
        return jsonify({
            'success': True,
            'data': dict(poi),
            'message': 'POI found'
        })
    else:
        return jsonify({
            'success': False,
            'message': 'POI not found'
        }), 404

@app.route('/api/v1/pois/categories', methods=['GET'])
def get_categories():
    """Get all categories"""
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM poi_categories ORDER BY id"))
        categories = [dict(row) for row in result]
    
    return jsonify({
        'success': True,
        'data': {'categories': categories},
        'message': 'Categories retrieved successfully'
    })

if __name__ == '__main__':
    app.run(debug=True, port=8000)
```

#### 3.3 Test API Deployment
```bash
# Start API server
python api_server.py

# Test endpoints
curl "http://localhost:8000/api/v1/pois?limit=5"
curl "http://localhost:8000/api/v1/pois/categories"
curl "http://localhost:8000/api/v1/pois/beach_yonaha_maehama"
```

### Phase 4: Spreadsheet Integration

#### 4.1 Google Sheets Setup
```bash
# Install Google Sheets API client
pip install google-api-python-client google-auth google-auth-oauthlib

# Create Google service account at:
# https://console.developers.google.com/

# Download credentials JSON to:
# credentials/google_service_account.json
```

#### 4.2 Excel Integration
```bash
# Install Excel support
pip install openpyxl

# Export POIs to Excel
python -c "
from data_sync_utils import export_to_excel
export_to_excel('data/miyakojima_pois.json', 'data/miyakojima_pois.xlsx')
print('Excel export completed: data/miyakojima_pois.xlsx')
"
```

#### 4.3 Sync Configuration
```python
# Create sync_scheduler.py
import schedule
import time
from data_sync_utils import SyncManager

def sync_with_spreadsheet():
    """Scheduled sync with Google Sheets/Excel"""
    sync_manager = SyncManager(
        json_file_path='data/miyakojima_pois.json',
        database_config=None,
        coordinate_bounds={'lat_min': 24.6, 'lat_max': 24.9, 'lng_min': 125.1, 'lng_max': 125.5}
    )
    
    # Sync database to JSON first
    db_to_json = sync_manager.sync_db_to_json()
    print(f"DB to JSON sync: {db_to_json.success}")
    
    # Export to Excel
    from data_sync_utils import export_to_excel
    export_to_excel('data/miyakojima_pois.json', 'data/miyakojima_pois.xlsx')
    print("Excel export completed")

# Schedule sync every 30 minutes
schedule.every(30).minutes.do(sync_with_spreadsheet)

if __name__ == "__main__":
    print("Starting sync scheduler...")
    while True:
        schedule.run_pending()
        time.sleep(60)
```

### Phase 5: Monitoring & Maintenance

#### 5.1 Health Check Endpoint
```python
# Add to api_server.py
@app.route('/api/v1/health', methods=['GET'])
def health_check():
    """System health check"""
    try:
        # Test database connection
        with engine.connect() as conn:
            result = conn.execute(text("SELECT COUNT(*) as count FROM pois"))
            poi_count = result.fetchone()[0]
        
        # Test file system
        import os
        json_exists = os.path.exists('data/miyakojima_pois.json')
        
        return jsonify({
            'success': True,
            'data': {
                'database_connected': True,
                'poi_count': poi_count,
                'json_file_exists': json_exists,
                'status': 'healthy'
            },
            'timestamp': datetime.utcnow().isoformat()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Health check failed: {str(e)}',
            'status': 'unhealthy'
        }), 500
```

#### 5.2 Backup Strategy
```bash
# Create backup script
#!/bin/bash
# backup_database.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/database"
mkdir -p $BACKUP_DIR

# Database backup
pg_dump -U miyako_user -h localhost miyakojima_pois > $BACKUP_DIR/miyakojima_pois_$DATE.sql

# JSON backup
cp data/miyakojima_pois.json $BACKUP_DIR/miyakojima_pois_$DATE.json

# Compress backups older than 7 days
find $BACKUP_DIR -name "*.sql" -mtime +7 -exec gzip {} \;
find $BACKUP_DIR -name "*.json" -mtime +7 -exec gzip {} \;

# Clean up backups older than 30 days
find $BACKUP_DIR -name "*.gz" -mtime +30 -delete

echo "Backup completed: $DATE"
```

## Rollback Procedures

### Emergency Rollback to JSON
```bash
# Stop API server
kill $(pgrep -f "api_server.py")

# Restore JSON from backup
cp backups/miyakojima_pois_backup_phase4_*.json data/miyakojima_pois.json

# Restart original JSON-based system
# (Original system automatically works with JSON file)
```

### Database Rollback
```sql
-- Drop all data and recreate from JSON
TRUNCATE TABLE pois;
TRUNCATE TABLE sync_logs;

-- Run migration script again
-- python data_sync_utils.py migration-report
```

## Performance Tuning

### Database Optimization
```sql
-- Analyze table statistics
ANALYZE pois;

-- Check query performance
EXPLAIN ANALYZE SELECT * FROM pois WHERE category = 'beaches';

-- Additional indexes for common queries
CREATE INDEX idx_pois_name_search ON pois USING gin(to_tsvector('english', name));
CREATE INDEX idx_pois_rating_category ON pois(rating, category);
```

### API Optimization
```python
# Add caching to API
from flask_caching import Cache

cache = Cache(app, config={'CACHE_TYPE': 'simple'})

@app.route('/api/v1/pois', methods=['GET'])
@cache.cached(timeout=300)  # Cache for 5 minutes
def get_pois():
    # ... existing code
```

## Troubleshooting

### Common Issues

#### Connection Issues
```bash
# Test database connection
psql -U miyako_user -h localhost -d miyakojima_pois -c "SELECT COUNT(*) FROM pois;"

# Check if port is open
netstat -an | grep 5432
```

#### Data Validation Issues
```python
# Validate specific POI
from schema_validator import POIValidator
validator = POIValidator({
    'lat_min': 24.6, 'lat_max': 24.9,
    'lng_min': 125.1, 'lng_max': 125.5
})

# Check problem POI
poi_data = {...}  # POI data
result = validator.validate_poi(poi_data)
print(result.errors)
```

#### Performance Issues
```sql
-- Check slow queries
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;

-- Check table sizes
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation
FROM pg_stats
WHERE tablename = 'pois';
```

## Success Metrics

### Migration Success Criteria
- ✅ All 100 POIs migrated successfully
- ✅ No data loss or corruption
- ✅ All API endpoints functional
- ✅ Performance within acceptable range (<200ms response time)
- ✅ Backup and recovery procedures tested

### Monitoring Checklist
- [ ] Database connection monitoring
- [ ] API endpoint health checks
- [ ] Data sync job monitoring
- [ ] Backup verification
- [ ] Performance metrics tracking

## Support & Resources

### Documentation
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Flask API Documentation](https://flask.palletsprojects.com/)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)

### Tools
- **pgAdmin**: Database administration
- **Postman**: API testing
- **Grafana**: Monitoring dashboards
- **Prometheus**: Metrics collection

---

**Migration Guide Version**: 1.0  
**Compatible with**: Phase 4+ (100 POI database)  
**Last Updated**: 2025-09-13

*This guide provides a complete pathway from JSON-based storage to a production-ready database system with spreadsheet integration capabilities.*