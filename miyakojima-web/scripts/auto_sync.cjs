#!/usr/bin/env node

/**
 * Automated Data Synchronization System
 * Monitors rawdata changes and automatically updates web data
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Import our data transformer
const DataTransformer = require('../data_transformer.cjs');

class AutoSyncManager {
    constructor() {
        this.config = {
            // File paths
            rawDataPath: path.join(__dirname, '..', 'docs', 'rawdata', 'data', 'miyakojima_pois.json'),
            webDataPath: path.join(__dirname, '..', 'data', 'miyakojima_pois.json'),
            hashFilePath: path.join(__dirname, '..', 'data', '.sync_hash'),

            // Sync settings
            checkInterval: 30 * 1000, // 30 seconds
            backupOnSync: true,
            maxBackups: 10
        };

        this.transformer = new DataTransformer();
        this.isRunning = false;
        this.lastHash = null;
    }

    /**
     * Start automated sync monitoring
     */
    async start() {
        if (this.isRunning) {
            console.log('🔄 Auto-sync already running');
            return;
        }

        console.log('🚀 Starting automated data sync system...');
        this.isRunning = true;

        // Load last known hash
        await this.loadLastHash();

        // Initial sync check
        await this.checkAndSync();

        // Set up periodic monitoring
        this.interval = setInterval(async () => {
            try {
                await this.checkAndSync();
            } catch (error) {
                console.error('❌ Auto-sync check failed:', error.message);
            }
        }, this.config.checkInterval);

        console.log(`✅ Auto-sync monitoring started (checking every ${this.config.checkInterval/1000}s)`);
    }

    /**
     * Stop automated sync monitoring
     */
    stop() {
        if (!this.isRunning) return;

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        this.isRunning = false;
        console.log('⏹️ Auto-sync monitoring stopped');
    }

    /**
     * Check if rawdata has changed and sync if needed
     */
    async checkAndSync() {
        try {
            // Check if rawdata file exists
            const exists = await this.fileExists(this.config.rawDataPath);
            if (!exists) {
                console.log('⚠️ Rawdata file not found:', this.config.rawDataPath);
                return;
            }

            // Calculate current hash
            const currentHash = await this.calculateFileHash(this.config.rawDataPath);

            // Compare with last known hash
            if (currentHash === this.lastHash) {
                console.log('✅ No changes detected in rawdata');
                return;
            }

            console.log('🔄 Changes detected in rawdata - starting sync...');
            console.log(`📊 Hash: ${this.lastHash || 'none'} → ${currentHash}`);

            // Create backup if enabled
            if (this.config.backupOnSync) {
                await this.createBackup();
            }

            // Perform sync
            const result = await this.syncData();

            if (result.success) {
                // Update stored hash
                this.lastHash = currentHash;
                await this.saveLastHash();

                console.log('🎉 Auto-sync completed successfully!');
                console.log(`📈 Synced ${result.totalTransformed} POIs from rawdata`);
            } else {
                console.error('❌ Auto-sync failed:', result.error);
            }

        } catch (error) {
            console.error('💥 Auto-sync check error:', error);
        }
    }

    /**
     * Perform actual data synchronization
     */
    async syncData() {
        try {
            return await this.transformer.transformPOIData(
                this.config.rawDataPath,
                this.config.webDataPath
            );
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Create backup of current web data
     */
    async createBackup() {
        try {
            const exists = await this.fileExists(this.config.webDataPath);
            if (!exists) return;

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(
                path.dirname(this.config.webDataPath),
                'backups',
                `miyakojima_pois_backup_${timestamp}.json`
            );

            // Ensure backup directory exists
            const backupDir = path.dirname(backupPath);
            await fs.mkdir(backupDir, { recursive: true });

            // Copy current web data to backup
            await fs.copyFile(this.config.webDataPath, backupPath);

            console.log('💾 Backup created:', path.basename(backupPath));

            // Clean old backups
            await this.cleanOldBackups(backupDir);

        } catch (error) {
            console.error('⚠️ Backup creation failed:', error.message);
        }
    }

    /**
     * Clean old backup files (keep only maxBackups)
     */
    async cleanOldBackups(backupDir) {
        try {
            const files = await fs.readdir(backupDir);
            const backupFiles = files
                .filter(f => f.startsWith('miyakojima_pois_backup_'))
                .map(f => ({
                    name: f,
                    path: path.join(backupDir, f),
                    stat: null
                }));

            // Get file stats and sort by creation time
            for (const file of backupFiles) {
                file.stat = await fs.stat(file.path);
            }

            backupFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);

            // Delete old backups
            const toDelete = backupFiles.slice(this.config.maxBackups);
            for (const file of toDelete) {
                await fs.unlink(file.path);
                console.log('🗑️ Deleted old backup:', file.name);
            }

        } catch (error) {
            console.error('⚠️ Backup cleanup failed:', error.message);
        }
    }

    /**
     * Calculate SHA-256 hash of a file
     */
    async calculateFileHash(filePath) {
        try {
            const content = await fs.readFile(filePath);
            return crypto.createHash('sha256').update(content).digest('hex');
        } catch (error) {
            console.error('Hash calculation failed:', error.message);
            return null;
        }
    }

    /**
     * Load last known hash from storage
     */
    async loadLastHash() {
        try {
            const exists = await this.fileExists(this.config.hashFilePath);
            if (exists) {
                this.lastHash = await fs.readFile(this.config.hashFilePath, 'utf8');
                console.log('📂 Loaded last hash:', this.lastHash.substring(0, 16) + '...');
            }
        } catch (error) {
            console.log('⚠️ Could not load last hash:', error.message);
            this.lastHash = null;
        }
    }

    /**
     * Save current hash to storage
     */
    async saveLastHash() {
        try {
            if (this.lastHash) {
                await fs.writeFile(this.config.hashFilePath, this.lastHash, 'utf8');
            }
        } catch (error) {
            console.error('⚠️ Could not save hash:', error.message);
        }
    }

    /**
     * Check if file exists
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get sync status information
     */
    async getStatus() {
        const rawExists = await this.fileExists(this.config.rawDataPath);
        const webExists = await this.fileExists(this.config.webDataPath);
        const currentHash = rawExists ? await this.calculateFileHash(this.config.rawDataPath) : null;

        return {
            isRunning: this.isRunning,
            rawDataExists: rawExists,
            webDataExists: webExists,
            lastHash: this.lastHash,
            currentHash: currentHash,
            needsSync: currentHash !== this.lastHash,
            rawDataPath: this.config.rawDataPath,
            webDataPath: this.config.webDataPath,
            checkInterval: this.config.checkInterval
        };
    }

    /**
     * Manual sync trigger
     */
    async manualSync() {
        console.log('🔧 Manual sync triggered...');
        await this.checkAndSync();
    }
}

// CLI interface
async function main() {
    const syncManager = new AutoSyncManager();

    const args = process.argv.slice(2);
    const command = args[0] || 'start';

    switch (command) {
        case 'start':
            await syncManager.start();

            // Keep running until interrupted
            process.on('SIGINT', () => {
                console.log('\n⚠️ Received interrupt signal, stopping...');
                syncManager.stop();
                process.exit(0);
            });

            // Keep the process alive
            await new Promise(() => {});
            break;

        case 'check':
            await syncManager.checkAndSync();
            process.exit(0);
            break;

        case 'status':
            const status = await syncManager.getStatus();
            console.log('📊 Auto-sync Status:');
            console.log('====================');
            console.log('Running:', status.isRunning ? '✅ Yes' : '❌ No');
            console.log('Raw data exists:', status.rawDataExists ? '✅ Yes' : '❌ No');
            console.log('Web data exists:', status.webDataExists ? '✅ Yes' : '❌ No');
            console.log('Needs sync:', status.needsSync ? '🔄 Yes' : '✅ No');
            console.log('Check interval:', status.checkInterval / 1000 + 's');
            console.log('Raw data path:', status.rawDataPath);
            console.log('Web data path:', status.webDataPath);
            process.exit(0);
            break;

        default:
            console.log('📖 Usage: node auto_sync.js [command]');
            console.log('');
            console.log('Commands:');
            console.log('  start   - Start automated sync monitoring (default)');
            console.log('  check   - Perform one-time sync check');
            console.log('  status  - Show current sync status');
            process.exit(0);
    }
}

// Handle process signals
process.on('SIGTERM', () => {
    console.log('⚠️ Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('💥 Auto-sync system error:', error.message);
        process.exit(1);
    });
}

module.exports = AutoSyncManager;