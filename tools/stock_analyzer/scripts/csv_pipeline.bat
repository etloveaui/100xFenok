@echo off
REM CSV Conversion Pipeline for Stock Analyzer Global Expansion (Windows)
REM Automates the process of converting Global Scouter CSV files to JSON
REM
REM Usage: csv_pipeline.bat [options]
REM Options:
REM   batch    - Run in batch mode (convert all CSV files)
REM   watch    - Watch mode (auto-convert on file changes)
REM   test     - Run conversion tests
REM   help     - Show help message

setlocal enabledelayedexpansion

REM Set directories
set SCRIPT_DIR=%~dp0
set PROJECT_ROOT=%SCRIPT_DIR%..
set INPUT_DIR=%PROJECT_ROOT%\data\csv
set OUTPUT_DIR=%PROJECT_ROOT%\data
set CONFIG_FILE=%PROJECT_ROOT%\config\csv_config.json
set PYTHON_SCRIPT=%PROJECT_ROOT%\tools\csv_to_json_converter.py
set LOG_DIR=%PROJECT_ROOT%\logs
set REPORTS_DIR=%PROJECT_ROOT%\reports

REM Set colors (Windows 10+)
set RED=[91m
set GREEN=[92m
set YELLOW=[93m
set BLUE=[94m
set NC=[0m

REM Create timestamp
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set DATE=%%c%%a%%b
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set TIME=%%a%%b
set TIMESTAMP=%DATE%_%TIME: =%
set LOG_FILE=%LOG_DIR%\csv_pipeline_%TIMESTAMP%.log

REM Parse arguments
set MODE=batch
if "%1"=="batch" set MODE=batch
if "%1"=="watch" set MODE=watch
if "%1"=="test" set MODE=test
if "%1"=="help" goto :HELP

REM Main execution
:MAIN
echo %BLUE%═══════════════════════════════════════════%NC%
echo %BLUE% CSV Conversion Pipeline (Windows)%NC%
echo %BLUE%═══════════════════════════════════════════%NC%
echo.

REM Check dependencies
call :CHECK_DEPENDENCIES
if %ERRORLEVEL% neq 0 goto :ERROR

REM Create directories
if not exist "%INPUT_DIR%" mkdir "%INPUT_DIR%"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%REPORTS_DIR%" mkdir "%REPORTS_DIR%"

REM Execute based on mode
if "%MODE%"=="test" goto :TEST
if "%MODE%"=="watch" goto :WATCH
if "%MODE%"=="batch" goto :BATCH

:BATCH
echo %BLUE%Running batch conversion...%NC%
echo Starting batch conversion >> "%LOG_FILE%"

set TOTAL=0
set SUCCESS=0
set FAILED=0

REM Process all CSV files
for %%F in ("%INPUT_DIR%\*.csv") do (
    set /a TOTAL+=1
    echo.
    echo %YELLOW%Converting: %%~nxF%NC%

    python "%PYTHON_SCRIPT%" "%%F" -o "%OUTPUT_DIR%\%%~nF.json" -c "%CONFIG_FILE%" >> "%LOG_FILE%" 2>&1

    if !ERRORLEVEL! equ 0 (
        echo %GREEN%✓ Successfully converted %%~nxF%NC%
        echo SUCCESS: %%~nxF >> "%LOG_FILE%"
        set /a SUCCESS+=1
    ) else (
        echo %RED%✗ Failed to convert %%~nxF%NC%
        echo FAILED: %%~nxF >> "%LOG_FILE%"
        set /a FAILED+=1
    )
)

REM Print summary
echo.
echo %BLUE%Batch Conversion Summary:%NC%
echo   Total files: %TOTAL%
echo   %GREEN%Successful: %SUCCESS%%NC%
if %FAILED% gtr 0 (
    echo   %RED%Failed: %FAILED%%NC%
)

REM Generate quality report
call :GENERATE_REPORT

goto :END

:WATCH
echo %BLUE%Starting watch mode...%NC%
echo %YELLOW%Watching %INPUT_DIR% for changes. Press Ctrl+C to stop.%NC%

:WATCH_LOOP
REM Simple polling mechanism for Windows
for %%F in ("%INPUT_DIR%\*.csv") do (
    REM Check if file was modified recently (simplified check)
    forfiles /P "%INPUT_DIR%" /M "%%~nxF" /D +0 /C "cmd /c echo @file modified" 2>nul | find "modified" >nul
    if !ERRORLEVEL! equ 0 (
        echo %YELLOW%File changed: %%~nxF%NC%
        python "%PYTHON_SCRIPT%" "%%F" -o "%OUTPUT_DIR%\%%~nF.json" -c "%CONFIG_FILE%"

        if !ERRORLEVEL! equ 0 (
            echo %GREEN%✓ Converted %%~nxF%NC%
        ) else (
            echo %RED%✗ Failed to convert %%~nxF%NC%
        )
    )
)

REM Wait before next check
timeout /t 2 /nobreak >nul
goto :WATCH_LOOP

:TEST
echo %BLUE%Running conversion tests...%NC%

REM Create test CSV
set TEST_CSV=%INPUT_DIR%\test_data.csv
(
    echo Ticker,종목명,Price,PER ^(Oct-25^),PBR ^(Oct-25^),ROE ^(Fwd^),시가총액 ^($M^),YTD
    echo AAPL,Apple Inc.,150.00,25.5,35.2,45.8,2500000,15.5
    echo MSFT,Microsoft Corp.,300.00,30.2,12.5,38.2,2200000,22.3
    echo GOOGL,Alphabet Inc.,2800.00,28.5,6.8,25.6,1800000,35.2
) > "%TEST_CSV%"

REM Convert test file
echo Testing CSV conversion...
python "%PYTHON_SCRIPT%" "%TEST_CSV%" -o "%OUTPUT_DIR%\test_data.json" -c "%CONFIG_FILE%"

if %ERRORLEVEL% equ 0 (
    echo %GREEN%✓ Test conversion successful%NC%

    REM Verify JSON structure
    python -c "import json; json.load(open(r'%OUTPUT_DIR%\test_data.json'))" 2>nul
    if !ERRORLEVEL! equ 0 (
        echo %GREEN%✓ JSON structure valid%NC%
    ) else (
        echo %RED%✗ Invalid JSON structure%NC%
    )
) else (
    echo %RED%✗ Test conversion failed%NC%
)

REM Cleanup
del "%TEST_CSV%" 2>nul
del "%OUTPUT_DIR%\test_data.json" 2>nul

goto :END

:CHECK_DEPENDENCIES
echo %BLUE%Checking dependencies...%NC%

REM Check Python
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo %RED%Error: Python is not installed or not in PATH%NC%
    exit /b 1
)

REM Check converter script
if not exist "%PYTHON_SCRIPT%" (
    echo %RED%Error: Converter script not found at %PYTHON_SCRIPT%%NC%
    exit /b 1
)

echo %GREEN%✓ Dependencies checked%NC%
exit /b 0

:GENERATE_REPORT
echo %BLUE%Generating quality report...%NC%

set REPORT_FILE=%REPORTS_DIR%\conversion_quality_%TIMESTAMP%.txt

(
    echo CSV Conversion Quality Report
    echo Generated: %DATE% %TIME%
    echo ===============================
    echo.
    echo Files Processed:
) > "%REPORT_FILE%"

REM List all JSON files and their stats
for %%F in ("%OUTPUT_DIR%\*.json") do (
    echo   - %%~nxF >> "%REPORT_FILE%"
)

echo.
echo %GREEN%✓ Report generated: %REPORT_FILE%%NC%
exit /b 0

:HELP
echo CSV Conversion Pipeline for Stock Analyzer Global Expansion
echo.
echo Usage: %~nx0 [mode]
echo.
echo Modes:
echo   batch    Run in batch mode (convert all CSV files)
echo   watch    Watch mode (auto-convert on file changes)
echo   test     Run conversion tests
echo   help     Show this help message
echo.
echo Examples:
echo   %~nx0 batch    - Convert all CSV files
echo   %~nx0 watch    - Watch for changes
echo   %~nx0 test     - Run tests
echo.
echo Configuration:
echo   Input:  %INPUT_DIR%
echo   Output: %OUTPUT_DIR%
echo   Config: %CONFIG_FILE%
echo.
goto :EOF

:ERROR
echo %RED%Error occurred. Check log file: %LOG_FILE%%NC%
exit /b 1

:END
echo.
echo %GREEN%✓ Pipeline completed%NC%
if exist "%LOG_FILE%" echo Check logs at: %LOG_FILE%

endlocal