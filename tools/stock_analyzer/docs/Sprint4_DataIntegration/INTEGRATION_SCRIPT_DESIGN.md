# Integration Script Design

**Script**: `scripts/merge_technical_data.js`
**Purpose**: Merge all T_*.json files into global_scouter_integrated.json
**Estimated Time**: 30 minutes to implement, 5 minutes to execute

---

## Script Architecture

```javascript
/**
 * merge_technical_data.js
 *
 * Merges all technical JSON files (T_*.json) into
 * global_scouter_integrated.json under data.technical section
 */

const fs = require('fs');
const path = require('path');

// Configuration
const DATA_DIR = path.join(__dirname, '..', 'data');
const INTEGRATED_FILE = 'global_scouter_integrated.json';
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// Technical files to merge
const TECHNICAL_FILES = {
    'T_EPS_C': 'T_EPS_C.json',
    'T_Growth_C': 'T_Growth_C.json',
    'T_Rank': 'T_Rank.json',
    'T_CFO': 'T_CFO.json',
    'T_Correlation': 'T_Correlation.json'
};

async function main() {
    console.log('='.repeat(60));
    console.log('Stock Analyzer - Technical Data Integration');
    console.log('='.repeat(60));

    try {
        // Step 1: Create backup directory
        await createBackupDirectory();

        // Step 2: Backup existing integrated file
        await backupIntegratedFile();

        // Step 3: Load existing integrated data
        const integratedData = await loadIntegratedData();

        // Step 4: Load all technical files
        const technicalData = await loadTechnicalFiles();

        // Step 5: Validate data consistency
        await validateData(technicalData);

        // Step 6: Merge technical data
        integratedData.data.technical = technicalData;

        // Step 7: Update metadata
        updateMetadata(integratedData, technicalData);

        // Step 8: Write integrated file
        await writeIntegratedFile(integratedData);

        // Step 9: Validate result
        await validateIntegratedFile();

        // Step 10: Report success
        reportSuccess(integratedData);

    } catch (error) {
        console.error('❌ Integration failed:', error.message);
        console.error('\n💡 Rollback: Restore from backups/ directory');
        process.exit(1);
    }
}

// Implementation functions...
```

---

## Step-by-Step Implementation

### Step 1: Create Backup Directory

```javascript
async function createBackupDirectory() {
    console.log('\n📁 Step 1: Creating backup directory...');

    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        console.log('✅ Created:', BACKUP_DIR);
    } else {
        console.log('✅ Already exists:', BACKUP_DIR);
    }
}
```

### Step 2: Backup Existing Integrated File

```javascript
async function backupIntegratedFile() {
    console.log('\n💾 Step 2: Backing up existing integrated file...');

    const sourcePath = path.join(DATA_DIR, INTEGRATED_FILE);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupPath = path.join(
        BACKUP_DIR,
        `${INTEGRATED_FILE}.backup.${timestamp}.json`
    );

    if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, backupPath);
        console.log('✅ Backup created:', backupPath);

        // Also backup technical files
        for (const [key, filename] of Object.entries(TECHNICAL_FILES)) {
            const techPath = path.join(DATA_DIR, filename);
            if (fs.existsSync(techPath)) {
                const techBackupPath = path.join(
                    BACKUP_DIR,
                    `${filename}.backup.${timestamp}.json`
                );
                fs.copyFileSync(techPath, techBackupPath);
                console.log('✅ Backup created:', filename);
            }
        }
    } else {
        throw new Error(`Integrated file not found: ${sourcePath}`);
    }
}
```

### Step 3: Load Existing Integrated Data

```javascript
async function loadIntegratedData() {
    console.log('\n📖 Step 3: Loading existing integrated data...');

    const filePath = path.join(DATA_DIR, INTEGRATED_FILE);
    const rawData = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(rawData);

    console.log('✅ Loaded:', INTEGRATED_FILE);
    console.log('  - Main companies:', data.data.main.length);
    console.log('  - Has technical section:', !!data.data.technical);

    if (!data.data) {
        throw new Error('Invalid structure: missing data section');
    }

    if (!data.data.main) {
        throw new Error('Invalid structure: missing data.main section');
    }

    return data;
}
```

### Step 4: Load All Technical Files

```javascript
async function loadTechnicalFiles() {
    console.log('\n📚 Step 4: Loading technical files...');

    const technicalData = {};

    for (const [key, filename] of Object.entries(TECHNICAL_FILES)) {
        const filePath = path.join(DATA_DIR, filename);

        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️  File not found: ${filename} (skipping)`);
            continue;
        }

        const rawData = fs.readFileSync(filePath, 'utf8');
        const jsonData = JSON.parse(rawData);

        // Extract data array from wrapper structure
        if (jsonData.data && Array.isArray(jsonData.data)) {
            technicalData[key] = jsonData.data;
            console.log(`✅ Loaded: ${filename} (${jsonData.data.length} companies)`);
        } else {
            throw new Error(`Invalid structure in ${filename}: missing data array`);
        }
    }

    if (Object.keys(technicalData).length === 0) {
        throw new Error('No technical files found');
    }

    return technicalData;
}
```

### Step 5: Validate Data Consistency

```javascript
async function validateData(technicalData) {
    console.log('\n🔍 Step 5: Validating data consistency...');

    // Check all datasets have Ticker field
    for (const [key, data] of Object.entries(technicalData)) {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error(`${key}: Empty or invalid data array`);
        }

        const sample = data[0];
        if (!sample.Ticker) {
            throw new Error(`${key}: Missing Ticker field in data`);
        }

        // Check for duplicate tickers
        const tickers = new Set();
        let duplicates = 0;
        for (const item of data) {
            if (tickers.has(item.Ticker)) {
                duplicates++;
            }
            tickers.add(item.Ticker);
        }

        if (duplicates > 0) {
            console.warn(`⚠️  ${key}: ${duplicates} duplicate tickers found`);
        }

        console.log(`✅ ${key}: ${data.length} companies, ${tickers.size} unique tickers`);
    }
}
```

### Step 6: Update Metadata

```javascript
function updateMetadata(integratedData, technicalData) {
    console.log('\n📝 Step 6: Updating metadata...');

    // Calculate total technical companies
    const techCompaniesSet = new Set();
    for (const data of Object.values(technicalData)) {
        data.forEach(item => techCompaniesSet.add(item.Ticker));
    }

    integratedData.metadata = {
        ...integratedData.metadata,
        technicalDataCompanies: techCompaniesSet.size,
        technicalDataSets: Object.keys(technicalData).length,
        lastIntegrated: new Date().toISOString().split('T')[0],
        integrationDetails: {}
    };

    // Add per-dataset record counts
    for (const [key, data] of Object.entries(technicalData)) {
        integratedData.metadata.integrationDetails[key] = data.length;
    }

    console.log('✅ Metadata updated:');
    console.log('  - Main companies:', integratedData.data.main.length);
    console.log('  - Technical companies:', techCompaniesSet.size);
    console.log('  - Technical datasets:', Object.keys(technicalData).length);
}
```

### Step 7: Write Integrated File

```javascript
async function writeIntegratedFile(integratedData) {
    console.log('\n💾 Step 7: Writing integrated file...');

    const filePath = path.join(DATA_DIR, INTEGRATED_FILE);
    const jsonString = JSON.stringify(integratedData, null, 2);

    fs.writeFileSync(filePath, jsonString, 'utf8');

    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log('✅ File written:', filePath);
    console.log('  - Size:', sizeMB, 'MB');
    console.log('  - Lines:', jsonString.split('\n').length);
}
```

### Step 8: Validate Integrated File

```javascript
async function validateIntegratedFile() {
    console.log('\n🔍 Step 8: Validating integrated file...');

    const filePath = path.join(DATA_DIR, INTEGRATED_FILE);
    const rawData = fs.readFileSync(filePath, 'utf8');

    try {
        const data = JSON.parse(rawData);

        // Check structure
        if (!data.metadata) throw new Error('Missing metadata section');
        if (!data.data) throw new Error('Missing data section');
        if (!data.data.main) throw new Error('Missing data.main section');
        if (!data.data.technical) throw new Error('Missing data.technical section');

        // Check technical datasets
        const expectedKeys = Object.keys(TECHNICAL_FILES);
        const actualKeys = Object.keys(data.data.technical);

        for (const key of expectedKeys) {
            if (!actualKeys.includes(key)) {
                console.warn(`⚠️  Missing technical dataset: ${key}`);
            } else {
                const records = data.data.technical[key].length;
                console.log(`✅ ${key}: ${records} companies`);
            }
        }

        console.log('✅ Integrated file validation passed');

    } catch (error) {
        throw new Error(`Invalid JSON in integrated file: ${error.message}`);
    }
}
```

### Step 9: Report Success

```javascript
function reportSuccess(integratedData) {
    console.log('\n' + '='.repeat(60));
    console.log('✅ INTEGRATION COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));

    console.log('\n📊 Final Statistics:');
    console.log('  - Main companies:', integratedData.data.main.length);
    console.log('  - Technical datasets:', Object.keys(integratedData.data.technical).length);

    for (const [key, data] of Object.entries(integratedData.data.technical)) {
        console.log(`    • ${key}: ${data.length} companies`);
    }

    console.log('\n📝 Next Steps:');
    console.log('  1. Start development server: python -m http.server 8080');
    console.log('  2. Open browser: http://localhost:8080/stock_analyzer.html');
    console.log('  3. Check console for module initialization');
    console.log('  4. Run tests: npx playwright test');
    console.log('  5. If successful, archive old files: npm run archive-technical');

    console.log('\n💾 Backups:');
    console.log('  - Location:', BACKUP_DIR);
    console.log('  - Restore if needed: cp backups/<file> data/');
}
```

---

## Usage

### Execute Integration

```bash
# From stock_analyzer directory
cd C:/Users/etlov/agents-workspace/projects/100xFenok/tools/stock_analyzer

# Run integration script
node scripts/merge_technical_data.js
```

### Expected Output

```
============================================================
Stock Analyzer - Technical Data Integration
============================================================

📁 Step 1: Creating backup directory...
✅ Already exists: C:\...\backups

💾 Step 2: Backing up existing integrated file...
✅ Backup created: backups/global_scouter_integrated.json.backup.2025-10-18T21-00-00.json
✅ Backup created: T_EPS_C.json
✅ Backup created: T_Growth_C.json
✅ Backup created: T_Rank.json
✅ Backup created: T_CFO.json
✅ Backup created: T_Correlation.json

📖 Step 3: Loading existing integrated data...
✅ Loaded: global_scouter_integrated.json
  - Main companies: 6176
  - Has technical section: false

📚 Step 4: Loading technical files...
✅ Loaded: T_EPS_C.json (1250 companies)
✅ Loaded: T_Growth_C.json (1250 companies)
✅ Loaded: T_Rank.json (1250 companies)
✅ Loaded: T_CFO.json (1264 companies)
✅ Loaded: T_Correlation.json (1249 companies)

🔍 Step 5: Validating data consistency...
✅ T_EPS_C: 1250 companies, 1250 unique tickers
✅ T_Growth_C: 1250 companies, 1250 unique tickers
✅ T_Rank: 1250 companies, 1250 unique tickers
✅ T_CFO: 1264 companies, 1264 unique tickers
✅ T_Correlation: 1249 companies, 1249 unique tickers

📝 Step 6: Updating metadata...
✅ Metadata updated:
  - Main companies: 6176
  - Technical companies: 1264
  - Technical datasets: 5

💾 Step 7: Writing integrated file...
✅ File written: C:\...\data\global_scouter_integrated.json
  - Size: 1.23 MB
  - Lines: 45678

🔍 Step 8: Validating integrated file...
✅ T_EPS_C: 1250 companies
✅ T_Growth_C: 1250 companies
✅ T_Rank: 1250 companies
✅ T_CFO: 1264 companies
✅ T_Correlation: 1249 companies
✅ Integrated file validation passed

============================================================
✅ INTEGRATION COMPLETED SUCCESSFULLY
============================================================

📊 Final Statistics:
  - Main companies: 6176
  - Technical datasets: 5
    • T_EPS_C: 1250 companies
    • T_Growth_C: 1250 companies
    • T_Rank: 1250 companies
    • T_CFO: 1264 companies
    • T_Correlation: 1249 companies

📝 Next Steps:
  1. Start development server: python -m http.server 8080
  2. Open browser: http://localhost:8080/stock_analyzer.html
  3. Check console for module initialization
  4. Run tests: npx playwright test
  5. If successful, archive old files: npm run archive-technical

💾 Backups:
  - Location: C:\...\backups
  - Restore if needed: cp backups/<file> data/
```

---

## Rollback Procedure

### If Integration Fails

```bash
# Navigate to backup directory
cd C:/Users/etlov/agents-workspace/projects/100xFenok/tools/stock_analyzer/backups

# List backups
ls -lh

# Restore integrated file (replace timestamp)
cp global_scouter_integrated.json.backup.2025-10-18T21-00-00.json ../data/global_scouter_integrated.json

# Restore technical files if needed
cp T_EPS_C.json.backup.2025-10-18T21-00-00.json ../data/T_EPS_C.json
cp T_Growth_C.json.backup.2025-10-18T21-00-00.json ../data/T_Growth_C.json
# ... etc

# Verify restoration
cd ../data
ls -lh global_scouter_integrated.json

# Test
python -m http.server 8080
```

---

## Error Handling

### Common Errors

**Error: File not found**
```
Solution: Check DATA_DIR path is correct
Verify: ls data/ should show all T_*.json files
```

**Error: Invalid JSON**
```
Solution: Check JSON syntax in source files
Tool: Use `jq` or online JSON validator
Fix: node -e "JSON.parse(require('fs').readFileSync('data/T_EPS_C.json'))"
```

**Error: Missing Ticker field**
```
Solution: Validate source CSV → JSON conversion
Check: First record should have Ticker field
```

**Error: Duplicate tickers**
```
Impact: Usually not critical (modules handle duplicates)
Action: Review duplicates, may indicate data quality issue
```

### Safety Features

1. **Backups**: All files backed up with timestamp
2. **Validation**: Multiple validation steps before writing
3. **Atomic Write**: Single write operation for integrated file
4. **Error Recovery**: Clear error messages with rollback instructions

---

## Testing Plan

### Pre-Integration Tests

```bash
# 1. Verify all source files exist
ls data/T_*.json

# 2. Validate JSON syntax
for file in data/T_*.json; do
    echo "Validating $file..."
    node -e "JSON.parse(require('fs').readFileSync('$file'))"
done

# 3. Check integrated file size
ls -lh data/global_scouter_integrated.json
```

### Post-Integration Tests

```bash
# 1. Start server
python -m http.server 8080 &
SERVER_PID=$!

# 2. Wait for server start
sleep 2

# 3. Open browser and check console
# Expected: All 5 modules initialize successfully

# 4. Run Playwright tests
npx playwright test

# 5. Kill server
kill $SERVER_PID
```

### Module Validation

Check browser console for these messages:

```
✅ Expected:
[EPSAnalytics] 초기화 완료: 1250개 기업
[GrowthAnalytics] 초기화 완료: 1250개 기업
[RankingAnalytics] 초기화 완료: 1250개 기업
[CFOAnalytics] Initialization complete: 1264 companies
CorrelationEngine initialized with 1249 companies

❌ Should NOT See:
[EPSAnalytics] T_EPS_C 데이터 없음
Failed to initialize...
```

---

## Cleanup After Successful Integration

### Archive Old Files

```bash
# Create archive directory
mkdir -p archives/technical_data_$(date +%Y%m%d)

# Move old technical files
mv data/T_EPS_C.json archives/technical_data_$(date +%Y%m%d)/
mv data/T_Growth_C.json archives/technical_data_$(date +%Y%m%d)/
mv data/T_Rank.json archives/technical_data_$(date +%Y%m%d)/
mv data/T_CFO.json archives/technical_data_$(date +%Y%m%d)/
mv data/T_Correlation.json archives/technical_data_$(date +%Y%m%d)/

# Verify deletion
ls data/T_*.json
# Should return: No such file or directory
```

### Update Documentation

```bash
# Update CLAUDE.md with new structure
# Update README.md with integration notes
# Update MASTER_PLAN.md with completion status
```

---

## Package.json Scripts (Optional)

Add to `package.json`:

```json
{
  "scripts": {
    "integrate-data": "node scripts/merge_technical_data.js",
    "validate-data": "node scripts/validate_integrated_data.js",
    "archive-technical": "bash scripts/archive_technical_files.sh",
    "rollback-integration": "bash scripts/rollback_integration.sh"
  }
}
```

Then execute with:

```bash
npm run integrate-data
npm run validate-data
npm run archive-technical  # After validation
```

---

**Script Design Complete** ✅

**Next Steps**:
1. Implement script: `scripts/merge_technical_data.js`
2. Execute integration
3. Validate modules
4. Run tests
5. Archive old files

**Related Documents**:
- SPRINT4_DATA_INTEGRATION_ANALYSIS.md
- SPRINT4_INTEGRATION_SUMMARY.md
- DATA_SCHEMA_REFERENCE.md
