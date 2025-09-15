"""Google Sheets 연동 설정"""
import os

# Google Sheets 설정
SPREADSHEET_ID = "1VvRRQKvE6FksGc3Vj4DLLlYB1_d7YqSsQ-xgAhmwZ1g"
WORKSHEET_NAME = "Miyakojima POI Database"
CREDENTIALS_FILE = "credentials.json"

# POI 데이터 컬럼 정의 (스프레드시트 컬럼 순서)
POI_COLUMNS = [
    'id',
    'name_ko',
    'name_local',
    'category_primary',
    'island',
    'address_raw',
    'postal_code',
    'lat',
    'lng',
    'phone',
    'website',
    'opening_hours',
    'price_level',
    'parking_notes',
    'seasonality_best_time',
    'description_short',
    'tags',
    'weather_dependent',
    'accessibility_level',
    'rating'
]

# 데이터 타입 매핑
COLUMN_TYPES = {
    'lat': float,
    'lng': float,
    'rating': float,
    'weather_dependent': bool,
    'tags': list,
    'alt_names': list,
    'categories_all': list
}

# 필수 필드
REQUIRED_FIELDS = ['id', 'name_ko', 'name_local', 'category_primary', 'lat', 'lng']