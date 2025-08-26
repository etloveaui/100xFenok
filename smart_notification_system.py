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
    
    def build_notification_data(self, report_type: str, file_path: str) -> Dict:
        """알림 데이터 구성"""
        config = self.config["report_types"][report_type]
        filename = Path(file_path).name
        date = self.extract_date_from_filename(filename) or datetime.now().strftime('%Y-%m-%d')
        
        # URL 생성
        url = config["url_template"].format(filename=filename)
        
        # 알림 메시지 생성
        template = config["notification_template"]
        message = template["message"].format(
            date=date,
            url=url,
            filename=filename
        )
        
        return {
            "title": template["title"],
            "message": message,
            "url": url,
            "date": date,
            "report_type": report_type,
            "report_name": config["name"],
            "hashtags": template.get("hashtags", [])
        }
    
    def send_notification(self, notification_data: Dict) -> bool:
        """알림 발송 (기존 시스템 활용)"""
        try:
            # 기존 notify_daily_wrap 모듈 사용 (호환성)
            from notify_daily_wrap import DailyWrapNotificationTrigger
            
            trigger = DailyWrapNotificationTrigger()
            
            # 커스텀 알림으로 발송
            success = trigger.notify_custom(
                title=notification_data["title"],
                file_path="",  # URL로 대체됨
                summary=notification_data["message"]
            )
            
            return success
            
        except ImportError:
            print("❌ 기존 알림 모듈을 찾을 수 없습니다.")
            return False
        except Exception as e:
            print(f"❌ 알림 발송 실패: {e}")
            return False
    
    def process_github_action(self) -> bool:
        """GitHub Actions 환경에서 변경된 파일 처리"""
        # GitHub Actions에서 변경된 파일 정보 가져오기
        changed_files = self._get_changed_files_from_github()
        
        if not changed_files:
            print("ℹ️ 변경된 파일이 없습니다.")
            return True
        
        success_count = 0
        for file_path in changed_files:
            if self._process_single_file(file_path):
                success_count += 1
        
        print(f"✅ {success_count}/{len(changed_files)} 개 파일 알림 처리 완료")
        return success_count > 0
    
    def _get_changed_files_from_github(self) -> List[str]:
        """GitHub Actions에서 변경된 파일 목록 가져오기"""
        print("[DEBUG] GitHub Actions 환경에서 변경된 파일 감지 중...")
        
        # 1차: GitHub Event에서 파일 정보 추출
        github_event_path = os.environ.get('GITHUB_EVENT_PATH')
        if github_event_path and os.path.exists(github_event_path):
            try:
                print(f"[DEBUG] GitHub Event 파일 읽는 중: {github_event_path}")
                with open(github_event_path, 'r') as f:
                    event = json.load(f)
                
                # push 이벤트에서 변경된 파일들 추출
                changed_files = []
                for commit in event.get('commits', []):
                    changed_files.extend(commit.get('added', []))
                    changed_files.extend(commit.get('modified', []))
                
                if changed_files:
                    print(f"[DEBUG] GitHub Event에서 {len(changed_files)}개 파일 발견: {changed_files}")
                    return list(set(changed_files))  # 중복 제거
                
            except Exception as e:
                print(f"⚠️ GitHub 이벤트 파일 파싱 실패: {e}")
        
        # 2차: GITHUB_SHA 환경변수 활용 
        github_sha = os.environ.get('GITHUB_SHA')
        if github_sha:
            try:
                import subprocess
                print(f"[DEBUG] GITHUB_SHA 활용: {github_sha}")
                result = subprocess.run(
                    ['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', github_sha],
                    capture_output=True, text=True, cwd=self.project_root
                )
                if result.returncode == 0 and result.stdout.strip():
                    files = result.stdout.strip().split('\n')
                    print(f"[DEBUG] git diff-tree로 {len(files)}개 파일 발견: {files}")
                    return files
            except Exception as e:
                print(f"⚠️ git diff-tree 실패: {e}")
        
        # 3차: git diff로 변경된 파일 확인
        print("[DEBUG] git diff로 대체 감지 시도...")
        return self._get_changed_files_from_git()
    
    def _get_changed_files_from_git(self) -> List[str]:
        """git으로 변경된 파일 확인 (대안)"""
        try:
            import subprocess
            
            # GitHub Actions 환경 개선: 변경된 파일만 감지
            commands = [
                ['git', 'diff', '--name-only', 'HEAD~1', 'HEAD'],
                ['git', 'diff', '--name-only', 'HEAD^', 'HEAD'],
                ['git', 'diff', '--name-only', 'HEAD~1..HEAD']
            ]
            
            for cmd in commands:
                try:
                    result = subprocess.run(
                        cmd, capture_output=True, text=True, cwd=self.project_root
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        files = [f for f in result.stdout.strip().split('\n') if f]
                        print(f"[DEBUG] git 명령어 성공 ({' '.join(cmd)}): {files}")
                        return files
                except Exception as e:
                    print(f"[DEBUG] git 명령어 실패 ({' '.join(cmd)}): {e}")
                    continue
                    
        except Exception as e:
            print(f"[DEBUG] git 대체 감지 전체 실패: {e}")
        
        return []
    
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
    
    if args.github_action or os.environ.get('GITHUB_ACTIONS'):
        print("=== GitHub Actions 모드 ===")
        success = system.process_github_action()
        sys.exit(0 if success else 1)
    
    # 기본: 도움말 출력
    parser.print_help()


if __name__ == "__main__":
    main()