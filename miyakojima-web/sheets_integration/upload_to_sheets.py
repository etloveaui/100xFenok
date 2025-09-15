"""JSON 데이터를 Google Sheets로 업로드"""
import json
import os
import sys
from datetime import datetime
from google_sheets_client import GoogleSheetsClient

def load_poi_data():
    """POI JSON 데이터 로드"""
    json_path = '../data/miyakojima_pois.json'
    if not os.path.exists(json_path):
        print(f"❌ POI 데이터 파일을 찾을 수 없습니다: {json_path}")
        return None

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 데이터 구조 확인 및 정규화
    if isinstance(data, list):
        return data
    elif isinstance(data, dict) and 'pois' in data:
        return data['pois']
    else:
        print(f"❌ 예상하지 못한 데이터 형식입니다.")
        return None

def validate_poi_data(poi_data):
    """POI 데이터 유효성 검증"""
    if not poi_data:
        return False, "데이터가 비어있습니다."

    required_fields = ['id', 'name_ko', 'lat', 'lng']
    valid_count = 0
    errors = []

    for i, poi in enumerate(poi_data):
        missing_fields = [field for field in required_fields if not poi.get(field)]
        if missing_fields:
            errors.append(f"POI {i+1}: 필수 필드 누락 - {', '.join(missing_fields)}")
        else:
            valid_count += 1

    if errors:
        print(f"⚠️  검증 오류 발견: {len(errors)}개")
        for error in errors[:5]:  # 처음 5개만 표시
            print(f"   {error}")
        if len(errors) > 5:
            print(f"   ... 및 {len(errors) - 5}개 추가 오류")

    return valid_count > 0, f"유효한 POI: {valid_count}개, 오류: {len(errors)}개"

def main():
    print("🚀 POI 데이터를 Google Sheets로 업로드 중...")

    try:
        # POI 데이터 로드
        poi_data = load_poi_data()
        if not poi_data:
            return False

        print(f"📊 로드된 POI 수: {len(poi_data)}개")

        # 데이터 검증
        is_valid, validation_msg = validate_poi_data(poi_data)
        print(f"🔍 데이터 검증: {validation_msg}")

        if not is_valid:
            print("❌ 데이터 검증 실패. 업로드를 중단합니다.")
            return False

        # Google Sheets 클라이언트 초기화
        print("🔐 Google Sheets 인증 중...")
        client = GoogleSheetsClient()

        # 스프레드시트 정보 확인
        info = client.get_spreadsheet_info()
        print(f"📋 스프레드시트: '{info['title']}'")
        print(f"📄 워크시트: '{info['current_worksheet']}'")
        print(f"📏 크기: {info['row_count']}x{info['col_count']}")

        # 데이터 업로드
        print("📤 데이터 업로드 중...")
        uploaded_count = client.upload_data(poi_data)

        print(f"✅ 업로드 완료: {uploaded_count}개 POI")
        print(f"🕐 업로드 시간: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

        return True

    except Exception as e:
        print(f"❌ 업로드 실패: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)