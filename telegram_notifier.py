#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
100xFenok Telegram Notification System
Created: 2025-08-17

This module provides Telegram notification functionality for the 100xFenok project.
It integrates with Google Sheets for user management and sends notifications when
new Daily Wrap reports are published.

Dependencies:
    - google-api-python-client
    - google-auth
    - requests
    - python-dateutil

Usage:
    from telegram_notifier import TelegramNotifier
    
    notifier = TelegramNotifier()
    success = notifier.send_daily_wrap_notification(
        title="2025-08-17 100x Daily Wrap",
        url="https://your-site.com/100x/daily-wrap/2025-08-17_100x-daily-wrap.html",
        summary="오늘의 주요 시장 동향과 투자 기회를 확인하세요."
    )
"""

import os
import json
import requests
import logging
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from pathlib import Path

# Google Sheets API imports
try:
    from googleapiclient.discovery import build
    from google.auth.transport.requests import Request
    from google.oauth2.service_account import Credentials
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False
    logging.warning("Google API libraries not available. Google Sheets functionality will be disabled.")


class TelegramNotifier:
    """
    텔레그램 알림 시스템 메인 클래스
    
    Google Sheets에서 사용자 Chat ID를 읽어와서 
    텔레그램 봇을 통해 알림을 발송하는 기능을 제공합니다.
    """
    
    def __init__(self, config_path: Optional[str] = None):
        """
        TelegramNotifier 초기화
        
        Args:
            config_path (str, optional): 설정 파일 경로. 기본값은 ./config/telegram_config.json
        """
        self.config_path = config_path or os.path.join(os.path.dirname(__file__), 'config', 'telegram_config.json')
        self.config = self._load_config()
        self.logger = self._setup_logging()
        
        # Google Sheets 서비스 초기화
        self.sheets_service = None
        if GOOGLE_AVAILABLE:
            self._init_google_sheets()
    
    def _load_config(self) -> Dict:
        """설정 파일 로드"""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            # 기본 설정 반환
            return {
                "telegram": {
                    "bot_token_file": "../secrets/my_sensitive_data.md",
                    "api_url": "https://api.telegram.org/bot"
                },
                "google_sheets": {
                    "service_account_file": "../secrets/google_service_account.json",
                    "spreadsheet_id": "",
                    "chat_ids_sheet": "ChatIDs",
                    "logs_sheet": "100xFenok_Logs"
                },
                "notification": {
                    "retry_attempts": 3,
                    "timeout": 30
                }
            }
    
    def _setup_logging(self) -> logging.Logger:
        """로깅 설정"""
        logger = logging.getLogger('TelegramNotifier')
        logger.setLevel(logging.INFO)
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        return logger
    
    def _init_google_sheets(self):
        """Google Sheets API 초기화"""
        if not GOOGLE_AVAILABLE:
            return
            
        try:
            service_account_file = self.config['google_sheets']['service_account_file']
            service_account_path = os.path.join(os.path.dirname(__file__), service_account_file)
            
            if not os.path.exists(service_account_path):
                self.logger.warning(f"Google Service Account file not found: {service_account_path}")
                return
            
            credentials = Credentials.from_service_account_file(
                service_account_path,
                scopes=['https://www.googleapis.com/auth/spreadsheets']
            )
            
            self.sheets_service = build('sheets', 'v4', credentials=credentials)
            self.logger.info("Google Sheets API initialized successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to initialize Google Sheets API: {e}")
            self.sheets_service = None
    
    def _get_bot_token(self) -> Optional[str]:
        """텔레그램 봇 토큰 읽기"""
        try:
            token_file = self.config['telegram']['bot_token_file']
            token_path = os.path.join(os.path.dirname(__file__), token_file)
            
            with open(token_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # secrets 파일에서 텔레그램 봇 토큰 추출
            # 여러 형식 지원
            import re
            
            # 형식 1: ### Telegram Bot (100xFenok 알림용) 섹션에서 Bot Token 찾기
            lines = content.split('\n')
            in_telegram_section = False
            
            for line in lines:
                # 텔레그램 섹션 시작 감지
                if '### Telegram Bot' in line:
                    in_telegram_section = True
                    continue
                
                # 다음 섹션 시작하면 종료
                if in_telegram_section and line.startswith('###') and 'Telegram' not in line:
                    break
                
                # 텔레그램 섹션 내에서 토큰 찾기
                if in_telegram_section:
                    # Bot Token: 라인에서 토큰 추출
                    if 'Bot Token' in line or 'bot token' in line.lower():
                        token_match = re.search(r'(\d+:[A-Za-z0-9_-]+)', line)
                        if token_match:
                            return token_match.group(1)
            
            # 형식 2: 일반적인 bot 토큰 패턴 찾기
            token_match = re.search(r'(\d+:[A-Za-z0-9_-]+)', content)
            if token_match:
                return token_match.group(1)
            
            self.logger.error("Telegram bot token not found in secrets file")
            return None
            
        except Exception as e:
            self.logger.error(f"Failed to read bot token: {e}")
            return None
    
    def get_chat_ids(self) -> List[str]:
        """
        하드코딩된 Chat ID 목록 반환
        
        Returns:
            List[str]: Chat ID 목록
        """
        # 하드코딩된 Chat ID 목록 (실제 환경에서 사용)
        hardcoded_chat_ids = [
            "-1001513671466",  # 그룹 Chat ID
            "6443399098",      # 개인 Chat ID 1
            "1697642019",      # 개인 Chat ID 2
        ]
        
        # Google Sheets 사용 시도 (옵션)
        if self.sheets_service:
            try:
                spreadsheet_id = self.config['google_sheets']['spreadsheet_id']
                sheet_name = self.config['google_sheets']['chat_ids_sheet']
                
                if spreadsheet_id:
                    result = self.sheets_service.spreadsheets().values().get(
                        spreadsheetId=spreadsheet_id,
                        range=f'{sheet_name}!A:A'
                    ).execute()
                    
                    values = result.get('values', [])
                    sheets_chat_ids = []
                    
                    for row in values[1:]:  # 첫 번째 행은 헤더로 가정
                        if row and row[0].strip():
                            sheets_chat_ids.append(row[0].strip())
                    
                    if sheets_chat_ids:
                        self.logger.info(f"Retrieved {len(sheets_chat_ids)} chat IDs from Google Sheets")
                        return sheets_chat_ids
                        
            except Exception as e:
                self.logger.warning(f"Failed to get chat IDs from Google Sheets: {e}")
        
        # Google Sheets 실패 시 하드코딩된 목록 사용
        self.logger.info(f"Using hardcoded chat IDs: {len(hardcoded_chat_ids)} recipients")
        return hardcoded_chat_ids
    
    def send_telegram_message(self, chat_id: str, message: str) -> Tuple[bool, str]:
        """
        개별 텔레그램 메시지 발송
        
        Args:
            chat_id (str): 수신자 Chat ID
            message (str): 발송할 메시지
            
        Returns:
            Tuple[bool, str]: (성공 여부, 상세 메시지)
        """
        bot_token = self._get_bot_token()
        if not bot_token:
            return False, "Bot token not available"
        
        url = f"{self.config['telegram']['api_url']}{bot_token}/sendMessage"
        
        payload = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'Markdown',
            'disable_web_page_preview': False
        }
        
        try:
            response = requests.post(
                url,
                json=payload,
                timeout=self.config['notification']['timeout']
            )
            
            if response.status_code == 200:
                self.logger.info(f"Message sent successfully to {chat_id}")
                return True, "Success"
            else:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                self.logger.error(f"Failed to send message to {chat_id}: {error_msg}")
                return False, error_msg
                
        except Exception as e:
            error_msg = f"Exception: {str(e)}"
            self.logger.error(f"Failed to send message to {chat_id}: {error_msg}")
            return False, error_msg
    
    def log_notification_result(self, timestamp: str, status: str, details: str):
        """
        Google Sheets에 알림 발송 결과 로깅
        
        Args:
            timestamp (str): 발송 시간
            status (str): 발송 상태 (Success/Failed)
            details (str): 상세 내용
        """
        if not self.sheets_service:
            return
        
        try:
            spreadsheet_id = self.config['google_sheets']['spreadsheet_id']
            sheet_name = self.config['google_sheets']['logs_sheet']
            
            if not spreadsheet_id:
                return
            
            values = [[timestamp, status, details]]
            
            self.sheets_service.spreadsheets().values().append(
                spreadsheetId=spreadsheet_id,
                range=f'{sheet_name}!A:C',
                valueInputOption='RAW',
                body={'values': values}
            ).execute()
            
            self.logger.info("Notification result logged to Google Sheets")
            
        except Exception as e:
            self.logger.error(f"Failed to log to Google Sheets: {e}")
    
    def send_daily_wrap_notification(self, title: str, file_path: str, summary: str = "") -> bool:
        """
        Daily Wrap 새 포스팅 알림 발송
        
        Args:
            title (str): 리포트 제목
            file_path (str): 리포트 파일 경로 (예: 100x/daily-wrap/2025-08-17_100x-daily-wrap.html)
            summary (str): 리포트 요약 (선택사항)
            
        Returns:
            bool: 전체 발송 성공 여부
        """
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # GitHub Pages URL 구성
        base_url = "https://etloveaui.github.io/100xFenok/"
        full_url = f"{base_url}?path={file_path}"
        
        # 메시지 구성
        message = f"""🚀 **새로운 100x Daily Wrap이 발행되었습니다!**

📊 **{title}**

{summary}

🔗 [리포트 보기]({full_url})

💡 오늘의 시장 인사이트와 투자 기회를 놓치지 마세요!

---
_100x FenoK | 투자의 시작_"""

        chat_ids = self.get_chat_ids()
        
        if not chat_ids:
            self.logger.warning("No chat IDs available for notification")
            self.log_notification_result(timestamp, "Failed", "No chat IDs available")
            return False
        
        success_count = 0
        failed_count = 0
        
        for chat_id in chat_ids:
            success, details = self.send_telegram_message(chat_id, message)
            if success:
                success_count += 1
            else:
                failed_count += 1
        
        # 결과 로깅
        result_details = f"Sent to {success_count} users, {failed_count} failed. Title: {title}"
        overall_status = "Success" if failed_count == 0 else "Partial" if success_count > 0 else "Failed"
        
        self.log_notification_result(timestamp, overall_status, result_details)
        
        self.logger.info(f"Notification completed: {success_count} success, {failed_count} failed")
        
        return failed_count == 0
    
    def test_connection(self) -> Dict[str, bool]:
        """
        연결 상태 테스트
        
        Returns:
            Dict[str, bool]: 각 서비스별 연결 상태
        """
        results = {
            'telegram_bot': False,
            'google_sheets': False
        }
        
        # 텔레그램 봇 테스트
        bot_token = self._get_bot_token()
        if bot_token:
            try:
                url = f"{self.config['telegram']['api_url']}{bot_token}/getMe"
                response = requests.get(url, timeout=10)
                results['telegram_bot'] = response.status_code == 200
            except:
                pass
        
        # Google Sheets 테스트
        results['google_sheets'] = self.sheets_service is not None
        
        return results


def main():
    """테스트 실행용 메인 함수"""
    notifier = TelegramNotifier()
    
    # 연결 테스트
    print("=== Connection Test ===")
    connections = notifier.test_connection()
    for service, status in connections.items():
        status_text = "OK" if status else "Failed"
        print(f"{service}: {status_text}")
    
    # 설정 정보 출력
    print(f"\n=== Configuration ===")
    print(f"Config file: {notifier.config_path}")
    print(f"Google Sheets available: {GOOGLE_AVAILABLE}")
    
    # Chat IDs 테스트
    print(f"\n=== Chat IDs Test ===")
    chat_ids = notifier.get_chat_ids()
    print(f"Found {len(chat_ids)} chat IDs")


if __name__ == "__main__":
    main()