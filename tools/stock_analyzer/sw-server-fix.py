#!/usr/bin/env python3
"""
Service Worker MIME 타입 문제 해결 서버
"""

import http.server
import socketserver
import os
from pathlib import Path

PORT = 8001
DIRECTORY = Path(__file__).parent

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # CORS 헤더
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

        # Service Worker를 위한 올바른 MIME 타입 설정
        path = self.path.lower()
        if path.endswith('.js') or path.endswith('/sw.js'):
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
        elif path.endswith('.json'):
            self.send_header('Content-Type', 'application/json; charset=utf-8')
        elif path.endswith('.html'):
            self.send_header('Content-Type', 'text/html; charset=utf-8')
        elif path.endswith('.css'):
            self.send_header('Content-Type', 'text/css; charset=utf-8')

        super().end_headers()

    def guess_type(self, path):
        """MIME 타입 강제 설정"""
        if path.endswith('.js'):
            return ('application/javascript', None)
        elif path.endswith('.json'):
            return ('application/json', None)
        elif path.endswith('.html'):
            return ('text/html', None)
        elif path.endswith('.css'):
            return ('text/css', None)
        else:
            mimetype = super().guess_type(path)
            # .js 파일인데 text/plain으로 인식되는 경우 강제 변경
            if mimetype and mimetype[0] == 'text/plain' and path.endswith('.js'):
                return ('application/javascript', None)
            return mimetype

def main():
    print("🚀 Stock Analyzer 서버 시작 (MIME 타입 수정 버전)")
    print(f"포트: {PORT}")
    print(f"디렉토리: {DIRECTORY}")
    print("-" * 50)
    print("✅ Service Worker MIME 타입: application/javascript")
    print("✅ JSON MIME 타입: application/json")
    print("-" * 50)

    with socketserver.TCPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
        print(f"서버 실행 중: http://localhost:{PORT}")
        print(f"메인 페이지: http://localhost:{PORT}/stock_analyzer.html")
        print(f"디버그 도구: http://localhost:{PORT}/debug_data_loading.html")
        print("Ctrl+C로 종료")

        httpd.serve_forever()

if __name__ == "__main__":
    main()