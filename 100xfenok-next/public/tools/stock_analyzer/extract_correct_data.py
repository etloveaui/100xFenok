#!/usr/bin/env python3
"""
올바른 CSV 데이터 추출 및 JSON 변환
"""

import pandas as pd
import json
import numpy as np
from pathlib import Path

# 설정
CSV_FILE = "../../../../fenomeno_projects/Global_Scouter/Global_Scouter_20251003/A_Company.csv"
OUTPUT_DIR = "./data"

def extract_correct_data():
    """올바른 형태로 CSV 데이터 추출"""
    print("🔍 CSV 파일 구조 분석 중...")
    
    # CSV 파일 읽기
    df_raw = pd.read_csv(CSV_FILE, encoding='utf-8')
    print(f"원본 파일 크기: {df_raw.shape}")
    
    # 실제 헤더는 1번째 행 (인덱스 1)
    headers = df_raw.iloc[1].tolist()
    print(f"헤더 개수: {len(headers)}")
    print(f"첫 10개 헤더: {headers[1:11]}")  # 첫 번째는 빈 컬럼
    
    # 데이터는 2번째 행부터 (인덱스 2부터)
    data_rows = df_raw.iloc[2:].copy()
    
    # 헤더 설정 (첫 번째 빈 컬럼 제외)
    valid_headers = headers[1:]  # 첫 번째 빈 컬럼 제거
    data_rows.columns = range(len(data_rows.columns))  # 임시 컬럼명
    data_rows = data_rows.iloc[:, 1:]  # 첫 번째 빈 컬럼 제거
    data_rows.columns = valid_headers[:len(data_rows.columns)]  # 올바른 헤더 적용
    
    print(f"정제된 데이터 크기: {data_rows.shape}")
    print(f"컬럼명: {list(data_rows.columns[:10])}")
    
    # 샘플 데이터 확인
    print("\\n📊 샘플 데이터:")
    for i in range(min(3, len(data_rows))):
        row = data_rows.iloc[i]
        print(f"  {i+1}. {row.iloc[0]} - {row.iloc[1]} ({row.iloc[2]})")
    
    return data_rows

def create_enhanced_json(df):
    """강화된 JSON 데이터 생성"""
    print("\\n🔧 JSON 데이터 생성 중...")
    
    # 기본 정보 매핑
    column_mapping = {
        'Ticker': 'Ticker',
        'Corp': 'corpName', 
        'Exchange': 'exchange',
        'WI26': 'industry'  # 실제 컬럼명 확인 필요
    }
    
    enhanced_data = []
    
    for idx, row in df.iterrows():
        if pd.isna(row.iloc[0]) or row.iloc[0] == '':  # 빈 행 스킵
            continue
            
        company = {
            'Ticker': str(row.iloc[0]) if pd.notna(row.iloc[0]) else '',
            'corpName': str(row.iloc[1]) if pd.notna(row.iloc[1]) else '',
            'exchange': str(row.iloc[2]) if pd.notna(row.iloc[2]) else '',
            'industry': str(row.iloc[3]) if pd.notna(row.iloc[3]) else ''
        }
        
        # 나머지 컬럼들을 숫자 데이터로 처리
        for i, col_name in enumerate(df.columns[4:], 4):
            value = row.iloc[i]
            if pd.isna(value) or value == '' or value == 'N/A':
                company[col_name] = None
            else:
                try:
                    num_value = float(value)
                    # NaN, Infinity 체크
                    if np.isnan(num_value) or np.isinf(num_value):
                        company[col_name] = None
                    else:
                        company[col_name] = num_value
                except (ValueError, TypeError):
                    company[col_name] = str(value) if str(value) != 'nan' else None
        
        # 검색 인덱스 추가
        company['searchIndex'] = f"{company['Ticker']} {company['corpName']}".lower()
        
        enhanced_data.append(company)
    
    print(f"✅ {len(enhanced_data)}개 기업 데이터 생성")
    return enhanced_data

def save_data(data):
    """데이터 저장"""
    print("\\n💾 데이터 저장 중...")
    
    # 디렉토리 생성
    Path(OUTPUT_DIR).mkdir(exist_ok=True)
    
    # 메타데이터 생성
    metadata = {
        'version': '2.0',
        'generated_at': pd.Timestamp.now().isoformat(),
        'total_companies': len(data),
        'description': 'Global_Scouter 실제 데이터 추출'
    }
    
    # 최종 데이터 구조
    final_data = {
        'metadata': metadata,
        'companies': data
    }
    
    # JSON 파일 저장
    output_file = f"{OUTPUT_DIR}/enhanced_summary_data.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2, default=str)
    
    # 파일 크기 확인
    file_size = Path(output_file).stat().st_size
    print(f"✅ 저장 완료: {output_file}")
    print(f"📁 파일 크기: {file_size/1024/1024:.1f}MB")
    
    # 컬럼 설정 파일도 생성
    create_column_config(data[0] if data else {})
    
    return final_data

def create_column_config(sample_company):
    """컬럼 설정 파일 생성"""
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
            'industry': '업종'
        },
        'available_columns': list(sample_company.keys()) if sample_company else []
    }
    
    config_file = f"{OUTPUT_DIR}/column_config.json"
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 컬럼 설정 저장: {config_file}")

def main():
    print("🚀 올바른 데이터 추출 시작")
    print("=" * 50)
    
    # 1. 데이터 추출
    df = extract_correct_data()
    
    # 2. JSON 변환
    enhanced_data = create_enhanced_json(df)
    
    # 3. 저장
    final_data = save_data(enhanced_data)
    
    print("\\n✅ 모든 작업 완료!")
    print(f"📊 총 {len(enhanced_data)}개 기업")
    print("\\n📋 다음 단계:")
    print("   1. 웹 브라우저에서 테스트")
    print("   2. 데이터 구조 확인")

if __name__ == "__main__":
    main()