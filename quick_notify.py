#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
100xFenok 빠른 알림 발송 스크립트
GitHub Pages에서 복사한 명령어를 바로 실행할 수 있는 단순화된 스크립트
"""

import os
import sys
import argparse
from pathlib import Path

# 현재 디렉토리를 sys.path에 추가
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))
tools_dir = current_dir / "tools"
if tools_dir.exists():
    sys.path.insert(0, str(tools_dir))

def send_daily_wrap():
    """최신 데일리 랩 알림 발송"""
    try:
        from send_notification import main as send_main
        print("📤 최신 Daily Wrap 알림 발송 중...")
        send_main()
        return True
    except Exception as e:
        print(f"❌ Daily Wrap 발송 실패: {e}")
        return False

def send_alpha_scout(date=None):
    """알파 스카우트 알림 발송"""
    try:
        from smart_notification_system import SmartNotificationSystem
        
        system = SmartNotificationSystem()
        
        # 최신 알파 스카우트 파일 찾기
        if date:
            file_pattern = f"alpha-scout/reports/{date}_100x-alpha-scout.html"
        else:
            scout_files = list(current_dir.glob("alpha-scout/reports/20*.html"))
            if not scout_files:
                print("❌ 알파 스카우트 파일을 찾을 수 없습니다")
                return False
            latest_file = max(scout_files, key=lambda f: f.name)
            file_pattern = str(latest_file.relative_to(current_dir))
        
        print(f"📤 Alpha Scout 알림 발송 중: {file_pattern}")
        success = system.process_manual_file(file_pattern)
        
        if success:
            print("✅ Alpha Scout 알림 발송 성공!")
        else:
            print("❌ Alpha Scout 알림 발송 실패")
            
        return success
        
    except Exception as e:
        print(f"❌ Alpha Scout 발송 실패: {e}")
        return False

def send_briefing(date=None):
    """브리핑 알림 발송"""
    try:
        from smart_notification_system import SmartNotificationSystem
        
        system = SmartNotificationSystem()
        
        # 최신 브리핑 파일 찾기
        if date:
            file_pattern = f"100x Briefing/Briefing/{date}_100x-Strategic-Briefing.html"
        else:
            briefing_files = list(current_dir.glob("100x Briefing/Briefing/20*.html"))
            if not briefing_files:
                print("❌ 브리핑 파일을 찾을 수 없습니다")
                return False
            latest_file = max(briefing_files, key=lambda f: f.name)
            file_pattern = str(latest_file.relative_to(current_dir))
        
        print(f"📤 Strategic Briefing 알림 발송 중: {file_pattern}")
        success = system.process_manual_file(file_pattern)
        
        if success:
            print("✅ Strategic Briefing 알림 발송 성공!")
        else:
            print("❌ Strategic Briefing 알림 발송 실패")
            
        return success
        
    except Exception as e:
        print(f"❌ Strategic Briefing 발송 실패: {e}")
        return False

def send_custom(title, message, url=None):
    """커스텀 알림 발송"""
    try:
        from notify_daily_wrap import DailyWrapNotificationTrigger
        
        trigger = DailyWrapNotificationTrigger()
        print(f"📤 커스텀 알림 발송 중: {title}")
        success = trigger.notify_custom(title=title, file_path="", summary=message)
        
        if success:
            print("✅ 커스텀 알림 발송 성공!")
        else:
            print("❌ 커스텀 알림 발송 실패")
            
        return success
        
    except Exception as e:
        print(f"❌ 커스텀 알림 발송 실패: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='100xFenok 빠른 알림 발송')
    parser.add_argument('--type', choices=['daily', 'alpha', 'briefing', 'custom'], 
                       default='daily', help='알림 타입 선택')
    parser.add_argument('--date', help='특정 날짜 (YYYY-MM-DD)')
    parser.add_argument('--title', help='커스텀 알림 제목')
    parser.add_argument('--message', help='커스텀 알림 메시지')
    parser.add_argument('--url', help='커스텀 알림 URL (선택)')
    
    args = parser.parse_args()
    
    print("=" * 50)
    print("🚀 100xFenok 빠른 알림 발송 시스템")
    print("=" * 50)
    
    if args.type == 'daily':
        success = send_daily_wrap()
    elif args.type == 'alpha':
        success = send_alpha_scout(args.date)
    elif args.type == 'briefing':
        success = send_briefing(args.date)
    elif args.type == 'custom':
        if not args.title or not args.message:
            print("❌ 커스텀 알림에는 --title과 --message가 필요합니다")
            return
        success = send_custom(args.title, args.message, args.url)
    
    print("=" * 50)
    if success:
        print("🎉 알림 발송 완료!")
    else:
        print("💥 알림 발송 실패!")
    print("=" * 50)

if __name__ == '__main__':
    main()