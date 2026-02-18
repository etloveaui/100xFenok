#!/usr/bin/env python3
"""
올바른 컬럼 구조로 데이터 재생성
중복 컬럼, 빈 헤더, 날짜 컬럼 제외하고 의미있는 26개 지표만 추출
"""

import pandas as pd
import json
import numpy as np

def analyze_and_clean_data():
    """CSV 데이터 분석 및 정제"""
    print("🔍 CSV 데이터 정확한 분석 중...")
    
    csv_file = "../../../../fenomeno_projects/Global_Scouter/Global_Scouter_20251003/A_Company.csv"
    df_raw = pd.read_csv(csv_file, encoding='utf-8')
    
    # 헤더와 데이터 분리
    headers = df_raw.iloc[1].tolist()[1:]  # 첫 번째 빈 컬럼 제외
    data_rows = df_raw.iloc[2:].copy()
    data_rows = data_rows.iloc[:, 1:]  # 첫 번째 빈 컬럼 제거
    data_rows.columns = headers[:len(data_rows.columns)]
    
    print(f"원본 데이터: {data_rows.shape}")
    
    # 유효한 컬럼만 선별
    valid_columns = []
    excluded_columns = []
    
    for i, col in enumerate(headers):
        # 제외할 컬럼들
        if pd.isna(col):  # nan 헤더
            excluded_columns.append(f"Index {i+1}: nan (빈 헤더)")
        elif str(col).isdigit() or (isinstance(col, (int, float)) and col > 40000):  # 날짜 컬럼들
            excluded_columns.append(f"Index {i+1}: {col} (날짜 데이터)")
        elif i >= 32 and col in ['W', '1 M', '3 M', '6 M', 'YTD', '12 M']:  # 중복 수익률 컬럼
            excluded_columns.append(f"Index {i+1}: {col} (중복 수익률)")
        else:
            valid_columns.append(col)
    
    print(f"\\n✅ 유효한 컬럼: {len(valid_columns)}개")
    print(f"❌ 제외된 컬럼: {len(excluded_columns)}개")
    
    print("\\n=== 제외된 컬럼들 ===")
    for exc in excluded_columns:
        print(f"  {exc}")
    
    print("\\n=== 유효한 컬럼들 ===")
    for i, col in enumerate(valid_columns):
        print(f"{i+1:2d}. {col}")
    
    # 유효한 컬럼만으로 데이터 재구성
    clean_data = data_rows[valid_columns].copy()
    
    return clean_data, valid_columns

def create_clean_companies_data(df, valid_columns):
    """깨끗한 기업 데이터 생성"""
    print("\\n🔧 깨끗한 기업 데이터 생성 중...")
    
    companies = []
    
    for idx, row in df.iterrows():
        ticker = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''
        if not ticker or ticker == 'nan':
            continue
            
        company = {}
        
        # 모든 유효한 컬럼 처리
        for i, col_name in enumerate(valid_columns):
            if i < len(row):
                value = row.iloc[i]
                
                # 기본 정보는 문자열로
                if col_name in ['Ticker', 'Corp', 'Exchange', 'WI26']:
                    if col_name == 'Corp':
                        company['corpName'] = str(value).strip() if pd.notna(value) else ''
                    elif col_name == 'WI26':
                        company['industry'] = str(value).strip() if pd.notna(value) else ''
                    else:
                        company[col_name] = str(value).strip() if pd.notna(value) else ''
                else:
                    # 숫자 데이터 처리
                    clean_value = None
                    if pd.notna(value):
                        try:
                            if isinstance(value, str):
                                value = value.strip()
                                if value and value.lower() not in ['nan', 'inf', '-inf', 'null', '']:
                                    clean_value = float(value)
                            else:
                                float_val = float(value)
                                if not (np.isnan(float_val) or np.isinf(float_val)):
                                    clean_value = float_val
                        except (ValueError, TypeError, OverflowError):
                            clean_value = None
                    
                    company[col_name] = clean_value
        
        # 검색 인덱스
        company['searchIndex'] = f"{company.get('Ticker', '')} {company.get('corpName', '')}".lower()
        
        companies.append(company)
    
    print(f"✅ {len(companies)}개 기업 데이터 생성")
    return companies

def save_proper_json(companies, valid_columns):
    """올바른 JSON 저장"""
    print("\\n💾 올바른 JSON 저장 중...")
    
    # 메타데이터
    metadata = {
        'version': '2.3',
        'generated_at': pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_companies': len(companies),
        'total_columns': len(valid_columns),
        'valid_columns': valid_columns,
        'description': 'Properly cleaned data with meaningful columns only'
    }
    
    # 최종 데이터
    final_data = {
        'metadata': metadata,
        'companies': companies
    }
    
    # JSON 저장
    json_str = json.dumps(final_data, ensure_ascii=False, indent=2, default=str)
    json_str = json_str.replace(': NaN,', ': null,')
    json_str = json_str.replace(': NaN}', ': null}')
    json_str = json_str.replace('NaN', 'null')
    
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
        print(f"📈 유효한 컬럼 수: {len(valid_columns)}")
        return True
    except Exception as e:
        print(f"❌ JSON 검증 실패: {e}")
        return False

def main():
    print("🚀 올바른 데이터 구조로 재생성")
    print("=" * 50)
    
    # 1. 데이터 분석 및 정제
    clean_df, valid_columns = analyze_and_clean_data()
    
    # 2. 기업 데이터 생성
    companies = create_clean_companies_data(clean_df, valid_columns)
    
    # 3. JSON 저장
    success = save_proper_json(companies, valid_columns)
    
    if success:
        print("\\n🎉 성공!")
        print(f"✅ 의미있는 {len(valid_columns)}개 컬럼만 추출")
        print("✅ 중복/빈/날짜 컬럼 제거")
        print("✅ JSON 파싱 가능")
        print("\\n🔄 이제 웹에서 올바른 컬럼들을 볼 수 있습니다!")
    else:
        print("\\n❌ 실패")

if __name__ == "__main__":
    main()