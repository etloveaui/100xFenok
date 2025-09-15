"""Google Sheets API 클라이언트"""
import gspread
import json
import pandas as pd
from google.oauth2.service_account import Credentials
from sheets_config import *

class GoogleSheetsClient:
    def __init__(self):
        self.client = None
        self.spreadsheet = None
        self.worksheet = None
        self._authenticate()

    def _authenticate(self):
        """Google Sheets 인증"""
        scope = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        credentials = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scope)
        self.client = gspread.authorize(credentials)
        self.spreadsheet = self.client.open_by_key(SPREADSHEET_ID)
        self.worksheet = self.spreadsheet.worksheet(WORKSHEET_NAME)

    def get_all_data(self):
        """스프레드시트의 모든 데이터 가져오기"""
        return self.worksheet.get_all_records()

    def clear_sheet(self):
        """워크시트 내용 지우기"""
        self.worksheet.clear()

    def upload_headers(self):
        """POI 컬럼 헤더 업로드"""
        self.worksheet.update('A1', [POI_COLUMNS])

    def upload_data(self, data):
        """데이터 업로드"""
        if not data:
            return 0

        # 헤더 먼저 업로드
        self.upload_headers()

        # 데이터 변환
        rows = []
        for poi in data:
            row = []
            for col in POI_COLUMNS:
                value = self._extract_value(poi, col)
                row.append(str(value) if value is not None else '')
            rows.append(row)

        # 배치 업로드
        if rows:
            range_name = f'A2:{chr(ord("A") + len(POI_COLUMNS) - 1)}{len(rows)+1}'
            self.worksheet.update(range_name, rows)

        return len(rows)

    def _extract_value(self, poi, column):
        """POI 객체에서 컬럼 값 추출"""
        # 직접 매핑되는 필드들
        if column in poi:
            value = poi[column]
            # 리스트나 딕셔너리는 JSON 문자열로 변환
            if isinstance(value, (list, dict)):
                return json.dumps(value, ensure_ascii=False)
            return value

        # 중첩된 필드들
        nested_mappings = {
            'parking_notes': ['parking', 'notes'],
            'seasonality_best_time': ['seasonality', 'best_time'],
            'description_short': ['description', 'short']
        }

        if column in nested_mappings:
            obj = poi
            for key in nested_mappings[column]:
                if isinstance(obj, dict) and key in obj:
                    obj = obj[key]
                else:
                    return ''
            if isinstance(obj, (list, dict)):
                return json.dumps(obj, ensure_ascii=False)
            return str(obj) if obj is not None else ''

        return ''

    def get_spreadsheet_info(self):
        """스프레드시트 정보 반환"""
        return {
            'id': self.spreadsheet.id,
            'title': self.spreadsheet.title,
            'worksheet_count': len(self.spreadsheet.worksheets()),
            'current_worksheet': self.worksheet.title,
            'row_count': self.worksheet.row_count,
            'col_count': self.worksheet.col_count
        }