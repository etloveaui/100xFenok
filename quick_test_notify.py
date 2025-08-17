#!/usr/bin/env python3
"""
100xFenok 텔레그램 알림 빠른 테스트 (Google Sheets 없이)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from telegram_notifier import TelegramNotifier

def quick_test():
    """Google Sheets 없이 직접 Chat ID로 테스트"""
    notifier = TelegramNotifier()
    
    # 알려진 Chat ID들
    chat_ids = [
        "-1001513671466",  # 그룹 Chat ID
        "6443399098",      # 개인 Chat ID 1
        "1697642019",      # 개인 Chat ID 2
    ]
    
    # 테스트 Daily Wrap 알림
    title = "2025-08-17 100x Daily Wrap 테스트"
    file_path = "100x/daily-wrap/2025-08-17_100x-daily-wrap.html"
    summary = "텔레그램 알림 시스템이 성공적으로 구축되었습니다!"
    
    print("=== 100xFenok 텔레그램 알림 테스트 ===")
    print(f"제목: {title}")
    print(f"File Path: {file_path}")
    print(f"Full URL: https://etloveaui.github.io/100xFenok/?path={file_path}")
    print(f"요약: {summary}")
    print(f"대상 Chat ID: {len(chat_ids)}개")
    print()
    
    success_count = 0
    for i, chat_id in enumerate(chat_ids, 1):
        print(f"[{i}/{len(chat_ids)}] Chat ID {chat_id}로 발송 중...")
        
        # 메시지 구성 (실제 send_daily_wrap_notification 메서드 사용)
        base_url = "https://etloveaui.github.io/100xFenok/"
        full_url = f"{base_url}?path={file_path}"
        
        message = f"""🚀 **새로운 100x Daily Wrap이 발행되었습니다!**

📊 **{title}**

{summary}

🔗 [리포트 보기]({full_url})

💡 오늘의 시장 인사이트와 투자 기회를 놓치지 마세요!

---
_100x FenoK | 투자의 시작_"""

        success, details = notifier.send_telegram_message(chat_id, message)
        
        if success:
            print("    성공!")
            success_count += 1
        else:
            print(f"    실패: {details}")
    
    print()
    print(f"=== 결과: {success_count}/{len(chat_ids)} 성공 ===")
    
    if success_count == len(chat_ids):
        print("모든 메시지가 성공적으로 발송되었습니다!")
        print()
        print("이제 실제 Daily Wrap 리포트 생성 시 다음 명령어로 알림을 보낼 수 있습니다:")
        print("python tools/notify_daily_wrap.py")
    else:
        print("일부 메시지 발송에 실패했습니다.")
    
    return success_count == len(chat_ids)

if __name__ == "__main__":
    quick_test()