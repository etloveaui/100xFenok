#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""간단한 CSV to JSON 변환기"""

import pandas as pd
import json
import sys
import io
from pathlib import Path
from datetime import datetime

# UTF-8 출력 설정
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 경로 설정
input_csv = Path(r'C:\Users\etlov\agents-workspace\fenomeno_projects\Global_Scouter\Global_Scouter_20251003\M_Company.csv')
output_json = Path(r'C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer\data\enhanced_summary_data_full.json')

print('CSV 읽기 중...')
df = pd.read_csv(input_csv, encoding='utf-8')
print(f'원본: {len(df)}개 행')

# 헤더 정리 (2번째 행이 실제 헤더)
df.columns = df.iloc[1].values
df = df.iloc[2:].reset_index(drop=True)
print(f'헤더 정리 후: {len(df)}개 행')

# DataFrame to dict
print('딕셔너리 변환 중...')
data_dict = df.to_dict(orient='records')

# Ticker와 Corp 필드 이름 변경
print('필드명 정리 중...')
companies = []
for record in data_dict:
    company = {}
    for key, value in record.items():
        # NaN 처리
        if pd.isna(value):
            company[key] = None
        # Infinity 처리
        elif isinstance(value, float) and (value == float('inf') or value == float('-inf')):
            company[key] = None
        else:
            company[key] = value

    # Ticker와 Corp 있는 경우만 추가
    if 'Ticker' in company and 'Corp' in company:
        if company['Ticker'] is not None and company['Corp'] is not None:
            # corpName 필드 추가
            company['corpName'] = company.get('Corp', '')
            companies.append(company)

print(f'변환 완료: {len(companies)}개 기업')

# JSON 저장
output_data = {
    'metadata': {
        'source': 'M_Company.csv',
        'generated_at': datetime.now().isoformat(),
        'total_companies': len(companies),
    },
    'companies': companies
}

print('JSON 저장 중...')
with open(output_json, 'w', encoding='utf-8') as f:
    json.dump(output_data, f, ensure_ascii=False, indent=2)

print(f'완료: {output_json}')
print(f'총 {len(companies)}개 기업 데이터')

# 샘플 출력
if len(companies) > 0:
    print('\\n첫 번째 기업:', companies[0].get('corpName'), companies[0].get('Ticker'))
