"""스프레드시트 연동 설정"""
import os
from dotenv import load_dotenv

load_dotenv()

# Google Sheets 설정
CREDENTIALS_FILE = os.getenv('CREDENTIALS_FILE', 'credentials.json')
SPREADSHEET_ID = os.getenv('SPREADSHEET_ID')
WORKSHEET_NAME = 'POIs'
SERVICE_ACCOUNT_EMAIL = os.getenv('SERVICE_ACCOUNT_EMAIL')

# 동기화 설정
SYNC_INTERVAL = 300  # 5분마다 동기화
BACKUP_ENABLED = True
MAX_RETRIES = 3

# POI 데이터 스키마
POI_COLUMNS = [
    'id', 'name', 'name_en', 'category', 'subcategory',
    'rating', 'review_count', 'latitude', 'longitude',
    'description', 'address', 'phone', 'website',
    'opening_hours', 'price_range', 'tags',
    'weather_dependent', 'best_time', 'accessibility'
]