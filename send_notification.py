#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
100xFenok Daily Wrap 알림 발송 간편 스크립트
Created: 2025-08-17

리포트 등록 후 알림 발송을 위한 간편한 스크립트입니다.

사용법:
    1. 최신 리포트 알림:
       python send_notification.py
       
    2. 특정 날짜 리포트 알림:
       python send_notification.py 2025-08-17
       
    3. 커스텀 알림:
       python send_notification.py --title "제목" --file-path "100x/daily-wrap/2025-08-17_100x-daily-wrap.html"
"""

import sys
import os
from pathlib import Path

# tools 디렉토리의 스크립트 사용
tools_dir = Path(__file__).parent / "tools"
sys.path.insert(0, str(tools_dir))

try:
    from notify_daily_wrap import DailyWrapNotificationTrigger
except ImportError:
    print("Error: notify_daily_wrap module not found")
    print("Please ensure tools/notify_daily_wrap.py exists")
    sys.exit(1)


def show_usage():
    """사용법 출력"""
    print("""
100xFenok Daily Wrap 알림 발송 도구

사용법:
    1. 최신 리포트 알림:
       python send_notification.py
       
    2. 특정 날짜 리포트 알림:
       python send_notification.py YYYY-MM-DD
       예) python send_notification.py 2025-08-17
       
    3. 커스텀 알림:
       python send_notification.py --title "제목" --file-path "파일경로"
       예) python send_notification.py --title "특별 리포트" --file-path "100x/daily-wrap/2025-08-17_100x-daily-wrap.html"

옵션:
    --test          : 연결 테스트만 수행
    --help, -h      : 이 도움말 출력
    """)


def main():
    """메인 함수 - 똑똑한 알림 시스템으로 업그레이드됨"""
    
    # GitHub Actions 환경이면 새로운 똑똑한 시스템 사용
    if os.environ.get('GITHUB_ACTIONS'):
        print("🚀 GitHub Actions 감지 - 똑똑한 알림 시스템으로 전환합니다...")
        try:
            from smart_notification_system import SmartNotificationSystem
            system = SmartNotificationSystem()
            success = system.process_github_action()
            sys.exit(0 if success else 1)
        except ImportError:
            print("⚠️ 새 시스템을 찾을 수 없습니다. 기존 방식으로 진행합니다.")
            # 기존 로직으로 폴백
    
    # 도움말 요청
    if len(sys.argv) > 1 and sys.argv[1] in ['--help', '-h', 'help']:
        show_usage()
        return
    
    # 연결 테스트
    if len(sys.argv) > 1 and sys.argv[1] == '--test':
        print("=== 텔레그램 봇 연결 테스트 ===")
        trigger = DailyWrapNotificationTrigger()
        connections = trigger.notifier.test_connection()
        for service, status in connections.items():
            status_text = "OK" if status else "Failed"
            print(f"{service}: {status_text}")
        return
    
    # 기존 호환성 유지
    trigger = DailyWrapNotificationTrigger()
    
    # 인수 없음 - 최신 리포트 알림
    if len(sys.argv) == 1:
        print("📤 최신 Daily Wrap 리포트 알림을 발송합니다...")
        success = trigger.notify_latest_report()
        
    # 날짜 형식 인수 - 특정 날짜 알림
    elif len(sys.argv) == 2 and '-' in sys.argv[1]:
        target_date = sys.argv[1]
        print(f"📤 {target_date} Daily Wrap 리포트 알림을 발송합니다...")
        success = trigger.notify_specific_date(target_date)
        
    # 커스텀 알림
    elif '--title' in sys.argv and '--file-path' in sys.argv:
        try:
            title_idx = sys.argv.index('--title') + 1
            file_path_idx = sys.argv.index('--file-path') + 1
            
            if title_idx >= len(sys.argv) or file_path_idx >= len(sys.argv):
                raise IndexError("Missing arguments")
                
            title = sys.argv[title_idx]
            file_path = sys.argv[file_path_idx]
            
            # 요약 옵션 확인
            summary = ""
            if '--summary' in sys.argv:
                summary_idx = sys.argv.index('--summary') + 1
                if summary_idx < len(sys.argv):
                    summary = sys.argv[summary_idx]
            
            print(f"커스텀 알림을 발송합니다...")
            success = trigger.notify_custom(title, file_path, summary)
            
        except (IndexError, ValueError) as e:
            print("Error: --title과 --file-path 옵션이 올바르지 않습니다.")
            show_usage()
            sys.exit(1)
    
    else:
        print("Error: 올바르지 않은 인수입니다.")
        show_usage()
        sys.exit(1)
    
    # 결과 출력
    if success:
        print("\n✅ 알림이 성공적으로 발송되었습니다!")
    else:
        print("\n❌ 알림 발송에 실패했습니다.")
        sys.exit(1)


if __name__ == "__main__":
    main()