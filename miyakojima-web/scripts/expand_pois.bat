@echo off
REM POI Expansion System - Windows Batch Script
REM Provides easy Windows execution of POI expansion operations

setlocal enabledelayedexpansion

REM Get the directory of this script
set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..

REM Change to project directory
cd /d "%PROJECT_DIR%"

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.7+ and add it to your PATH
    pause
    exit /b 1
)

REM Check Python version (require 3.7+)
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo Using Python %PYTHON_VERSION%

REM Create logs directory if it doesn't exist
if not exist "logs" mkdir logs

REM Execute the POI expansion script with all arguments
echo.
echo ================================================
echo POI Expansion System - Windows Launcher
echo ================================================
echo.

python scripts\expand_pois.py %*
set EXIT_CODE=%ERRORLEVEL%

echo.
echo ================================================
if %EXIT_CODE% EQU 0 (
    echo Operation completed successfully
) else if %EXIT_CODE% EQU 130 (
    echo Operation cancelled by user
) else (
    echo Operation failed with error code: %EXIT_CODE%
)
echo ================================================

REM Pause if running interactively (not from command line with arguments)
if "%~1"=="" (
    echo.
    echo Press any key to continue...
    pause >nul
)

exit /b %EXIT_CODE%