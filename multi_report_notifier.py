#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
100xFenok 다중 리포트 알림 시스템
Created: 2025-08-17

Daily Wrap, Briefing, Alpha Scout 등 모든 리포트 타입을 지원하는 확장된 알림 시스템
"""

import os
import sys
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any

# 기존 텔레그램 알림 시스템 사용
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from telegram_notifier import TelegramNotifier


class MultiReportNotifier:
    """다중 리포트 타입을 지원하는 확장된 알림 시스템"""
    
    def __init__(self):
        self.base_dir = Path(__file__).parent
        self.notifier = TelegramNotifier()
        
        # 리포트 타입별 설정
        self.report_configs = {
            'daily-wrap': {
                'directory': self.base_dir / '100x' / 'daily-wrap',
                'pattern': '*_100x-daily-wrap.html',
                'url_path': '100x/daily-wrap',
                'title_format': '{date} 100x Daily Wrap',
                'emoji': '📊',
                'description': '오늘의 주요 시장 동향과 투자 기회를 확인하세요.'
            },
            'briefing': {
                'directory': self.base_dir / '100x Briefing' / 'Briefing',
                'pattern': '*_100x-Strategic-Briefing.html',
                'url_path': '100x Briefing/Briefing',
                'title_format': '{date} 100x Strategic Briefing',
                'emoji': '🎯',
                'description': '전략적 시장 분석과 투자 인사이트를 제공합니다.'
            },
            'alpha-scout': {
                'directory': self.base_dir / 'alpha-scout' / 'reports',
                'pattern': '*_100x-alpha-scout.html',
                'url_path': 'alpha-scout/reports',
                'title_format': '{date} 100x Alpha Scout',
                'emoji': '🔍',
                'description': '숨겨진 알파 기회와 새로운 투자 아이디어를 발굴합니다.'
            }
        }
    
    def detect_report_type(self, file_path: str) -> Optional[str]:
        """파일 경로에서 리포트 타입 감지"""
        file_path = Path(file_path)
        
        for report_type, config in self.report_configs.items():
            if str(config['directory']) in str(file_path.parent):
                return report_type
        return None
    
    def extract_date_from_filename(self, filename: str) -> Optional[str]:
        """파일명에서 날짜 추출 (YYYY-MM-DD 형식)"""
        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', filename)
        return date_match.group(1) if date_match else None
    
    def find_latest_report(self, report_type: str) -> Optional[Dict[str, Any]]:
        """특정 타입의 최신 리포트 찾기"""
        if report_type not in self.report_configs:
            return None
            
        config = self.report_configs[report_type]
        directory = config['directory']
        pattern = config['pattern']
        
        if not directory.exists():
            return None
            
        # 패턴에 맞는 파일들 찾기
        files = list(directory.glob(pattern))
        if not files:
            return None
            
        # 날짜 기준으로 정렬하여 최신 파일 선택
        files.sort(key=lambda x: x.name, reverse=True)
        latest_file = files[0]
        
        date_str = self.extract_date_from_filename(latest_file.name)
        if not date_str:
            return None
            
        return {
            'file_path': latest_file,
            'date': date_str,
            'type': report_type,
            'config': config
        }
    
    def generate_notification_content(self, report_info: Dict[str, Any]) -> Dict[str, str]:
        """리포트 정보로부터 알림 내용 생성"""
        config = report_info['config']
        date_str = report_info['date']
        
        # 제목 생성
        title = config['title_format'].format(date=date_str)
        
        # 파일 경로 생성 (GitHub Pages용)
        filename = report_info['file_path'].name
        file_path = f"{config['url_path']}/{filename}"
        
        # 요약 메시지 생성
        summary = config['description']
        
        return {
            'title': title,
            'file_path': file_path,
            'summary': summary,
            'emoji': config['emoji']
        }
    
    def send_report_notification(self, report_type: str, specific_date: str = None) -> bool:
        """특정 리포트 타입의 알림 발송"""
        if report_type not in self.report_configs:
            print(f"Error: Unknown report type '{report_type}'")
            return False
        
        if specific_date:
            # 특정 날짜 리포트 찾기
            config = self.report_configs[report_type]
            directory = config['directory']
            pattern = config['pattern'].replace('*', specific_date)
            
            files = list(directory.glob(pattern))
            if not files:
                print(f"Error: No {report_type} report found for date {specific_date}")
                return False
                
            report_info = {
                'file_path': files[0],
                'date': specific_date,
                'type': report_type,
                'config': config
            }
        else:
            # 최신 리포트 찾기
            report_info = self.find_latest_report(report_type)
            if not report_info:
                print(f"Error: No {report_type} reports found")
                return False
        
        # 알림 내용 생성
        content = self.generate_notification_content(report_info)
        
        print(f"{content['emoji']} Sending {report_type} notification...")
        print(f"Title: {content['title']}")
        print(f"File Path: {content['file_path']}")
        print(f"Summary: {content['summary']}")
        
        # 알림 발송
        success = self.notifier.send_daily_wrap_notification(
            title=content['title'],
            file_path=content['file_path'],
            summary=content['summary']
        )
        
        if success:
            print("Notification sent successfully!")
        else:
            print("Failed to send notification")
            
        return success
    
    def send_all_latest_notifications(self) -> Dict[str, bool]:
        """모든 리포트 타입의 최신 알림 발송"""
        results = {}
        
        for report_type in self.report_configs.keys():
            print(f"\n=== Checking {report_type} ===")
            results[report_type] = self.send_report_notification(report_type)
            
        return results
    
    def auto_detect_and_notify(self, file_path: str) -> bool:
        """파일 경로를 분석해서 자동으로 적절한 알림 발송"""
        report_type = self.detect_report_type(file_path)
        if not report_type:
            print(f"Error: Could not detect report type for {file_path}")
            return False
            
        date_str = self.extract_date_from_filename(Path(file_path).name)
        if not date_str:
            print(f"Error: Could not extract date from {file_path}")
            return False
            
        print(f"Auto-detected: {report_type} report for {date_str}")
        return self.send_report_notification(report_type, date_str)


def main():
    """메인 함수"""
    import argparse
    
    parser = argparse.ArgumentParser(description="100xFenok Multi-Report Notification System")
    parser.add_argument('--type', choices=['daily-wrap', 'briefing', 'alpha-scout'], 
                       help='Report type to notify')
    parser.add_argument('--date', help='Specific date (YYYY-MM-DD)')
    parser.add_argument('--file', help='Auto-detect from file path')
    parser.add_argument('--all', action='store_true', help='Send notifications for all report types')
    
    args = parser.parse_args()
    
    notifier = MultiReportNotifier()
    
    if args.file:
        # 파일 경로에서 자동 감지
        success = notifier.auto_detect_and_notify(args.file)
    elif args.all:
        # 모든 타입의 최신 리포트 알림
        results = notifier.send_all_latest_notifications()
        success = all(results.values())
    elif args.type:
        # 특정 타입 알림
        success = notifier.send_report_notification(args.type, args.date)
    else:
        # 기본값: daily-wrap 최신 리포트
        success = notifier.send_report_notification('daily-wrap')
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()