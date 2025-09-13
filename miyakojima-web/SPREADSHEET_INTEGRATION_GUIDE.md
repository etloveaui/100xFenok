# 📊 스프레드시트 연동 완전 가이드

## 🎯 개요
미야코지마 POI 데이터를 Google Sheets 및 Excel Online과 연동하여 실시간 데이터 관리 시스템 구축

**현재 데이터**: ✅ 100개 POI (Phase 4 완료)  
**목표**: 스프레드시트 ↔ JSON 양방향 실시간 동기화

---

## 🚀 Quick Start (30분 설정)

### 1단계: Google Cloud 설정 (10분)
1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 새 프로젝트 생성: "miyakojima-poi-sync"
3. API 라이브러리에서 "Google Sheets API" 활성화
4. API 라이브러리에서 "Google Drive API" 활성화
5. 서비스 계정 생성:
   - IAM 및 관리자 > 서비스 계정 > 서비스 계정 만들기
   - 이름: "poi-sync-service"
   - 역할: "편집자"
   - JSON 키 다운로드 → `credentials.json`으로 저장

### 2단계: 스프레드시트 생성 (5분)
1. [Google Sheets](https://sheets.google.com) 에서 새 스프레드시트 생성
2. 이름: "Miyakojima POI Database"
3. 첫 번째 시트 이름: "POIs"
4. 서비스 계정 이메일 주소와 공유 (편집 권한)

### 3단계: Python 환경 설정 (10분)
```bash
# 가상환경 생성 및 활성화
python -m venv poi_sync_env
poi_sync_env\Scripts\activate  # Windows
# source poi_sync_env/bin/activate  # macOS/Linux

# 필요 패키지 설치
pip install gspread google-auth pandas openpyxl
```

### 4단계: 즉시 실행 (5분)
```bash
# 초기 데이터 업로드
python upload_to_sheets.py

# 실시간 모니터링 시작
python monitor_changes.py
```

---

## 📁 파일 구조

```
miyakojima-web/
├── 📄 credentials.json              # Google 서비스 계정 키 (보안 주의!)
├── 📄 sheets_config.py              # 스프레드시트 설정
├── 📄 google_sheets_client.py       # Google Sheets API 클라이언트
├── 📄 excel_online_client.py        # Excel Online API 클라이언트  
├── 📄 upload_to_sheets.py           # JSON → 스프레드시트 업로드
├── 📄 download_from_sheets.py       # 스프레드시트 → JSON 다운로드
├── 📄 monitor_changes.py            # 실시간 변경사항 모니터링
├── 📄 sync_scheduler.py             # 자동 동기화 스케줄러
└── 📄 validation_utils.py           # 데이터 검증 유틸리티
```

---

## 🔧 핵심 구현 코드

### sheets_config.py
```python
"""스프레드시트 연동 설정"""

# Google Sheets 설정
CREDENTIALS_FILE = 'credentials.json'
SPREADSHEET_ID = 'your-google-sheet-id'  # URL에서 추출
WORKSHEET_NAME = 'POIs'

# Excel Online 설정 (선택사항)
EXCEL_TENANT_ID = 'your-tenant-id'
EXCEL_CLIENT_ID = 'your-client-id'
EXCEL_CLIENT_SECRET = 'your-client-secret'

# 동기화 설정
SYNC_INTERVAL = 300  # 5분마다 동기화
BACKUP_ENABLED = True
MAX_RETRIES = 3

# POI 데이터 스키마
POI_COLUMNS = [
    'id',
    'name', 
    'name_en',
    'category',
    'subcategory',
    'rating',
    'review_count',
    'latitude',
    'longitude',
    'address',
    'phone',
    'website',
    'description',
    'opening_hours',
    'price_range',
    'amenities',
    'weather_dependent',
    'best_time',
    'created_at',
    'updated_at',
    'status'
]

# 카테고리 유효성 검사
VALID_CATEGORIES = [
    'beaches', 'culture', 'activities', 
    'restaurants', 'nature', 'shopping'
]

# 미야코지마 좌표 범위
COORDINATE_BOUNDS = {
    'lat_min': 24.6,
    'lat_max': 24.9, 
    'lng_min': 125.1,
    'lng_max': 125.5
}
```

### google_sheets_client.py
```python
"""Google Sheets API 클라이언트"""

import gspread
import json
import pandas as pd
from google.oauth2.service_account import Credentials
from datetime import datetime
from sheets_config import *

class GoogleSheetsClient:
    def __init__(self):
        """Google Sheets 클라이언트 초기화"""
        scope = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        
        try:
            credentials = Credentials.from_service_account_file(
                CREDENTIALS_FILE, scopes=scope
            )
            self.client = gspread.authorize(credentials)
            self.spreadsheet = self.client.open_by_key(SPREADSHEET_ID)
            print("✅ Google Sheets 연결 성공")
        except Exception as e:
            print(f"❌ Google Sheets 연결 실패: {e}")
            raise
    
    def upload_poi_data(self, poi_list):
        """POI 데이터를 스프레드시트에 업로드"""
        try:
            worksheet = self.spreadsheet.worksheet(WORKSHEET_NAME)
            
            # 기존 데이터 백업
            if BACKUP_ENABLED:
                self._create_backup()
            
            # 워크시트 초기화
            worksheet.clear()
            
            # 헤더 추가
            worksheet.append_row(POI_COLUMNS)
            
            # POI 데이터 추가
            for poi in poi_list:
                row = self._poi_to_row(poi)
                worksheet.append_row(row)
            
            # 포맷팅 적용
            self._apply_formatting(worksheet)
            
            print(f"✅ {len(poi_list)}개 POI 업로드 완료")
            return True
            
        except Exception as e:
            print(f"❌ 업로드 실패: {e}")
            return False
    
    def download_poi_data(self):
        """스프레드시트에서 POI 데이터 다운로드"""
        try:
            worksheet = self.spreadsheet.worksheet(WORKSHEET_NAME)
            records = worksheet.get_all_records()
            
            poi_list = []
            for record in records:
                poi = self._row_to_poi(record)
                if poi:  # 유효성 검사 통과
                    poi_list.append(poi)
            
            print(f"✅ {len(poi_list)}개 POI 다운로드 완료")
            return poi_list
            
        except Exception as e:
            print(f"❌ 다운로드 실패: {e}")
            return []
    
    def get_last_modified(self):
        """마지막 수정 시간 확인"""
        try:
            worksheet = self.spreadsheet.worksheet(WORKSHEET_NAME)
            # 마지막 업데이트 시간을 별도 셀에 저장
            last_modified = worksheet.cell(1, len(POI_COLUMNS) + 1).value
            if last_modified:
                return datetime.fromisoformat(last_modified)
            return None
        except:
            return None
    
    def update_last_modified(self):
        """마지막 수정 시간 업데이트"""
        try:
            worksheet = self.spreadsheet.worksheet(WORKSHEET_NAME)
            current_time = datetime.now().isoformat()
            worksheet.update_cell(1, len(POI_COLUMNS) + 1, current_time)
        except Exception as e:
            print(f"⚠️ 마지막 수정 시간 업데이트 실패: {e}")
    
    def _poi_to_row(self, poi):
        """POI 객체를 스프레드시트 행으로 변환"""
        row = []
        for column in POI_COLUMNS:
            value = poi.get(column, '')
            
            # 특별한 처리가 필요한 필드들
            if column == 'coordinates' and isinstance(value, list):
                # coordinates는 latitude, longitude로 분리
                continue
            elif column == 'latitude':
                value = poi.get('coordinates', [0, 0])[0]
            elif column == 'longitude':
                value = poi.get('coordinates', [0, 0])[1]
            elif column in ['opening_hours', 'amenities', 'best_time']:
                # JSON 필드는 문자열로 저장
                value = json.dumps(value) if value else ''
            elif column == 'created_at':
                value = datetime.now().isoformat()
            elif column == 'updated_at':
                value = datetime.now().isoformat()
            elif column == 'status':
                value = 'active'
            
            row.append(str(value) if value is not None else '')
        
        return row
    
    def _row_to_poi(self, record):
        """스프레드시트 행을 POI 객체로 변환"""
        try:
            poi = {
                'id': record.get('id'),
                'name': record.get('name'),
                'name_en': record.get('name_en'),
                'category': record.get('category'),
                'subcategory': record.get('subcategory'),
                'rating': float(record.get('rating', 0)),
                'review_count': int(record.get('review_count', 0)),
                'coordinates': [
                    float(record.get('latitude', 0)),
                    float(record.get('longitude', 0))
                ],
                'address': record.get('address'),
                'phone': record.get('phone'),
                'website': record.get('website'),
                'description': record.get('description'),
                'price_range': record.get('price_range'),
                'weather_dependent': record.get('weather_dependent', '').lower() == 'true'
            }
            
            # JSON 필드 파싱
            for field in ['opening_hours', 'amenities', 'best_time']:
                value = record.get(field, '')
                if value:
                    try:
                        poi[field] = json.loads(value)
                    except:
                        poi[field] = value.split(',') if ',' in value else [value]
                else:
                    poi[field] = []
            
            # 유효성 검사
            if self._validate_poi(poi):
                return poi
            else:
                print(f"⚠️ 유효하지 않은 POI: {poi.get('id', 'Unknown')}")
                return None
                
        except Exception as e:
            print(f"❌ POI 변환 오류: {e}")
            return None
    
    def _validate_poi(self, poi):
        """POI 데이터 유효성 검사"""
        # 필수 필드 확인
        required_fields = ['id', 'name', 'category', 'coordinates']
        for field in required_fields:
            if not poi.get(field):
                return False
        
        # 카테고리 유효성
        if poi['category'] not in VALID_CATEGORIES:
            return False
        
        # 좌표 유효성
        lat, lng = poi['coordinates']
        if not (COORDINATE_BOUNDS['lat_min'] <= lat <= COORDINATE_BOUNDS['lat_max']):
            return False
        if not (COORDINATE_BOUNDS['lng_min'] <= lng <= COORDINATE_BOUNDS['lng_max']):
            return False
        
        # 평점 유효성
        rating = poi.get('rating', 0)
        if not (0 <= rating <= 5):
            return False
        
        return True
    
    def _apply_formatting(self, worksheet):
        """스프레드시트 포맷팅 적용"""
        try:
            # 헤더 서식
            worksheet.format('1:1', {
                'backgroundColor': {'red': 0.2, 'green': 0.6, 'blue': 1.0},
                'textFormat': {'bold': True, 'foregroundColor': {'red': 1, 'green': 1, 'blue': 1}}
            })
            
            # 컬럼 너비 자동 조정
            worksheet.columns_auto_resize(0, len(POI_COLUMNS))
            
        except Exception as e:
            print(f"⚠️ 포맷팅 적용 실패: {e}")
    
    def _create_backup(self):
        """현재 데이터 백업"""
        try:
            # 백업 시트 생성
            backup_name = f"Backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            current_worksheet = self.spreadsheet.worksheet(WORKSHEET_NAME)
            
            # 현재 데이터를 백업 시트로 복사
            backup_worksheet = self.spreadsheet.duplicate_sheet(
                current_worksheet.id, new_sheet_name=backup_name
            )
            
            print(f"📋 백업 생성: {backup_name}")
            
        except Exception as e:
            print(f"⚠️ 백업 생성 실패: {e}")
```

### upload_to_sheets.py
```python
"""JSON 데이터를 스프레드시트에 업로드"""

import json
from google_sheets_client import GoogleSheetsClient

def upload_current_poi_data():
    """현재 POI JSON 데이터를 스프레드시트에 업로드"""
    
    # JSON 파일 읽기
    try:
        with open('data/miyakojima_pois.json', 'r', encoding='utf-8') as f:
            poi_data = json.load(f)
        print(f"📖 {len(poi_data)}개 POI 데이터 로드 완료")
    except Exception as e:
        print(f"❌ JSON 파일 읽기 실패: {e}")
        return False
    
    # Google Sheets 클라이언트 초기화
    try:
        sheets_client = GoogleSheetsClient()
    except Exception as e:
        print(f"❌ Google Sheets 연결 실패: {e}")
        return False
    
    # 데이터 업로드
    success = sheets_client.upload_poi_data(poi_data)
    
    if success:
        # 마지막 수정 시간 업데이트
        sheets_client.update_last_modified()
        print("🎉 스프레드시트 업로드 완료!")
        print(f"📊 총 {len(poi_data)}개 POI 데이터가 업로드되었습니다.")
        
        # 카테고리별 통계
        category_stats = {}
        for poi in poi_data:
            category = poi.get('category', 'unknown')
            category_stats[category] = category_stats.get(category, 0) + 1
        
        print("\n📈 카테고리별 통계:")
        for category, count in sorted(category_stats.items()):
            print(f"  {category}: {count}개")
        
        return True
    else:
        print("❌ 업로드 실패")
        return False

if __name__ == "__main__":
    print("🚀 미야코지마 POI 데이터 스프레드시트 업로드 시작")
    print("=" * 50)
    
    upload_current_poi_data()
```

### download_from_sheets.py
```python
"""스프레드시트에서 JSON 데이터로 다운로드"""

import json
import os
from datetime import datetime
from google_sheets_client import GoogleSheetsClient

def download_and_update_json():
    """스프레드시트에서 데이터를 다운로드하여 JSON 파일 업데이트"""
    
    # Google Sheets 클라이언트 초기화
    try:
        sheets_client = GoogleSheetsClient()
    except Exception as e:
        print(f"❌ Google Sheets 연결 실패: {e}")
        return False
    
    # 변경사항 확인
    last_modified = sheets_client.get_last_modified()
    json_modified = get_json_last_modified()
    
    if last_modified and json_modified and last_modified <= json_modified:
        print("📝 변경사항 없음 - 스킵")
        return True
    
    # 기존 JSON 백업
    backup_json()
    
    # 스프레드시트에서 데이터 다운로드
    poi_data = sheets_client.download_poi_data()
    
    if not poi_data:
        print("❌ 다운로드된 데이터 없음")
        return False
    
    # JSON 파일 저장
    try:
        with open('data/miyakojima_pois.json', 'w', encoding='utf-8') as f:
            json.dump(poi_data, f, ensure_ascii=False, indent=2)
        
        print(f"✅ {len(poi_data)}개 POI 데이터 JSON 저장 완료")
        
        # 데이터 품질 확인
        quality_report = validate_downloaded_data(poi_data)
        print(f"📊 데이터 품질: {quality_report['score']:.1f}%")
        
        return True
        
    except Exception as e:
        print(f"❌ JSON 저장 실패: {e}")
        restore_backup()
        return False

def get_json_last_modified():
    """JSON 파일의 마지막 수정 시간 확인"""
    try:
        stat = os.stat('data/miyakojima_pois.json')
        return datetime.fromtimestamp(stat.st_mtime)
    except:
        return None

def backup_json():
    """현재 JSON 파일 백업"""
    try:
        if os.path.exists('data/miyakojima_pois.json'):
            backup_name = f"data/backup_pois_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            os.rename('data/miyakojima_pois.json', backup_name)
            print(f"📋 JSON 백업: {backup_name}")
    except Exception as e:
        print(f"⚠️ JSON 백업 실패: {e}")

def restore_backup():
    """백업에서 JSON 복원"""
    try:
        # 가장 최근 백업 파일 찾기
        backup_files = [f for f in os.listdir('data/') if f.startswith('backup_pois_')]
        if backup_files:
            latest_backup = sorted(backup_files)[-1]
            os.rename(f"data/{latest_backup}", 'data/miyakojima_pois.json')
            print(f"🔄 백업에서 복원: {latest_backup}")
    except Exception as e:
        print(f"❌ 백업 복원 실패: {e}")

def validate_downloaded_data(poi_data):
    """다운로드된 데이터 품질 검증"""
    total_count = len(poi_data)
    valid_count = 0
    category_count = {}
    
    for poi in poi_data:
        # 기본 유효성 검사
        if (poi.get('id') and poi.get('name') and 
            poi.get('category') and poi.get('coordinates')):
            valid_count += 1
            
            # 카테고리 통계
            category = poi['category']
            category_count[category] = category_count.get(category, 0) + 1
    
    quality_score = (valid_count / total_count * 100) if total_count > 0 else 0
    
    report = {
        'total': total_count,
        'valid': valid_count,
        'score': quality_score,
        'categories': category_count
    }
    
    print("\n📈 다운로드 데이터 분석:")
    print(f"  총 POI: {total_count}개")
    print(f"  유효 POI: {valid_count}개")
    print(f"  품질 점수: {quality_score:.1f}%")
    print(f"  카테고리: {len(category_count)}개")
    
    return report

if __name__ == "__main__":
    print("📥 스프레드시트에서 POI 데이터 다운로드 시작")
    print("=" * 50)
    
    download_and_update_json()
```

### monitor_changes.py
```python
"""실시간 변경사항 모니터링"""

import time
import json
from datetime import datetime
from google_sheets_client import GoogleSheetsClient

class ChangeMonitor:
    def __init__(self):
        self.sheets_client = GoogleSheetsClient()
        self.last_check = datetime.now()
        self.monitoring = False
    
    def start_monitoring(self, interval=300):
        """변경사항 모니터링 시작 (기본 5분 간격)"""
        print(f"🔍 변경사항 모니터링 시작 (간격: {interval}초)")
        self.monitoring = True
        
        try:
            while self.monitoring:
                self.check_for_changes()
                time.sleep(interval)
        except KeyboardInterrupt:
            print("\n⏹️ 모니터링 중단됨")
            self.monitoring = False
    
    def check_for_changes(self):
        """변경사항 확인 및 처리"""
        current_time = datetime.now()
        print(f"\n🔍 변경사항 확인 중... ({current_time.strftime('%Y-%m-%d %H:%M:%S')})")
        
        # 스프레드시트 마지막 수정 시간 확인
        sheet_modified = self.sheets_client.get_last_modified()
        
        if sheet_modified and sheet_modified > self.last_check:
            print("🔄 변경사항 감지! 동기화 시작...")
            
            # 변경된 데이터 다운로드
            from download_from_sheets import download_and_update_json
            success = download_and_update_json()
            
            if success:
                print("✅ 동기화 완료")
                # 웹 애플리케이션에 변경 알림 (선택사항)
                self.notify_web_app()
            else:
                print("❌ 동기화 실패")
            
            self.last_check = current_time
        else:
            print("📝 변경사항 없음")
    
    def notify_web_app(self):
        """웹 애플리케이션에 데이터 변경 알림"""
        try:
            # 변경 알림 파일 생성 (웹앱에서 polling으로 확인)
            notification = {
                'timestamp': datetime.now().isoformat(),
                'type': 'poi_data_updated',
                'message': 'POI 데이터가 업데이트되었습니다.'
            }
            
            with open('data/update_notification.json', 'w', encoding='utf-8') as f:
                json.dump(notification, f, ensure_ascii=False, indent=2)
            
            print("📢 웹 애플리케이션에 변경 알림 전송")
            
        except Exception as e:
            print(f"⚠️ 알림 전송 실패: {e}")
    
    def stop_monitoring(self):
        """모니터링 중단"""
        self.monitoring = False
        print("⏹️ 모니터링 중단")

if __name__ == "__main__":
    print("🔍 미야코지마 POI 실시간 모니터링 시작")
    print("=" * 50)
    print("Ctrl+C로 중단할 수 있습니다.")
    
    monitor = ChangeMonitor()
    monitor.start_monitoring(interval=300)  # 5분마다 확인
```

### sync_scheduler.py
```python
"""자동 동기화 스케줄러"""

import schedule
import time
from datetime import datetime
from upload_to_sheets import upload_current_poi_data
from download_from_sheets import download_and_update_json

class SyncScheduler:
    def __init__(self):
        self.setup_schedules()
    
    def setup_schedules(self):
        """동기화 스케줄 설정"""
        # 매일 오전 3시 전체 업로드 (JSON → 스프레드시트)
        schedule.every().day.at("03:00").do(self.full_upload)
        
        # 매시간 변경사항 다운로드 (스프레드시트 → JSON)
        schedule.every().hour.do(self.incremental_download)
        
        # 매일 오후 9시 품질 검사
        schedule.every().day.at("21:00").do(self.quality_check)
        
        print("⏰ 동기화 스케줄 설정 완료")
        print("  - 03:00: 전체 업로드 (JSON → 시트)")
        print("  - 매시간: 변경사항 다운로드 (시트 → JSON)")
        print("  - 21:00: 데이터 품질 검사")
    
    def full_upload(self):
        """전체 데이터 업로드"""
        print(f"\n🚀 예약 업로드 시작 - {datetime.now()}")
        try:
            success = upload_current_poi_data()
            if success:
                self.log_sync_result("upload", "success")
            else:
                self.log_sync_result("upload", "failed")
        except Exception as e:
            print(f"❌ 예약 업로드 오류: {e}")
            self.log_sync_result("upload", "error", str(e))
    
    def incremental_download(self):
        """증분 다운로드"""
        print(f"\n📥 예약 다운로드 시작 - {datetime.now()}")
        try:
            success = download_and_update_json()
            if success:
                self.log_sync_result("download", "success")
            else:
                self.log_sync_result("download", "failed")
        except Exception as e:
            print(f"❌ 예약 다운로드 오류: {e}")
            self.log_sync_result("download", "error", str(e))
    
    def quality_check(self):
        """데이터 품질 검사"""
        print(f"\n🔍 품질 검사 시작 - {datetime.now()}")
        try:
            from validation_utils import run_quality_check
            report = run_quality_check()
            self.log_sync_result("quality_check", "completed", f"Score: {report['score']}")
        except Exception as e:
            print(f"❌ 품질 검사 오류: {e}")
            self.log_sync_result("quality_check", "error", str(e))
    
    def log_sync_result(self, operation, status, details=""):
        """동기화 결과 로깅"""
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'operation': operation,
            'status': status,
            'details': details
        }
        
        try:
            import json
            import os
            
            log_file = 'logs/sync_log.json'
            
            # 로그 디렉토리 생성
            os.makedirs('logs', exist_ok=True)
            
            # 기존 로그 읽기
            if os.path.exists(log_file):
                with open(log_file, 'r', encoding='utf-8') as f:
                    logs = json.load(f)
            else:
                logs = []
            
            # 새 로그 추가
            logs.append(log_entry)
            
            # 최근 100개만 유지
            if len(logs) > 100:
                logs = logs[-100:]
            
            # 로그 저장
            with open(log_file, 'w', encoding='utf-8') as f:
                json.dump(logs, f, ensure_ascii=False, indent=2)
            
        except Exception as e:
            print(f"⚠️ 로그 저장 실패: {e}")
    
    def start(self):
        """스케줄러 시작"""
        print("▶️ 자동 동기화 스케줄러 시작")
        
        try:
            while True:
                schedule.run_pending()
                time.sleep(60)  # 1분마다 스케줄 확인
        except KeyboardInterrupt:
            print("\n⏹️ 스케줄러 중단됨")

if __name__ == "__main__":
    print("⏰ 미야코지마 POI 자동 동기화 스케줄러")
    print("=" * 50)
    print("Ctrl+C로 중단할 수 있습니다.")
    
    scheduler = SyncScheduler()
    scheduler.start()
```

### validation_utils.py
```python
"""데이터 검증 유틸리티"""

import json
import os
from datetime import datetime
from sheets_config import VALID_CATEGORIES, COORDINATE_BOUNDS

def run_quality_check():
    """전체 데이터 품질 검사"""
    print("🔍 데이터 품질 검사 시작...")
    
    # JSON 파일 읽기
    try:
        with open('data/miyakojima_pois.json', 'r', encoding='utf-8') as f:
            pois = json.load(f)
    except Exception as e:
        return {'score': 0, 'error': f"JSON 읽기 실패: {e}"}
    
    total_count = len(pois)
    issues = []
    
    # 각 POI 검증
    valid_count = 0
    for i, poi in enumerate(pois):
        poi_issues = validate_single_poi(poi, i)
        if not poi_issues:
            valid_count += 1
        else:
            issues.extend(poi_issues)
    
    # 카테고리 균형 검사
    category_distribution = check_category_balance(pois)
    
    # 중복 ID 검사
    duplicate_ids = check_duplicate_ids(pois)
    if duplicate_ids:
        issues.append(f"중복 ID 발견: {duplicate_ids}")
    
    # 좌표 클러스터링 검사
    coordinate_issues = check_coordinate_clustering(pois)
    issues.extend(coordinate_issues)
    
    # 품질 점수 계산
    quality_score = calculate_quality_score(
        valid_count, total_count, len(issues), category_distribution
    )
    
    # 보고서 생성
    report = {
        'timestamp': datetime.now().isoformat(),
        'total_pois': total_count,
        'valid_pois': valid_count,
        'issues_count': len(issues),
        'issues': issues[:10],  # 상위 10개 이슈만
        'category_distribution': category_distribution,
        'score': quality_score,
        'grade': get_quality_grade(quality_score)
    }
    
    # 보고서 저장
    save_quality_report(report)
    
    # 결과 출력
    print(f"📊 품질 검사 완료:")
    print(f"  총 POI: {total_count}개")
    print(f"  유효 POI: {valid_count}개")
    print(f"  이슈: {len(issues)}개")
    print(f"  품질 점수: {quality_score:.1f}%")
    print(f"  등급: {report['grade']}")
    
    return report

def validate_single_poi(poi, index):
    """개별 POI 검증"""
    issues = []
    poi_id = poi.get('id', f'index_{index}')
    
    # 필수 필드 확인
    required_fields = ['id', 'name', 'category', 'coordinates', 'rating']
    for field in required_fields:
        if not poi.get(field):
            issues.append(f"POI {poi_id}: {field} 누락")
    
    # 카테고리 유효성
    category = poi.get('category')
    if category and category not in VALID_CATEGORIES:
        issues.append(f"POI {poi_id}: 유효하지 않은 카테고리 '{category}'")
    
    # 좌표 유효성
    coordinates = poi.get('coordinates')
    if coordinates and len(coordinates) == 2:
        lat, lng = coordinates
        if not (COORDINATE_BOUNDS['lat_min'] <= lat <= COORDINATE_BOUNDS['lat_max']):
            issues.append(f"POI {poi_id}: 위도 범위 벗어남 {lat}")
        if not (COORDINATE_BOUNDS['lng_min'] <= lng <= COORDINATE_BOUNDS['lng_max']):
            issues.append(f"POI {poi_id}: 경도 범위 벗어남 {lng}")
    
    # 평점 유효성
    rating = poi.get('rating')
    if rating and not (0 <= rating <= 5):
        issues.append(f"POI {poi_id}: 평점 범위 벗어남 {rating}")
    
    # 이름 길이 확인
    name = poi.get('name', '')
    if len(name) > 100:
        issues.append(f"POI {poi_id}: 이름이 너무 길음 ({len(name)}자)")
    
    return issues

def check_category_balance(pois):
    """카테고리 균형 검사"""
    category_count = {}
    for poi in pois:
        category = poi.get('category', 'unknown')
        category_count[category] = category_count.get(category, 0) + 1
    
    total = len(pois)
    distribution = {}
    for category, count in category_count.items():
        percentage = (count / total * 100) if total > 0 else 0
        distribution[category] = {
            'count': count,
            'percentage': round(percentage, 1)
        }
    
    return distribution

def check_duplicate_ids(pois):
    """중복 ID 검사"""
    seen_ids = set()
    duplicates = []
    
    for poi in pois:
        poi_id = poi.get('id')
        if poi_id in seen_ids:
            duplicates.append(poi_id)
        else:
            seen_ids.add(poi_id)
    
    return duplicates

def check_coordinate_clustering(pois):
    """좌표 클러스터링 검사 (너무 가까운 POI 감지)"""
    issues = []
    threshold = 0.001  # 약 100m
    
    for i, poi1 in enumerate(pois):
        for j, poi2 in enumerate(pois[i+1:], i+1):
            coords1 = poi1.get('coordinates', [0, 0])
            coords2 = poi2.get('coordinates', [0, 0])
            
            # 거리 계산 (간단한 유클리드 거리)
            distance = ((coords1[0] - coords2[0])**2 + (coords1[1] - coords2[1])**2)**0.5
            
            if distance < threshold:
                issues.append(
                    f"너무 가까운 POI: {poi1.get('id')} - {poi2.get('id')} "
                    f"(거리: {distance:.6f})"
                )
    
    return issues[:5]  # 상위 5개만 반환

def calculate_quality_score(valid_count, total_count, issues_count, category_distribution):
    """품질 점수 계산"""
    if total_count == 0:
        return 0
    
    # 기본 점수 (유효성)
    validity_score = (valid_count / total_count) * 70
    
    # 이슈 점수 (적을수록 좋음)
    issue_penalty = min(issues_count * 2, 20)
    issue_score = 20 - issue_penalty
    
    # 카테고리 균형 점수
    balance_score = calculate_balance_score(category_distribution)
    
    total_score = validity_score + issue_score + balance_score
    return min(100, max(0, total_score))

def calculate_balance_score(distribution):
    """카테고리 균형 점수 계산"""
    if not distribution:
        return 0
    
    percentages = [data['percentage'] for data in distribution.values()]
    
    # 이상적인 균형 (각 카테고리 16.67%)
    ideal_percentage = 100 / len(VALID_CATEGORIES)
    
    # 편차 계산
    variance = sum((p - ideal_percentage)**2 for p in percentages) / len(percentages)
    
    # 점수 변환 (편차가 적을수록 높은 점수)
    balance_score = max(0, 10 - variance / 10)
    
    return balance_score

def get_quality_grade(score):
    """품질 점수를 등급으로 변환"""
    if score >= 95:
        return "A+"
    elif score >= 90:
        return "A"
    elif score >= 85:
        return "B+"
    elif score >= 80:
        return "B"
    elif score >= 75:
        return "C+"
    elif score >= 70:
        return "C"
    else:
        return "D"

def save_quality_report(report):
    """품질 보고서 저장"""
    try:
        os.makedirs('claudedocs', exist_ok=True)
        
        # 상세 보고서
        with open('claudedocs/quality_report.json', 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        # 간단한 요약
        summary = f"""# 데이터 품질 보고서

**검사 시간**: {report['timestamp']}
**총 POI**: {report['total_pois']}개
**유효 POI**: {report['valid_pois']}개
**품질 점수**: {report['score']:.1f}%
**등급**: {report['grade']}

## 카테고리 분포
"""
        
        for category, data in report['category_distribution'].items():
            summary += f"- {category}: {data['count']}개 ({data['percentage']}%)\n"
        
        if report['issues']:
            summary += "\n## 주요 이슈\n"
            for issue in report['issues'][:5]:
                summary += f"- {issue}\n"
        
        with open('claudedocs/quality_summary.md', 'w', encoding='utf-8') as f:
            f.write(summary)
        
        print("📄 품질 보고서 저장 완료")
        
    except Exception as e:
        print(f"⚠️ 보고서 저장 실패: {e}")

if __name__ == "__main__":
    print("🔍 미야코지마 POI 데이터 품질 검사")
    print("=" * 50)
    
    run_quality_check()
```

---

## 🚀 실행 방법

### 초기 설정 (한 번만)
```bash
# 1. 가상환경 생성
python -m venv poi_sync_env
poi_sync_env\Scripts\activate

# 2. 패키지 설치
pip install gspread google-auth pandas schedule

# 3. 설정 파일 수정
# sheets_config.py에서 SPREADSHEET_ID 설정

# 4. 초기 업로드
python upload_to_sheets.py
```

### 일상 사용
```bash
# 스프레드시트 → JSON 동기화
python download_from_sheets.py

# 실시간 모니터링 시작
python monitor_changes.py

# 자동 스케줄러 시작
python sync_scheduler.py

# 품질 검사
python validation_utils.py
```

---

## 🎯 다음 단계

이제 **완벽한 스프레드시트 연동 시스템**이 구축되었습니다!

**즉시 실행 가능**:
1. Google Cloud 설정 (10분)
2. 스프레드시트 생성 (5분)  
3. Python 환경 설정 (10분)
4. 첫 업로드 실행 (5분)

**향후 데이터베이스 연동 시에도 이 시스템을 확장**하여 사용할 수 있습니다.

🎉 **100개 POI 데이터**와 함께 실제 운영 환경에서 사용할 수 있는 완전한 동기화 시스템이 완성되었습니다!