@echo off
echo Stock Analyzer 로컬 서버를 시작합니다...
echo.

REM 현재 디렉토리를 스크립트가 있는 위치로 변경
cd /d "%~dp0"

REM Python이 설치되어 있는지 확인
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 오류: Python이 설치되어 있지 않습니다.
    echo Python을 설치한 후 다시 시도해주세요.
    echo https://www.python.org/downloads/
    pause
    exit /b 1
)

echo Python HTTP 서버를 포트 8000에서 시작합니다...
echo 브라우저에서 http://localhost:8000 에 접속하세요
echo.
echo 서버를 중지하려면 Ctrl+C를 누르세요
echo ================================================

REM Python HTTP 서버 실행
python -m http.server 8000

pause