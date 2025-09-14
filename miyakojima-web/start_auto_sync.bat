@echo off
echo ============================================
echo 🚀 Miyakojima Auto-Sync System
echo ============================================
echo.
echo Starting automated data synchronization...
echo Press Ctrl+C to stop monitoring
echo.

cd /d "%~dp0"
node scripts/auto_sync.cjs start

pause