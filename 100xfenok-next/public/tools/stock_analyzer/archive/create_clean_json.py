#!/usr/bin/env python3
"""
완전히 깨끗한 JSON 데이터 생성
"""

import pandas as pd
import json
import numpy as np

def create_clean_data():
    """깨끗한 데이터 생성"""
    print("🔧 깨끗한 데이터 생성 중...")
    
    # CSV 파일 읽기
    csv_file = "../../../../fenomeno_projects/Global_Scouter/Global_Scouter_20251003/A_Company.csv"
    df_raw = pd.read_csv(csv_file, encoding='utf-8')
    
    # 헤더와 데이터 분리
    headers = df_raw.iloc[1].tolist()[1:]  # 첫 번째 빈 컬럼 제외
    data_rows = df_raw.iloc[2:].copy()
    data_rows = data_rows.iloc[:, 1:]  # 첫 번째 빈 컬럼 제거
    data_rows.columns = headers[:len(data_rows.columns)]
    
    companies = []
    
    for idx, row in data_rows.iterrows():
        ticker = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''
        if not ticker or ticker == 'nan':
            continue
            
        company = {
            'Ticker': ticker,
            'corpName': str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else '',
            'exchange': str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else '',
            'industry': str(row.iloc[3]).strip() if pd.notna(row.iloc[3]) else ''
        }
        
        # 숫자 컬럼들 처리 (안전하게)
        for i, col_name in enumerate(data_rows.columns[4:], 4):
            if i < len(row):
                value = row.iloc[i]
                
                # None으로 초기화
                clean_value = None
                
                if pd.notna(value):
                    try:
                        # 문자열인 경우
                        if isinstance(value, str):
                            value = value.strip()
                            if value and value.lower() not in ['nan', 'inf', '-inf', 'null', '']:
                                clean_value = float(value)
                        else:
                            # 숫자인 경우
                            float_val = float(value)
                            if not (np.isnan(float_val) or np.isinf(float_val)):
                                clean_value = float_val
                    except (ValueError, TypeError, OverflowError):
                        clean_value = None
                
                company[col_name] = clean_value
        
        # 검색 인덱스
        company['searchIndex'] = f"{company['Ticker']} {company['corpName']}".lower()
        
        companies.append(company)
    
    print(f"✅ {len(companies)}개 기업 데이터 생성")
    return companies

def save_json_safely(companies):
    """안전하게 JSON 저장"""
    print("💾 JSON 저장 중...")
    
    # 메타데이터
    metadata = {
        'version': '2.2',
        'generated_at': pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_companies': len(companies),
        'description': 'Clean data without NaN values'
    }
    
    # 최종 데이터
    final_data = {
        'metadata': metadata,
        'companies': companies
    }
    
    # JSON 문자열로 변환 (NaN 처리)
    json_str = json.dumps(final_data, ensure_ascii=False, indent=2, default=str)
    
    # NaN 문자열 제거 (혹시 남아있을 경우)
    json_str = json_str.replace(': NaN,', ': null,')
    json_str = json_str.replace(': NaN}', ': null}')
    json_str = json_str.replace(': NaN]', ': null]')
    json_str = json_str.replace('NaN', 'null')
    
    # 파일 저장
    output_file = "./data/enhanced_summary_data.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(json_str)
    
    print(f"✅ 저장 완료: {output_file}")
    
    # 검증
    try:
        with open(output_file, 'r', encoding='utf-8') as f:
            test_data = json.load(f)
        print("✅ JSON 유효성 검증 통과")
        print(f"📊 로드된 기업 수: {len(test_data['companies'])}")
        return True
    except Exception as e:
        print(f"❌ JSON 검증 실패: {e}")
        return False

def main():
    print("🚀 완전히 깨끗한 JSON 생성")
    print("=" * 40)
    
    # 1. 깨끗한 데이터 생성
    companies = create_clean_data()
    
    # 2. 안전하게 JSON 저장
    success = save_json_safely(companies)
    
    if success:
        print("\\n🎉 성공!")
        print("✅ NaN 값 완전 제거")
        print("✅ JSON 파싱 가능")
        print("\\n🔄 이제 웹 브라우저를 새로고침하세요!")
    else:
        print("\\n❌ 실패")

if __name__ == "__main__":
    main()