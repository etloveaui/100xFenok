#!/usr/bin/env python3
"""
간단한 테스트 서버
47개 지표 데이터가 제대로 로딩되는지 확인
"""

import http.server
import socketserver
import os
import webbrowser
from pathlib import Path

PORT = 8001  # 다른 포트 사용
DIRECTORY = Path(__file__).parent

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

def main():
    print("🧪 47개 지표 테스트 서버 시작")
    print(f"포트: {PORT}")
    print(f"디렉토리: {DIRECTORY}")
    print("-" * 50)
    
    # 필수 파일 확인
    required_files = [
        'data/enhanced_summary_data.json',
        'data/column_config.json',
        'simple_test.html'
    ]
    
    missing_files = []
    for file in required_files:
        if not (DIRECTORY / file).exists():
            missing_files.append(file)
    
    if missing_files:
        print("❌ 필수 파일이 없습니다:")
        for file in missing_files:
            print(f"   - {file}")
        return
    
    # 데이터 파일 크기 확인
    data_file = DIRECTORY / 'data/enhanced_summary_data.json'
    if data_file.exists():
        size_mb = data_file.stat().st_size / 1024 / 1024
        print(f"📊 데이터 파일 크기: {size_mb:.1f}MB")
    
    try:
        with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
            print(f"✅ 서버 실행 중: http://localhost:{PORT}")
            print(f"🧪 테스트 페이지: http://localhost:{PORT}/simple_test.html")
            print("Ctrl+C로 종료")
            
            # 브라우저 자동 열기
            webbrowser.open(f'http://localhost:{PORT}/simple_test.html')
            
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\\n서버 종료")
    except OSError as e:
        if e.errno == 10048:  # Address already in use
            print(f"❌ 포트 {PORT}가 이미 사용 중입니다.")
            print("다른 서버를 종료하거나 잠시 후 다시 시도해주세요.")
        else:
            print(f"서버 시작 오류: {e}")

if __name__ == "__main__":
    main()