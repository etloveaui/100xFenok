@echo off
REM Test Runner - Windows Batch Script  
REM Executes comprehensive test suite for POI expansion system

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

REM Create logs directory if it doesn't exist
if not exist "logs" mkdir logs

echo.
echo ================================================
echo POI Expansion System - Test Suite Runner
echo ================================================
echo.

REM Execute test runner with all arguments
python tests\run_tests.py %*
set EXIT_CODE=%ERRORLEVEL%

echo.
echo ================================================
if %EXIT_CODE% EQU 0 (
    echo All tests passed successfully!
) else if %EXIT_CODE% EQU 130 (
    echo Tests cancelled by user
) else (
    echo Some tests failed - check output above
)
echo ================================================

REM Pause if running interactively
if "%~1"=="" (
    echo.
    echo Press any key to continue...
    pause >nul
)

exit /b %EXIT_CODE%