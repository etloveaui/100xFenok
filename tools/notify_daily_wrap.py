#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
100xFenok Daily Wrap Notification Trigger
Created: 2025-08-17

This script integrates Telegram notifications into the existing 100xFenok workflow.
It can be called after a new Daily Wrap HTML file is successfully generated.

Usage:
    # Manual notification for latest report
    python tools/notify_daily_wrap.py

    # Specific date notification
    python tools/notify_daily_wrap.py --date 2025-08-17

    # Custom notification
    python tools/notify_daily_wrap.py --title "Custom Title" --url "https://..." --summary "..."
"""

import os
import sys
import argparse
import json
from datetime import datetime, date
from pathlib import Path

# Add parent directory to path for importing telegram_notifier
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from telegram_notifier import TelegramNotifier
except ImportError:
    print("❌ Error: telegram_notifier module not found")
    print("Please ensure telegram_notifier.py is in the project root directory")
    sys.exit(1)


class DailyWrapNotificationTrigger:
    """Daily Wrap 리포트 알림 트리거 클래스"""
    
    def __init__(self):
        self.base_dir = Path(__file__).parent.parent
        self.daily_wrap_dir = self.base_dir / "100x" / "daily-wrap"
        self.data_dir = self.base_dir / "100x" / "data"
        self.notifier = TelegramNotifier()
    
    def find_latest_daily_wrap(self) -> tuple[str, str, str]:
        """
        가장 최근의 Daily Wrap 파일 찾기
        
        Returns:
            tuple: (file_path, title, date_str)
        """
        if not self.daily_wrap_dir.exists():
            raise FileNotFoundError(f"Daily wrap directory not found: {self.daily_wrap_dir}")
        
        # YYYY-MM-DD_100x-daily-wrap.html 패턴의 파일들 찾기
        pattern = "*_100x-daily-wrap.html"
        daily_wrap_files = list(self.daily_wrap_dir.glob(pattern))
        
        if not daily_wrap_files:
            raise FileNotFoundError(f"No daily wrap files found in {self.daily_wrap_dir}")
        
        # 날짜 기준으로 정렬하여 가장 최근 파일 선택
        daily_wrap_files.sort(key=lambda x: x.name, reverse=True)
        latest_file = daily_wrap_files[0]
        
        # 파일명에서 날짜 추출 (YYYY-MM-DD)
        date_str = latest_file.name.split('_')[0]
        title = f"{date_str} 100x Daily Wrap"
        
        return str(latest_file), title, date_str
    
    def get_metadata_summary(self, date_str: str) -> str:
        """
        메타데이터에서 요약 정보 가져오기
        
        Args:
            date_str (str): YYYY-MM-DD 형식의 날짜
            
        Returns:
            str: 요약 텍스트
        """
        metadata_file = self.data_dir / "metadata" / f"{date_str}.json"
        
        if not metadata_file.exists():
            return "오늘의 주요 시장 동향과 투자 기회를 확인하세요."
        
        try:
            with open(metadata_file, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            
            # 메타데이터에서 요약 정보 추출
            summary = metadata.get('summary', '')
            if not summary:
                # keywords에서 요약 생성
                keywords = metadata.get('keywords', [])
                if keywords:
                    keyword_names = [kw.get('name', '') for kw in keywords[:3]]
                    summary = f"주요 키워드: {', '.join(keyword_names)}"
                else:
                    summary = "오늘의 주요 시장 동향과 투자 기회를 확인하세요."
            
            return summary
            
        except Exception as e:
            print(f"⚠️ Warning: Failed to read metadata for {date_str}: {e}")
            return "오늘의 주요 시장 동향과 투자 기회를 확인하세요."
    
    def generate_report_file_path(self, date_str: str) -> str:
        """
        리포트 파일 경로 생성 (GitHub Pages용)
        
        Args:
            date_str (str): YYYY-MM-DD 형식의 날짜
            
        Returns:
            str: 파일 경로 (100x/daily-wrap/YYYY-MM-DD_100x-daily-wrap.html)
        """
        return f"100x/daily-wrap/{date_str}_100x-daily-wrap.html"
    
    def notify_latest_report(self) -> bool:
        """
        가장 최근 리포트에 대한 알림 발송
        
        Returns:
            bool: 알림 발송 성공 여부
        """
        try:
            file_path, title, date_str = self.find_latest_daily_wrap()
            print(f"Found latest report: {file_path}")
            
            summary = self.get_metadata_summary(date_str)
            report_file_path = self.generate_report_file_path(date_str)
            
            print(f"Title: {title}")
            print(f"File Path: {report_file_path}")
            print(f"Summary: {summary}")
            
            success = self.notifier.send_daily_wrap_notification(
                title=title,
                file_path=report_file_path,
                summary=summary
            )
            
            if success:
                print("Notification sent successfully!")
            else:
                print("Failed to send notification")
            
            return success
            
        except Exception as e:
            print(f"Error: {e}")
            return False
    
    def notify_specific_date(self, target_date: str) -> bool:
        """
        특정 날짜 리포트에 대한 알림 발송
        
        Args:
            target_date (str): YYYY-MM-DD 형식의 날짜
            
        Returns:
            bool: 알림 발송 성공 여부
        """
        try:
            # 날짜 형식 검증
            datetime.strptime(target_date, '%Y-%m-%d')
            
            file_path = self.daily_wrap_dir / f"{target_date}_100x-daily-wrap.html"
            
            if not file_path.exists():
                print(f"Error: Report file not found for date {target_date}")
                return False
            
            title = f"{target_date} 100x Daily Wrap"
            summary = self.get_metadata_summary(target_date)
            report_file_path = self.generate_report_file_path(target_date)
            
            print(f"Title: {title}")
            print(f"File Path: {report_file_path}")
            print(f"Summary: {summary}")
            
            success = self.notifier.send_daily_wrap_notification(
                title=title,
                file_path=report_file_path,
                summary=summary
            )
            
            if success:
                print("Notification sent successfully!")
            else:
                print("Failed to send notification")
            
            return success
            
        except ValueError:
            print(f"Error: Invalid date format '{target_date}'. Use YYYY-MM-DD format.")
            return False
        except Exception as e:
            print(f"Error: {e}")
            return False
    
    def notify_custom(self, title: str, file_path: str, summary: str = "") -> bool:
        """
        커스텀 알림 발송
        
        Args:
            title (str): 제목
            file_path (str): 파일 경로 (예: 100x/daily-wrap/2025-08-17_100x-daily-wrap.html)
            summary (str): 요약
            
        Returns:
            bool: 알림 발송 성공 여부
        """
        try:
            print(f"Title: {title}")
            print(f"File Path: {file_path}")
            print(f"Summary: {summary}")
            
            success = self.notifier.send_daily_wrap_notification(
                title=title,
                file_path=file_path,
                summary=summary
            )
            
            if success:
                print("Notification sent successfully!")
            else:
                print("Failed to send notification")
            
            return success
            
        except Exception as e:
            print(f"Error: {e}")
            return False


def main():
    """메인 함수"""
    parser = argparse.ArgumentParser(
        description="Send Telegram notification for 100xFenok Daily Wrap reports"
    )
    parser.add_argument(
        '--date', 
        type=str, 
        help='Specific date to notify (YYYY-MM-DD format)'
    )
    parser.add_argument(
        '--title', 
        type=str, 
        help='Custom notification title'
    )
    parser.add_argument(
        '--file-path', 
        type=str, 
        help='Custom notification file path (e.g., 100x/daily-wrap/2025-08-17_100x-daily-wrap.html)'
    )
    parser.add_argument(
        '--summary', 
        type=str, 
        default='', 
        help='Custom notification summary'
    )
    parser.add_argument(
        '--test', 
        action='store_true', 
        help='Test connection without sending notification'
    )
    
    args = parser.parse_args()
    
    trigger = DailyWrapNotificationTrigger()
    
    # 연결 테스트
    if args.test:
        print("=== Connection Test ===")
        connections = trigger.notifier.test_connection()
        for service, status in connections.items():
            status_text = "OK" if status else "Failed"
            print(f"{service}: {status_text}")
        return
    
    # 커스텀 알림
    if args.title and args.file_path:
        success = trigger.notify_custom(args.title, args.file_path, args.summary)
    # 특정 날짜 알림
    elif args.date:
        success = trigger.notify_specific_date(args.date)
    # 최신 리포트 알림
    else:
        success = trigger.notify_latest_report()
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()