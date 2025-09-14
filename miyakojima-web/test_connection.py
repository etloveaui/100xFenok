"""Google Sheets 연결 테스트"""
import gspread
from google.oauth2.service_account import Credentials
from sheets_config import CREDENTIALS_FILE, SPREADSHEET_ID
import os

def test_connection():
    try:
        # 인증 설정
        scope = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        credentials = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scope)
        client = gspread.authorize(credentials)

        # 스프레드시트 접근 테스트
        sheet = client.open_by_key(SPREADSHEET_ID)
        worksheet = sheet.sheet1

        print(f"[SUCCESS] Connection established: {sheet.title}")
        print(f"[SUCCESS] Worksheet: {worksheet.title}")
        print(f"[SUCCESS] Size: {worksheet.row_count}x{worksheet.col_count}")

        return True
    except Exception as e:
        print(f"[ERROR] Connection failed: {e}")
        return False

if __name__ == "__main__":
    # Set encoding for Windows console
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    test_connection()