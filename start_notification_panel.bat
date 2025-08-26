@echo off
echo ====================================
echo 100xFenok 알림 컨트롤 패널 시작
echo ====================================

echo Flask 라이브러리 설치 중...
pip install flask flask-cors

echo.
echo 알림 컨트롤 패널 서버 시작 중...
echo 브라우저에서 http://localhost:5000 접속하세요.
echo.

python notification_api.py

pause