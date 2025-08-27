#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
100xFenok 똑똑한 확장가능 알림 시스템
- 파일 경로 기반 자동 리포트 타입 감지
- 설정 파일 기반 확장가능 구조
- 구조 변경에 유연하게 대응

Created: 2025-08-25 (Claude 설계)
"""

import os
import sys
import json
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import fnmatch

class SmartNotificationSystem:
    """똑똑한 확장가능 알림 시스템"""
    
    def __init__(self, config_path: str = None):
        """초기화"""
        self.project_root = Path(__file__).parent
        self.config_path = config_path or self.project_root / "config" / "notification_config.json"
        self.config = self._load_config()
        
        # tools 디렉토리 추가 (기존 시스템 호환)
        tools_dir = self.project_root / "tools"
        if tools_dir.exists():
            sys.path.insert(0, str(tools_dir))
    
    def _load_config(self) -> Dict:
        """설정 파일 로드"""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"❌ 설정 파일을 찾을 수 없습니다: {self.config_path}")
            sys.exit(1)
        except json.JSONDecodeError as e:
            print(f"❌ 설정 파일 파싱 오류: {e}")
            sys.exit(1)
    
    def detect_report_type(self, file_path: str) -> Optional[str]:
        """파일 경로로 리포트 타입 자동 감지"""
        file_path_normalized = file_path.replace('\\', '/')
        
        for report_type, config in self.config["report_types"].items():
            for pattern in config["path_patterns"]:
                if fnmatch.fnmatch(file_path_normalized, pattern):
                    return report_type
        
        return None
    
    def extract_date_from_filename(self, filename: str) -> Optional[str]:
        """파일명에서 날짜 추출"""
        # YYYY-MM-DD 형식 찾기
        date_pattern = r'(\d{4}-\d{2}-\d{2})'
        match = re.search(date_pattern, filename)
        return match.group(1) if match else None
    
    def _escape_markdown_v2(self, text: str) -> str:
        """텔레그램 MarkdownV2 파서를 위한 특수문자 이스케이프 처리"""
        # 주의: 이스케이프할 문자 목록 - `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`
        # re.escape는 대부분의 문자를 이스케이프 처리하지만, 여기서는 명시적으로 처리합니다.
        escape_chars = r'([_*\[\]()~`>#\+\-=|{}.!])'
        return re.sub(escape_chars, r'\\\1', text)

    def build_notification_data(self, report_type: str, file_path: str) -> Dict:
        """알림 데이터 구성"""
        config = self.config["report_types"][report_type]
        filename = Path(file_path).name
        date = self.extract_date_from_filename(filename) or datetime.now().strftime('%Y-%m-%d')
        
        # URL 생성
        url = config["url_template"].format(filename=filename)
        
        # 템플릿에 삽입될 변수들을 이스케이프 처리
        # 이렇게 하면 템플릿 자체의 마크다운 서식은 유지하면서 변수 내용의 특수문자만 안전하게 처리됨
        escaped_date = self._escape_markdown_v2(date)
        escaped_url = self._escape_markdown_v2(url)
        escaped_filename = self._escape_markdown_v2(filename)

        # 알림 메시지 생성
        template = config["notification_template"]
        # 이스케이프 처리된 변수들을 사용하여 메시지 포맷
        message = template["message"].format(
            date=escaped_date,
            url=escaped_url,
            filename=escaped_filename
        )
        
        return {
            "title": template["title"], # 제목은 이스케이프하지 않음 (로깅용)
            "message": message, # 최종 메시지는 서식이 적용된 상태
            "url": url,
            "date": date,
            "report_type": report_type,
            "report_name": config["name"],
            "hashtags": template.get("hashtags", [])
        }

    def send_notification(self, notification_data: Dict) -> bool:
        """알림 발송 (텔레그램 노티파이어 직접 호출)"""
        try:
            # notifier 객체를 얻기 위해 기존 클래스 사용
            from notify_daily_wrap import DailyWrapNotificationTrigger
            trigger = DailyWrapNotificationTrigger()
            notifier = trigger.notifier
            
            message_to_send = notification_data["message"]
            title_for_log = notification_data["title"]

            chat_ids = notifier.get_chat_ids()
            if not chat_ids:
                print("⚠️ Chat ID를 찾을 수 없어 알림을 보낼 수 없습니다.")
                return False

            success_count = 0
            failed_count = 0
            
            for chat_id in chat_ids:
                success, details = notifier.send_telegram_message(chat_id, message_to_send)
                if success:
                    success_count += 1
                else:
                    failed_count +=1
            
            # 결과 로깅
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            result_details = f"Sent to {success_count} users, {failed_count} failed. Title: {title_for_log}"
            overall_status = "Success" if failed_count == 0 else "Partial" if success_count > 0 else "Failed"
            notifier.log_notification_result(timestamp, overall_status, result_details)

            return failed_count == 0

        except ImportError:
            print("❌ 기존 알림 모듈을 찾을 수 없습니다.")
            return False
        except Exception as e:
            print(f"❌ 알림 발송 실패: {e}")
            return False
    
    def process_github_action(self, changed_files: List[str]) -> bool:
        """GitHub Actions 환경에서 변경된 파일 처리"""
        if not changed_files:
            print("ℹ️ 변경된 파일이 없습니다. (워크플로우로부터 전달받음)")
            return True
        
        success_count = 0
        for file_path in changed_files:
            if self._process_single_file(file_path):
                success_count += 1
        
        print(f"✅ {success_count}/{len(changed_files)} 개 파일 알림 처리 완료")
        return success_count > 0
    
    def _process_single_file(self, file_path: str) -> bool:
        """단일 파일 처리"""
        print(f"[ANALYZE] 파일 분석: {file_path}")
        
        # 리포트 타입 자동 감지
        report_type = self.detect_report_type(file_path)
        if not report_type:
            print(f"[INFO] 알림 대상이 아닌 파일: {file_path}")
            return False
        
        print(f"[DETECTED] 감지된 리포트 타입: {report_type}")
        
        # 알림 데이터 생성
        notification_data = self.build_notification_data(report_type, file_path)
        print(f"[NOTIFICATION] 알림 제목: {report_type} 리포트")
        
        # 알림 발송
        success = self.send_notification(notification_data)
        if success:
            print(f"[SUCCESS] {report_type} 알림 발송 성공")
        else:
            print(f"[FAILED] {report_type} 알림 발송 실패")
        
        return success
    
    def process_manual_file(self, file_path: str) -> bool:
        """수동으로 특정 파일 처리"""
        return self._process_single_file(file_path)
    
    def test_system(self) -> Dict:
        """시스템 테스트"""
        results = {
            "config_loaded": bool(self.config),
            "report_types": list(self.config.get("report_types", {}).keys()),
            "telegram_connection": False
        }
        
        # 텔레그램 연결 테스트
        try:
            from notify_daily_wrap import DailyWrapNotificationTrigger
            trigger = DailyWrapNotificationTrigger()
            connections = trigger.notifier.test_connection()
            results["telegram_connection"] = any(connections.values())
        except Exception:
            pass
        
        return results


def main():
    """메인 실행 함수"""
    import argparse
    
    parser = argparse.ArgumentParser(description='100xFenok 똑똑한 알림 시스템')
    parser.add_argument('--test', action='store_true', help='시스템 테스트')
    parser.add_argument('--file', help='특정 파일 수동 처리')
    parser.add_argument('--github-action', action='store_true', help='GitHub Actions 모드')
    parser.add_argument('--changed-files', help='(GitHub Actions 전용) 변경된 파일 목록')
    
    args = parser.parse_args()
    
    system = SmartNotificationSystem()
    
    if args.test:
        print("=== 시스템 테스트 ===")
        results = system.test_system()
        for key, value in results.items():
            status = "[OK]" if value else "[FAILED]"
            print(f"{key}: {status} {value}")
        return
    
    if args.file:
        print(f"=== 수동 파일 처리: {args.file} ===")
        success = system.process_manual_file(args.file)
        sys.exit(0 if success else 1)
    
    if args.github_action:
        print("=== GitHub Actions 모드 ===")
        if not args.changed_files:
            print("⚠️ --changed-files 인자가 필요합니다.")
            sys.exit(1)

        # 공백으로 구분된 파일 목록을 리스트로 변환
        changed_files_list = args.changed_files.split()
        success = system.process_github_action(changed_files_list)
        sys.exit(0 if success else 1)
    
    # 기본: 도움말 출력
    parser.print_help()


if __name__ == "__main__":
    main()