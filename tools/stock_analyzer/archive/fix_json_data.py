#!/usr/bin/env python3
"""
JSON 데이터에서 NaN 값을 완전히 제거하는 스크립트
"""

import pandas as pd
import json
import numpy as np
from pathlib import Path

def clean_csv_data():
    """CSV에서 깨끗한 데이터 추출"""
    print("🔧 CSV 데이터 정제 중...")
    
    # CSV 파일 읽기
    csv_file = "../../../../fenomeno_projects/Global_Scouter/Global_Scouter_20251003/A_Company.csv"
    df_raw = pd.read_csv(csv_file, encoding='utf-8')
    
    # 헤더와 데이터 분리
    headers = df_raw.iloc[1].tolist()[1:]  # 첫 번째 빈 컬럼 제외
    data_rows = df_raw.iloc[2:].copy()
    data_rows = data_rows.iloc[:, 1:]  # 첫 번째 빈 컬럼 제거
    data_rows.columns = headers[:len(data_rows.columns)]
    
    print(f"원본 데이터: {data_rows.shape}")
    
    # 깨끗한 데이터 생성
    clean_companies = []
    
    for idx, row in data_rows.iterrows():
        if pd.isna(row.iloc[0]) or str(row.iloc[0]).strip() == '':
            continue
            
        company = {
            'Ticker': clean_value(row.iloc[0]),
            'corpName': clean_value(row.iloc[1]),
            'exchange': clean_value(row.iloc[2]),
            'industry': clean_value(row.iloc[3])
        }
        
        # 나머지 컬럼들 처리
        for i, col_name in enumerate(data_rows.columns[4:], 4):
            if i < len(row):
                company[col_name] = clean_numeric_value(row.iloc[i])
        
        # 검색 인덱스 추가
        company['searchIndex'] = f"{company['Ticker']} {company['corpName']}".lower()
        
        clean_companies.append(company)
    
    print(f"정제된 데이터: {len(clean_companies)}개 기업")
    return clean_companies

def clean_value(value):
    """문자열 값 정제"""
    if pd.isna(value) or value == '' or str(value).lower() == 'nan':
        return ''
    return str(value).strip()

def clean_numeric_value(value):
    """숫자 값 정제 - NaN, Infinity 완전 제거"""
    if pd.isna(value):
        return None
    
    if isinstance(value, str):
        if value.strip() == '' or value.lower() in ['nan', 'inf', '-inf', 'null']:
            return None
        try:
            num_val = float(value)
        except (ValueError, TypeError):
            return None
    else:
        num_val = value
    
    # 숫자 타입 검증
    try:
        num_val = float(num_val)
        if np.isnan(num_val) or np.isinf(num_val):
            return None
        return num_val
    except (ValueError, TypeError, OverflowError):
        return None

def save_clean_json(companies):
    """깨끗한 JSON 저장"""
    print("💾 깨끗한 JSON 저장 중...")
    
    # 메타데이터
    metadata = {
        'version': '2.1',
        'generated_at': pd.Timestamp.now().isoformat(),
        'total_companies': len(companies),
        'description': 'NaN 값 완전 제거된 깨끗한 데이터'
    }
    
    # 최종 데이터
    final_data = {
        'metadata': metadata,
        'companies': companies
    }
    
    # JSON 저장 (NaN 처리 강화)
    output_file = "./data/enhanced_summary_data.json"
    
    class NaNEncoder(json.JSONEncoder):
        def encode(self, obj):
            if isinstance(obj, float):
                if np.isnan(obj) or np.isinf(obj):
                    return 'null'
            return super().encode(obj)
        
        def iterencode(self, obj, _one_shot=False):
            if isinstance(obj, float):
                if np.isnan(obj) or np.isinf(obj):
                    yield 'null'
                    return
            if isinstance(obj, dict):
                yield '{'
                first = True
                for key, value in obj.items():
                    if not first:
                        yield ', '
                    first = False
                    yield json.dumps(key)
                    yield ': '
                    if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
                        yield 'null'
                    else:
                        yield from self.iterencode(value, True)
                yield '}'
                return
            if isinstance(obj, list):
                yield '['
                first = True
                for item in obj:
                    if not first:
                        yield ', '
                    first = False
                    if isinstance(item, float) and (np.isnan(item) or np.isinf(item)):
                        yield 'null'
                    else:
                        yield from self.iterencode(item, True)
                yield ']'
                return
            yield from super().iterencode(obj, _one_shot)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2, cls=NaNEncoder)
    
    # 파일 크기 확인
    file_size = Path(output_file).stat().st_size
    print(f"✅ 저장 완료: {output_file}")
    print(f"📁 파일 크기: {file_size/1024/1024:.1f}MB")
    
    # JSON 유효성 검증
    try:
        with open(output_file, 'r', encoding='utf-8') as f:
            test_data = json.load(f)
        print("✅ JSON 유효성 검증 통과")
        return True
    except json.JSONDecodeError as e:
        print(f"❌ JSON 오류: {e}")
        return False

def create_simple_column_config():
    """간단한 컬럼 설정 생성"""
    config = {
        'categories': {
            'basic': {
                'name': '기본정보',
                'columns': ['Ticker', 'corpName', 'exchange', 'industry']
            }
        },
        'korean_names': {
            'Ticker': '티커',
            'corpName': '회사명',
            'exchange': '거래소',
            'industry': '업종',
            '현재가': '현재가',
            '(USD mn)': '시가총액(백만달러)',
            'ROE (Fwd)': 'ROE 예상(%)'
        }
    }
    
    with open('./data/column_config.json', 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    
    print("✅ 컬럼 설정 저장 완료")

def main():
    print("🚀 JSON 데이터 완전 정제 시작")
    print("=" * 50)
    
    # 1. 깨끗한 데이터 추출
    companies = clean_csv_data()
    
    # 2. 깨끗한 JSON 저장
    success = save_clean_json(companies)
    
    # 3. 컬럼 설정 생성
    create_simple_column_config()
    
    if success:
        print("\\n🎉 완전 정제 완료!")
        print(f"📊 총 {len(companies)}개 기업")
        print("✅ NaN 값 완전 제거")
        print("✅ JSON 유효성 검증 통과")
    else:
        print("\\n❌ 정제 실패")

if __name__ == "__main__":
    main()