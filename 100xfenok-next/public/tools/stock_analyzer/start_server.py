#!/usr/bin/env python3
"""
Stock Analyzer 로컬 서버 실행 스크립트
Python HTTP 서버를 사용하여 CORS 문제 없이 애플리케이션을 실행합니다.
"""

import http.server
import socketserver
import webbrowser
import os
import sys
from pathlib import Path

# 설정
PORT = 8002
HOST = 'localhost'

def main():
    # 현재 스크립트가 있는 디렉토리로 이동
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    print(f"Stock Analyzer 서버를 시작합니다...")
    print(f"포트: {PORT}")
    print(f"디렉토리: {script_dir}")
    print("-" * 50)
    
    # HTTP 서버 설정
    Handler = http.server.SimpleHTTPRequestHandler
    
    try:
        with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
            server_url = f"http://{HOST}:{PORT}"
            print(f"서버가 실행되었습니다: {server_url}")
            print(f"브라우저에서 {server_url}에 접속하세요")
            print("서버를 중지하려면 Ctrl+C를 누르세요")
            print("-" * 50)
            
            # 자동으로 브라우저 열기 (선택사항)
            try:
                webbrowser.open(server_url)
                print("브라우저가 자동으로 열렸습니다.")
            except Exception as e:
                print(f"브라우저를 자동으로 열 수 없습니다: {e}")
                print(f"수동으로 {server_url}에 접속해주세요.")
            
            # 서버 실행
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n서버를 중지합니다...")
        sys.exit(0)
    except OSError as e:
        if e.errno == 48:  # Address already in use
            print(f"오류: 포트 {PORT}가 이미 사용 중입니다.")
            print("다른 서버를 중지하거나 다른 포트를 사용해주세요.")
        else:
            print(f"서버 시작 오류: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"예상치 못한 오류: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()