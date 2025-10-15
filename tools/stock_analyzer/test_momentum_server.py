#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Momentum Module Test Server
Phase 2: Momentum Core Testing
"""

import http.server
import socketserver
import os
import webbrowser
from pathlib import Path

PORT = 8002  # Different port to avoid conflicts
DIRECTORY = Path(__file__).parent

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Set MIME type for JavaScript modules
        if self.path.endswith('.js'):
            self.send_header('Content-Type', 'application/javascript')
        super().end_headers()

def main():
    print("Momentum Module Test Server")
    print("=" * 50)
    print(f"Port: {PORT}")
    print(f"Directory: {DIRECTORY}")
    print("=" * 50)

    # Check Momentum module files
    momentum_files = [
        'modules/Momentum/MomentumCalculator.js',
        'modules/Momentum/RankingEngine.js',
        'modules/Momentum/FilterEngine.js',
        'modules/Momentum/MomentumVisualizer.js',
        'modules/Momentum/M_Company.js',
        'modules/Momentum/CompanyDetailView.js',
        'modules/Momentum/CompanyComparison.js',
        'test_momentum_modules.html'
    ]

    print("Momentum module files check:")
    missing_files = []
    for file in momentum_files:
        file_path = DIRECTORY / file
        if file_path.exists():
            size_kb = file_path.stat().st_size / 1024
            print(f"   [OK] {file} ({size_kb:.1f}KB)")
        else:
            missing_files.append(file)
            print(f"   [MISSING] {file}")

    if missing_files:
        print("\nWARNING: Some files are missing. Continue? (y/n)")
        response = input().strip().lower()
        if response != 'y':
            print("Server start cancelled")
            return

    print("\n" + "=" * 50)

    try:
        with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
            print(f"Server running at: http://localhost:{PORT}")
            print(f"Momentum Test Page: http://localhost:{PORT}/test_momentum_modules.html")
            print(f"Main App: http://localhost:{PORT}/stock_analyzer.html")
            print("\nPress Ctrl+C to stop the server")
            print("=" * 50)

            # Auto-open browser
            webbrowser.open(f'http://localhost:{PORT}/test_momentum_modules.html')

            httpd.serve_forever()

    except KeyboardInterrupt:
        print("\n\nServer stopped")
    except OSError as e:
        if e.errno == 10048:  # Windows: Address already in use
            print(f"\nERROR: Port {PORT} is already in use.")
            print("Try one of the following:")
            print("1. Stop the other server")
            print("2. Try again later")
            print("3. Change the PORT value in the script")
        else:
            print(f"Server start error: {e}")

if __name__ == "__main__":
    main()