# 🔄 Automated Data Update System

**Version**: 1.0.0
**Date**: 2025-09-14
**Status**: ✅ Deployed and Tested

## 📋 System Overview

The Automated Data Update System monitors changes in rawdata and automatically syncs them to the web application format, ensuring the web platform always has the latest POI information without manual intervention.

### 🎯 Key Features

- **Real-time Change Detection**: SHA-256 hash-based file monitoring
- **Automatic Backup**: Creates timestamped backups before each sync
- **Intelligent Sync**: Only processes data when actual changes are detected
- **Error Recovery**: Robust error handling with detailed logging
- **CLI Interface**: Easy management through command-line tools
- **Status Monitoring**: Real-time sync status and health checks

## 🏗️ Architecture

```
┌─────────────────┐    Monitor    ┌─────────────────┐
│   Raw Data      │─────────────→ │   Auto-Sync     │
│ (GPT-optimized) │    Changes    │    Manager      │
└─────────────────┘               └─────────────────┘
                                           │
                                    Transform & Sync
                                           │
                                           ▼
┌─────────────────┐    Backup     ┌─────────────────┐
│    Backups/     │←──────────────│   Web Data      │
│   Versions      │               │ (Web-compatible)│
└─────────────────┘               └─────────────────┘
                                           │
                                    Auto-refresh
                                           ▼
                                 ┌─────────────────┐
                                 │   Web App       │
                                 │  (Live Users)   │
                                 └─────────────────┘
```

## 📁 File Structure

```
miyakojima-web/
├── 📄 start_auto_sync.bat           # Windows startup script
├── 📄 data_transformer.cjs          # Core transformation engine
├── 📁 scripts/
│   └── 📄 auto_sync.cjs            # Auto-sync manager
├── 📁 data/
│   ├── 📄 miyakojima_pois.json     # Web-compatible data (output)
│   ├── 📄 .sync_hash               # Last sync hash tracking
│   └── 📁 backups/                 # Automatic backups
│       └── 📄 miyakojima_pois_backup_*.json
└── 📁 docs/rawdata/data/
    └── 📄 miyakojima_pois.json     # GPT-optimized source data
```

## 🚀 Quick Start Guide

### 1. Start Automated Monitoring
```bash
# Method 1: Using batch file (Windows)
double-click start_auto_sync.bat

# Method 2: Using command line
cd miyakojima-web
node scripts/auto_sync.cjs start
```

### 2. Manual Operations
```bash
# Check sync status
node scripts/auto_sync.cjs status

# Perform one-time sync
node scripts/auto_sync.cjs check
```

### 3. Stop Monitoring
- Press `Ctrl+C` in the terminal
- Or close the batch file window

## ⚙️ Configuration Options

The system can be customized by editing `scripts/auto_sync.cjs`:

```javascript
this.config = {
    // Monitoring frequency (milliseconds)
    checkInterval: 30 * 1000,        // 30 seconds

    // Backup settings
    backupOnSync: true,               // Create backup before sync
    maxBackups: 10,                   // Keep last 10 backups

    // File paths (auto-detected)
    rawDataPath: '../docs/rawdata/data/miyakojima_pois.json',
    webDataPath: '../data/miyakojima_pois.json'
};
```

## 🔍 Monitoring & Status

### Status Indicators

| Status | Description | Action Needed |
|--------|-------------|---------------|
| ✅ Running | Auto-sync active, monitoring changes | None |
| 🔄 Sync Needed | Changes detected, sync required | Automatic |
| ❌ Error | Sync failed or file missing | Check logs |
| ⏹️ Stopped | Monitoring inactive | Restart system |

### Health Checks

```bash
# Full status report
node scripts/auto_sync.cjs status

# Output example:
📊 Auto-sync Status:
====================
Running: ✅ Yes
Raw data exists: ✅ Yes
Web data exists: ✅ Yes
Needs sync: 🔄 No
Check interval: 30s
```

## 🔄 Sync Process Flow

```mermaid
graph TD
    A[Monitor Raw Data] --> B{Changes Detected?}
    B -->|No| A
    B -->|Yes| C[Create Backup]
    C --> D[Transform Data]
    D --> E{Transform Success?}
    E -->|No| F[Log Error]
    F --> A
    E -->|Yes| G[Update Web Data]
    G --> H[Update Hash]
    H --> I[Log Success]
    I --> A
```

### Step-by-Step Process

1. **Change Detection**: SHA-256 hash comparison with last known state
2. **Backup Creation**: Timestamped backup of current web data
3. **Data Transformation**: Convert rawdata format to web-compatible schema
4. **File Update**: Replace web data with new transformed version
5. **Hash Storage**: Save new hash for future change detection
6. **Logging**: Record sync results and performance metrics

## 🛡️ Error Handling

### Common Issues & Solutions

#### ❌ "Raw data file not found"
**Cause**: Missing rawdata file
**Solution**: Ensure `docs/rawdata/data/miyakojima_pois.json` exists

#### ❌ "Transform failed"
**Cause**: Invalid JSON or schema mismatch
**Solution**: Validate rawdata format, check for JSON syntax errors

#### ❌ "Permission denied"
**Cause**: File access restrictions
**Solution**: Check file permissions, run with appropriate privileges

#### ❌ "Auto-sync check failed"
**Cause**: System resource issues
**Solution**: Check disk space, memory usage, restart if needed

### Recovery Procedures

#### Restore from Backup
```bash
# List available backups
ls data/backups/

# Restore specific backup
cp data/backups/miyakojima_pois_backup_[timestamp].json data/miyakojima_pois.json
```

#### Reset Sync State
```bash
# Clear sync hash to force complete resync
rm data/.sync_hash
node scripts/auto_sync.cjs check
```

## 📈 Performance Metrics

### Typical Performance
- **Change Detection**: ~50ms
- **Backup Creation**: ~100ms
- **Data Transformation**: ~500ms (102 POIs)
- **File Update**: ~200ms
- **Total Sync Time**: ~850ms

### Resource Usage
- **Memory**: ~50MB during sync
- **Disk**: Minimal (backup files only)
- **CPU**: Low impact (<5% during sync)

## 🔐 Security Considerations

### File Access Control
- Read-only access to rawdata source
- Write access only to web data directory
- Backup files are versioned and protected

### Data Integrity
- SHA-256 hash verification
- Atomic file operations (backup before overwrite)
- Schema validation during transformation

### Error Isolation
- Failed sync doesn't affect web app operation
- Backup restoration available for emergency recovery
- Detailed error logging for troubleshooting

## 📊 Logging System

### Log Levels
- **INFO**: ℹ️ Normal operations, successful syncs
- **WARNING**: ⚠️ Recoverable errors, non-critical issues
- **ERROR**: ❌ Sync failures, critical errors

### Log Examples
```
🔄 Changes detected in rawdata - starting sync...
📊 Hash: 1dbe961... → 7fa3c82...
💾 Backup created: miyakojima_pois_backup_2025-09-14T17-03-07-677Z.json
✅ Transformed 102 POIs successfully
🎉 Auto-sync completed successfully!
📈 Synced 102 POIs from rawdata
```

## 🚀 Deployment Checklist

### Pre-deployment
- [ ] Verify Node.js installed (v16+ recommended)
- [ ] Confirm file paths and permissions
- [ ] Test manual sync operation
- [ ] Validate backup directory creation

### Production Setup
- [ ] Start auto-sync monitoring
- [ ] Verify status shows "Running: ✅ Yes"
- [ ] Test change detection with sample edit
- [ ] Confirm web app reflects changes
- [ ] Set up monitoring/alerting if needed

### Post-deployment
- [ ] Monitor logs for first 24 hours
- [ ] Verify backup files are created
- [ ] Test recovery procedure
- [ ] Document any custom configuration

## 🔮 Future Enhancements

### Planned Features (v1.1)
- **Web Dashboard**: Browser-based status monitoring
- **Notification System**: Email/webhook alerts for sync events
- **Multi-file Support**: Sync additional data files (budget, itinerary)
- **Cloud Integration**: Direct sync from cloud storage

### Advanced Features (v2.0)
- **Real-time Sync**: WebSocket-based instant updates
- **Conflict Resolution**: Handle concurrent edit scenarios
- **API Integration**: RESTful sync control endpoints
- **Performance Analytics**: Detailed metrics and reporting

## 📞 Support & Maintenance

### Routine Maintenance
- **Weekly**: Check backup directory size, clean old files
- **Monthly**: Review sync logs for patterns or issues
- **Quarterly**: Update system if new features available

### Troubleshooting Steps
1. Check system status: `node scripts/auto_sync.cjs status`
2. Review recent logs for error messages
3. Verify file permissions and disk space
4. Test manual sync: `node scripts/auto_sync.cjs check`
5. Restart monitoring if needed

### Getting Help
- Review this documentation for common solutions
- Check log files for specific error details
- Verify system requirements and dependencies
- Test with minimal dataset to isolate issues

---

**📌 System Status**: ✅ Fully Deployed and Operational
**Last Update**: 2025-09-14 17:03 UTC
**Sync Version**: v4.0.0 (102 POI dataset)
**Next Scheduled Review**: Monthly system health check

This automated update system ensures your Miyakojima web application stays synchronized with the latest rawdata without any manual intervention, providing a seamless experience for both developers and end users.