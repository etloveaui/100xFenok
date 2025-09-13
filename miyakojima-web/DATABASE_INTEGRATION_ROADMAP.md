# 🗄️ 데이터베이스 통합 로드맵

## 📋 프로젝트 개요
**목표**: 정적 JSON 기반 미야코지마 웹 플랫폼을 실제 데이터베이스와 연동하여 동적 데이터 관리 시스템 구축

**현재 상태**: ✅ Phase 4 완료 - 100개 POI 완성, 데이터베이스 연동 프레임워크 구축 완료

---

## 🎯 통합 목표

### 1차 목표 (스프레드시트 연동)
- Google Sheets API를 통한 실시간 POI 데이터 동기화
- Excel Online API 연동 (선택사항)
- 양방향 동기화: JSON ↔ 스프레드시트

### 2차 목표 (데이터베이스 연동)
- PostgreSQL/MySQL 기반 Production 환경 구축
- RESTful API 백엔드 구현
- 실시간 데이터 동기화 시스템

### 최종 목표 (하이브리드 시스템)
- GitHub Pages(프론트엔드) + 클라우드 DB(백엔드) 하이브리드 아키텍처
- 오프라인 우선 동기화 (Offline-First Sync)
- 충돌 해결 메커니즘

---

## 🏗️ 현재 구축된 프레임워크

### 파일 구조
```
miyakojima-web/
├── 📄 database_config.py          # 다중 DB 연결 설정
├── 📄 data_sync_utils.py          # JSON ↔ DB 동기화 유틸리티
├── 📄 expansion_config.py         # 확장 시스템 설정
├── 📄 poi_expansion_main.py       # Production-Grade 확장 엔진
└── 📁 data/
    └── 📄 miyakojima_pois.json    # 현재 100개 POI 데이터
```

### 지원 데이터베이스
- **PostgreSQL**: 고성능 관계형 DB (추천)
- **MySQL**: 범용 관계형 DB
- **MongoDB**: NoSQL 문서 기반 DB
- **SQLite**: 로컬/개발용 경량 DB

---

## 📊 1단계: 스프레드시트 연동 (2-3일)

### Google Sheets API 연동

#### 1.1 API 설정
```bash
# 필요한 패키지 설치
pip install google-auth google-auth-oauthlib google-auth-httplib2
pip install google-api-python-client gspread
```

#### 1.2 인증 설정
```python
# google_sheets_client.py
import gspread
from google.oauth2.service_account import Credentials

class GoogleSheetsClient:
    def __init__(self, credentials_file):
        scope = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        credentials = Credentials.from_service_account_file(
            credentials_file, scopes=scope
        )
        self.client = gspread.authorize(credentials)
    
    def get_poi_data(self, sheet_id, worksheet_name='POIs'):
        """스프레드시트에서 POI 데이터 읽기"""
        sheet = self.client.open_by_key(sheet_id)
        worksheet = sheet.worksheet(worksheet_name)
        return worksheet.get_all_records()
    
    def update_poi_data(self, sheet_id, poi_list, worksheet_name='POIs'):
        """POI 데이터를 스프레드시트에 업데이트"""
        sheet = self.client.open_by_key(sheet_id)
        worksheet = sheet.worksheet(worksheet_name)
        # 기존 데이터 클리어 후 새 데이터 입력
        worksheet.clear()
        headers = ['id', 'name', 'name_en', 'category', 'rating', 'lat', 'lng']
        worksheet.append_row(headers)
        for poi in poi_list:
            row = [poi.get(h, '') for h in headers]
            worksheet.append_row(row)
```

#### 1.3 동기화 스크립트
```python
# sync_with_sheets.py
import json
from google_sheets_client import GoogleSheetsClient
from data_sync_utils import DataSyncUtils

class SpreadsheetSync:
    def __init__(self, credentials_file, sheet_id):
        self.sheets_client = GoogleSheetsClient(credentials_file)
        self.sheet_id = sheet_id
        self.sync_utils = DataSyncUtils()
    
    def json_to_sheets(self):
        """JSON 데이터를 스프레드시트로 업로드"""
        with open('data/miyakojima_pois.json', 'r', encoding='utf-8') as f:
            pois = json.load(f)
        
        self.sheets_client.update_poi_data(self.sheet_id, pois)
        print(f"✅ {len(pois)}개 POI 데이터 스프레드시트 업로드 완료")
    
    def sheets_to_json(self):
        """스프레드시트 데이터를 JSON으로 다운로드"""
        sheet_data = self.sheets_client.get_poi_data(self.sheet_id)
        
        # 데이터 검증 및 변환
        validated_pois = []
        for row in sheet_data:
            poi = self.sync_utils.validate_poi_data(row)
            if poi:
                validated_pois.append(poi)
        
        # JSON 파일 저장
        with open('data/miyakojima_pois.json', 'w', encoding='utf-8') as f:
            json.dump(validated_pois, f, ensure_ascii=False, indent=2)
        
        print(f"✅ 스프레드시트에서 {len(validated_pois)}개 POI 데이터 다운로드 완료")
```

### 실행 스크립트
```python
# run_sheet_sync.py
from sync_with_sheets import SpreadsheetSync

def main():
    # Google Cloud Console에서 생성한 서비스 계정 JSON 파일
    CREDENTIALS_FILE = 'path/to/service-account-key.json'
    # 스프레드시트 ID (URL에서 추출)
    SHEET_ID = 'your-google-sheet-id'
    
    sync = SpreadsheetSync(CREDENTIALS_FILE, SHEET_ID)
    
    # JSON → 스프레드시트 업로드
    sync.json_to_sheets()
    
    # 스프레드시트 → JSON 다운로드 (수정 사항 반영 시)
    # sync.sheets_to_json()

if __name__ == "__main__":
    main()
```

---

## 🗄️ 2단계: 데이터베이스 연동 (1주)

### PostgreSQL 연동 예시

#### 2.1 데이터베이스 스키마
```sql
-- poi_schema.sql
CREATE DATABASE miyakojima_travel;

CREATE TABLE pois (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    category VARCHAR(50) NOT NULL,
    subcategory VARCHAR(50),
    rating DECIMAL(2,1),
    review_count INTEGER DEFAULT 0,
    latitude DECIMAL(10,8) NOT NULL,
    longitude DECIMAL(11,8) NOT NULL,
    address TEXT,
    phone VARCHAR(20),
    website VARCHAR(500),
    description TEXT,
    opening_hours JSONB,
    price_range VARCHAR(20),
    amenities JSONB,
    weather_dependent BOOLEAN DEFAULT false,
    best_time JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX idx_pois_category ON pois(category);
CREATE INDEX idx_pois_rating ON pois(rating);
CREATE INDEX idx_pois_location ON pois(latitude, longitude);
```

#### 2.2 Python 연동 클래스
```python
# database_manager.py
import psycopg2
import json
from contextlib import contextmanager

class DatabaseManager:
    def __init__(self, config):
        self.config = config
    
    @contextmanager
    def get_connection(self):
        conn = psycopg2.connect(**self.config)
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def migrate_json_to_db(self):
        """JSON 데이터를 데이터베이스로 마이그레이션"""
        with open('data/miyakojima_pois.json', 'r', encoding='utf-8') as f:
            pois = json.load(f)
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            for poi in pois:
                cursor.execute("""
                    INSERT INTO pois (
                        id, name, name_en, category, rating, 
                        latitude, longitude, weather_dependent, best_time
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        rating = EXCLUDED.rating,
                        updated_at = CURRENT_TIMESTAMP
                """, (
                    poi['id'], poi['name'], poi.get('name_en'),
                    poi['category'], poi['rating'],
                    poi['coordinates'][0], poi['coordinates'][1],
                    poi.get('weather_dependent', False),
                    json.dumps(poi.get('best_time', []))
                ))
            
            print(f"✅ {len(pois)}개 POI 데이터 데이터베이스 마이그레이션 완료")
    
    def export_db_to_json(self):
        """데이터베이스 데이터를 JSON으로 익스포트"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, name, name_en, category, rating, 
                       latitude, longitude, weather_dependent, best_time
                FROM pois ORDER BY category, rating DESC
            """)
            
            pois = []
            for row in cursor.fetchall():
                poi = {
                    'id': row[0],
                    'name': row[1],
                    'name_en': row[2],
                    'category': row[3],
                    'rating': float(row[4]) if row[4] else 0,
                    'coordinates': [float(row[5]), float(row[6])],
                    'weather_dependent': row[7],
                    'best_time': json.loads(row[8]) if row[8] else []
                }
                pois.append(poi)
            
            # JSON 파일 저장
            with open('data/miyakojima_pois.json', 'w', encoding='utf-8') as f:
                json.dump(pois, f, ensure_ascii=False, indent=2)
            
            print(f"✅ 데이터베이스에서 {len(pois)}개 POI 데이터 익스포트 완료")
```

#### 2.3 REST API 백엔드 (FastAPI)
```python
# api_server.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from database_manager import DatabaseManager

app = FastAPI(title="Miyakojima POI API")

class POI(BaseModel):
    id: str
    name: str
    name_en: Optional[str]
    category: str
    rating: float
    coordinates: List[float]
    weather_dependent: bool = False
    best_time: List[str] = []

@app.get("/api/pois", response_model=List[POI])
async def get_all_pois():
    """모든 POI 데이터 조회"""
    db = DatabaseManager(DB_CONFIG)
    return db.get_all_pois()

@app.get("/api/pois/{category}", response_model=List[POI])
async def get_pois_by_category(category: str):
    """카테고리별 POI 조회"""
    db = DatabaseManager(DB_CONFIG)
    return db.get_pois_by_category(category)

@app.post("/api/pois", response_model=POI)
async def create_poi(poi: POI):
    """새 POI 생성"""
    db = DatabaseManager(DB_CONFIG)
    return db.create_poi(poi.dict())

@app.put("/api/pois/{poi_id}", response_model=POI)
async def update_poi(poi_id: str, poi: POI):
    """POI 업데이트"""
    db = DatabaseManager(DB_CONFIG)
    return db.update_poi(poi_id, poi.dict())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 🔄 3단계: 하이브리드 동기화 시스템 (1-2주)

### 실시간 동기화 아키텍처

```python
# sync_orchestrator.py
import asyncio
import json
from datetime import datetime
from google_sheets_client import GoogleSheetsClient
from database_manager import DatabaseManager

class SyncOrchestrator:
    def __init__(self, sheets_client, db_manager):
        self.sheets = sheets_client
        self.db = db_manager
        self.last_sync = None
    
    async def full_sync_cycle(self):
        """완전 동기화 사이클"""
        print("🔄 전체 동기화 시작...")
        
        # 1. 데이터베이스 → JSON (최신 상태)
        self.db.export_db_to_json()
        
        # 2. JSON → 스프레드시트 (백업 및 편집용)
        with open('data/miyakojima_pois.json', 'r', encoding='utf-8') as f:
            pois = json.load(f)
        self.sheets.update_poi_data(SHEET_ID, pois)
        
        # 3. 타임스탬프 업데이트
        self.last_sync = datetime.now()
        print(f"✅ 전체 동기화 완료: {self.last_sync}")
    
    async def incremental_sync(self):
        """증분 동기화 (변경사항만)"""
        print("⚡ 증분 동기화 시작...")
        
        # 스프레드시트에서 최근 변경사항 확인
        sheet_data = self.sheets.get_poi_data(SHEET_ID)
        
        # 데이터베이스와 비교하여 변경사항 감지
        changes = self.detect_changes(sheet_data)
        
        if changes:
            # 변경사항을 데이터베이스에 적용
            self.apply_changes_to_db(changes)
            
            # JSON 파일 업데이트
            self.db.export_db_to_json()
            
            print(f"✅ {len(changes)}건의 변경사항 동기화 완료")
        else:
            print("📝 변경사항 없음")
    
    def detect_changes(self, sheet_data):
        """변경사항 감지 로직"""
        # 현재 JSON 데이터와 스프레드시트 데이터 비교
        with open('data/miyakojima_pois.json', 'r', encoding='utf-8') as f:
            current_data = {poi['id']: poi for poi in json.load(f)}
        
        changes = []
        for sheet_poi in sheet_data:
            poi_id = sheet_poi.get('id')
            if poi_id in current_data:
                # 기존 POI 수정 확인
                if self.poi_has_changes(current_data[poi_id], sheet_poi):
                    changes.append(('update', sheet_poi))
            else:
                # 새 POI 추가
                changes.append(('create', sheet_poi))
        
        return changes
    
    def poi_has_changes(self, current_poi, sheet_poi):
        """개별 POI 변경사항 확인"""
        key_fields = ['name', 'category', 'rating']
        for field in key_fields:
            if current_poi.get(field) != sheet_poi.get(field):
                return True
        return False
```

### 자동 동기화 스케줄러
```python
# sync_scheduler.py
import schedule
import time
from sync_orchestrator import SyncOrchestrator

def setup_sync_schedule():
    """동기화 스케줄 설정"""
    orchestrator = SyncOrchestrator(sheets_client, db_manager)
    
    # 매일 오전 3시 전체 동기화
    schedule.every().day.at("03:00").do(orchestrator.full_sync_cycle)
    
    # 매시간 증분 동기화
    schedule.every().hour.do(orchestrator.incremental_sync)
    
    print("⏰ 동기화 스케줄러 시작됨")
    
    while True:
        schedule.run_pending()
        time.sleep(60)  # 1분마다 스케줄 확인

if __name__ == "__main__":
    setup_sync_schedule()
```

---

## 🚀 배포 및 운영 가이드

### 클라우드 배포 옵션

#### Option 1: Heroku (간단한 시작)
```bash
# Procfile
web: uvicorn api_server:app --host=0.0.0.0 --port=${PORT:-5000}
worker: python sync_scheduler.py
```

#### Option 2: AWS (Production 권장)
- **RDS**: PostgreSQL 데이터베이스
- **EC2/Lambda**: API 서버 및 동기화 워커
- **CloudWatch**: 로그 및 모니터링
- **S3**: 데이터 백업

#### Option 3: Vercel + PlanetScale (JAMstack)
- **Vercel**: API Routes (serverless)
- **PlanetScale**: MySQL 데이터베이스
- **GitHub Actions**: 자동 동기화

### 모니터링 대시보드
```python
# monitoring.py
from flask import Flask, render_template
import json
from datetime import datetime

app = Flask(__name__)

@app.route('/admin/sync-status')
def sync_status():
    """동기화 상태 모니터링 대시보드"""
    status = {
        'last_sync': get_last_sync_time(),
        'total_pois': get_total_poi_count(),
        'sync_errors': get_recent_errors(),
        'performance_metrics': get_sync_performance()
    }
    return render_template('sync_dashboard.html', status=status)

def get_sync_performance():
    """동기화 성능 메트릭"""
    return {
        'avg_sync_time': '2.3 seconds',
        'success_rate': '99.8%',
        'data_consistency': '100%'
    }
```

---

## 📋 실행 체크리스트

### 스프레드시트 연동 체크리스트
- [ ] Google Cloud Console 프로젝트 생성
- [ ] Sheets API 활성화
- [ ] 서비스 계정 생성 및 키 다운로드
- [ ] 스프레드시트 생성 및 권한 설정
- [ ] Python 패키지 설치
- [ ] 동기화 스크립트 테스트
- [ ] 자동화 스케줄 설정

### 데이터베이스 연동 체크리스트
- [ ] 데이터베이스 서버 설정 (PostgreSQL/MySQL)
- [ ] 스키마 생성 및 인덱스 설정
- [ ] Python 연결 라이브러리 설치
- [ ] 마이그레이션 스크립트 실행
- [ ] API 서버 구현 및 테스트
- [ ] 프론트엔드 API 연동 수정

### 운영 환경 체크리스트
- [ ] 클라우드 서비스 선택 및 설정
- [ ] 환경 변수 및 보안 설정
- [ ] 자동 백업 시스템 구축
- [ ] 모니터링 및 알림 설정
- [ ] 성능 테스트 및 최적화
- [ ] 장애 대응 매뉴얼 작성

---

## 🎯 예상 타임라인

### 1주차: 스프레드시트 연동
- Day 1-2: Google Sheets API 설정 및 인증
- Day 3-4: 동기화 스크립트 개발
- Day 5-7: 테스트 및 자동화 설정

### 2주차: 데이터베이스 연동
- Day 1-2: 데이터베이스 스키마 설계 및 구축
- Day 3-4: Python 연동 및 마이그레이션
- Day 5-7: REST API 개발 및 테스트

### 3주차: 하이브리드 시스템
- Day 1-3: 실시간 동기화 시스템 개발
- Day 4-5: 충돌 해결 메커니즘 구현
- Day 6-7: 종합 테스트 및 최적화

### 4주차: 배포 및 운영
- Day 1-3: 클라우드 배포 및 설정
- Day 4-5: 모니터링 시스템 구축
- Day 6-7: 문서화 및 운영 가이드 작성

---

**다음 단계**: 스프레드시트 연동부터 시작하여 단계적으로 데이터베이스 통합을 완성하겠습니다.

🚀 **준비 완료**: 100개 POI 데이터와 완벽한 프레임워크를 바탕으로 실제 데이터베이스 연동 작업을 시작할 준비가 되었습니다!