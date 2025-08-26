#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
100xFenok 알림 컨트롤 패널 백엔드 API
웹 기반 알림 제어 시스템을 위한 Flask API
"""

import os
import sys
from pathlib import Path
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
import json
import subprocess

# 현재 디렉토리를 sys.path에 추가
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

app = Flask(__name__)
CORS(app)  # CORS 활성화

class NotificationAPI:
    def __init__(self):
        self.project_root = Path(__file__).parent
        self.history_file = self.project_root / "notification_history.json"
        self.load_history()
    
    def load_history(self):
        """발송 이력 로드"""
        try:
            if self.history_file.exists():
                with open(self.history_file, 'r', encoding='utf-8') as f:
                    self.history = json.load(f)
            else:
                self.history = []
        except:
            self.history = []
    
    def save_history(self, record):
        """발송 이력 저장"""
        try:
            self.history.insert(0, record)  # 최신이 맨 앞
            self.history = self.history[:50]  # 최대 50개만 보관
            
            with open(self.history_file, 'w', encoding='utf-8') as f:
                json.dump(self.history, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"이력 저장 실패: {e}")
    
    def send_quick_notification(self, notification_type):
        """빠른 알림 발송"""
        try:
            # 최신 파일 찾기
            if notification_type == 'daily_wrap':
                pattern = "100x/daily-wrap/*.html"
                cmd = ["python", "send_notification.py"]
            elif notification_type == 'alpha_scout':
                pattern = "alpha-scout/reports/*.html" 
                # 최신 알파스카우트 파일 찾기
                scout_files = list(self.project_root.glob("alpha-scout/reports/20*.html"))
                if scout_files:
                    latest_file = max(scout_files, key=lambda f: f.name)
                    cmd = ["python", "smart_notification_system.py", "--file", str(latest_file.relative_to(self.project_root))]
                else:
                    return False, "알파스카우트 파일을 찾을 수 없습니다"
            elif notification_type == 'briefing':
                pattern = "100x Briefing/Briefing/*.html"
                # 최신 브리핑 파일 찾기
                briefing_files = list(self.project_root.glob("100x Briefing/Briefing/20*.html"))
                if briefing_files:
                    latest_file = max(briefing_files, key=lambda f: f.name)
                    cmd = ["python", "smart_notification_system.py", "--file", str(latest_file.relative_to(self.project_root))]
                else:
                    return False, "브리핑 파일을 찾을 수 없습니다"
            else:
                return False, "지원하지 않는 알림 타입"
            
            # 명령 실행
            result = subprocess.run(
                cmd, 
                cwd=self.project_root,
                capture_output=True, 
                text=True, 
                encoding='utf-8'
            )
            
            success = result.returncode == 0
            
            # 이력 저장
            record = {
                "timestamp": datetime.now().isoformat(),
                "type": "quick",
                "notification_type": notification_type,
                "success": success,
                "message": result.stdout if success else result.stderr
            }
            self.save_history(record)
            
            return success, result.stdout if success else result.stderr
            
        except Exception as e:
            record = {
                "timestamp": datetime.now().isoformat(),
                "type": "quick",
                "notification_type": notification_type,
                "success": False,
                "message": str(e)
            }
            self.save_history(record)
            return False, str(e)
    
    def send_custom_notification(self, title, message, url=None):
        """커스텀 알림 발송"""
        try:
            # notify_daily_wrap의 커스텀 알림 기능 사용
            from tools.notify_daily_wrap import DailyWrapNotificationTrigger
            
            trigger = DailyWrapNotificationTrigger()
            success = trigger.notify_custom(title=title, file_path="", summary=message)
            
            # 이력 저장
            record = {
                "timestamp": datetime.now().isoformat(),
                "type": "custom",
                "title": title,
                "message": message[:100] + "..." if len(message) > 100 else message,
                "url": url,
                "success": success
            }
            self.save_history(record)
            
            return success, "커스텀 알림이 발송되었습니다" if success else "알림 발송 실패"
            
        except Exception as e:
            record = {
                "timestamp": datetime.now().isoformat(),
                "type": "custom",
                "title": title,
                "success": False,
                "message": str(e)
            }
            self.save_history(record)
            return False, str(e)

# API 인스턴스 생성
notification_api = NotificationAPI()

@app.route('/')
def index():
    """컨트롤 패널 메인 페이지"""
    try:
        with open('notification-control-panel.html', 'r', encoding='utf-8') as f:
            return f.read()
    except:
        return "컨트롤 패널 파일을 찾을 수 없습니다."

@app.route('/api/send-quick', methods=['POST'])
def send_quick():
    """빠른 알림 발송 API"""
    data = request.get_json()
    notification_type = data.get('type')
    
    if not notification_type:
        return jsonify({"success": False, "message": "알림 타입이 필요합니다"})
    
    success, message = notification_api.send_quick_notification(notification_type)
    
    return jsonify({
        "success": success,
        "message": message
    })

@app.route('/api/send-custom', methods=['POST'])
def send_custom():
    """커스텀 알림 발송 API"""
    data = request.get_json()
    title = data.get('title')
    message = data.get('message')
    url = data.get('url')
    
    if not title or not message:
        return jsonify({"success": False, "message": "제목과 메시지가 필요합니다"})
    
    success, result_message = notification_api.send_custom_notification(title, message, url)
    
    return jsonify({
        "success": success,
        "message": result_message
    })

@app.route('/api/history', methods=['GET'])
def get_history():
    """발송 이력 조회 API"""
    return jsonify({
        "success": True,
        "history": notification_api.history[:20]  # 최근 20개만
    })

@app.route('/api/status', methods=['GET'])
def get_status():
    """시스템 상태 조회 API"""
    try:
        # 텔레그램 연결 테스트
        from tools.notify_daily_wrap import DailyWrapNotificationTrigger
        trigger = DailyWrapNotificationTrigger()
        telegram_status = trigger.notifier.test_connection()
        
        # 설정 파일 존재 확인
        config_exists = (notification_api.project_root / "config" / "notification_config.json").exists()
        
        # GitHub Actions 워크플로우 확인
        github_workflow = (notification_api.project_root / ".github" / "workflows" / "telegram-notify.yml").exists()
        
        return jsonify({
            "success": True,
            "status": {
                "telegram": any(telegram_status.values()) if telegram_status else False,
                "config_file": config_exists,
                "github_actions": github_workflow,
                "last_check": datetime.now().isoformat()
            }
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        })

if __name__ == '__main__':
    print("🚀 100xFenok 알림 컨트롤 패널 시작")
    print("📱 브라우저에서 http://localhost:5000 접속")
    print("🛑 종료하려면 Ctrl+C")
    
    # Flask 앱 실행
    app.run(
        host='127.0.0.1',
        port=5000,
        debug=True,
        use_reloader=False  # 리로더 비활성화 (이중 실행 방지)
    )