#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M_Company.csv를 enhanced_summary_data.json 형식으로 변환
6178개 기업 데이터를 Stock Analyzer가 사용할 수 있도록 변환
"""

import pandas as pd
import json
import sys
import io
from pathlib import Path
from datetime import datetime

# Windows 콘솔 UTF-8 출력 설정
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def convert_m_company_to_json():
    """M_Company.csv를 JSON으로 변환"""

    # 경로 설정
    base_dir = Path(__file__).parent.parent
    input_csv = Path(r'C:\Users\etlov\agents-workspace\fenomeno_projects\Global_Scouter\Global_Scouter_20251003\M_Company.csv')
    output_json = base_dir / 'data' / 'enhanced_summary_data_full.json'
    backup_dir = base_dir / 'data' / 'backups'

    # 백업 디렉토리 생성
    backup_dir.mkdir(exist_ok=True)

    print(f'📂 입력 파일: {input_csv}')
    print(f'📂 출력 파일: {output_json}')

    # CSV 읽기
    print('\n📖 CSV 파일 읽기 중...')
    df = pd.read_csv(input_csv, encoding='utf-8')
    print(f'✅ 원본 데이터: {len(df)}개 행')

    # 헤더 행 찾기 (두 번째 행이 실제 헤더)
    if df.iloc[0].isna().all() or 'Corp' in str(df.iloc[1].values):
        print('🔍 헤더 행 감지: 2번째 행')
        # 2번째 행을 헤더로 사용
        df.columns = df.iloc[1].values
        df = df.iloc[2:].reset_index(drop=True)

    print(f'✅ 헤더 정리 후: {len(df)}개 행')
    print(f'📊 컬럼: {list(df.columns[:10])}...')

    # 필수 컬럼 매핑
    column_mapping = {
        'Ticker': 'Ticker',
        'Corp': 'corpName',
        'Exchange': 'exchange',
        'WI26': 'industry',
        'Price': 'Price (Oct-25)',
        'Market Cap\n(USD mn)': '(USD mn)',
        'ROE (Fwd)': 'ROE (Fwd)',
        'OPM (Fwd)': 'OPM (Fwd)',
        'PER (Fwd)': 'PER (Oct-25)',
        'PBR (Fwd)': 'PBR (Oct-25)',
    }

    # 데이터 변환
    print('\n🔄 데이터 변환 중...')
    companies = []
    skipped = 0

    for idx, row in df.iterrows():
        try:
            # 필수 필드 확인
            ticker = row['Ticker'] if 'Ticker' in row.index else None
            corp_name = row['Corp'] if 'Corp' in row.index else None

            # 유효성 검사 - 개별 조건으로 체크
            if ticker is None or corp_name is None:
                skipped += 1
                continue

            if pd.isna(ticker) or pd.isna(corp_name):
                skipped += 1
                continue

            if str(ticker).strip() == '' or str(corp_name).strip() == '':
                skipped += 1
                continue

            # 회사 데이터 생성
            company = {
                'Ticker': str(ticker).strip(),
                'corpName': str(corp_name).strip(),
            }

            # Exchange와 industry 추가
            if 'Exchange' in row.index:
                exchange_val = row['Exchange']
                company['exchange'] = str(exchange_val).strip() if pd.notna(exchange_val) else ''
            else:
                company['exchange'] = ''

            if 'WI26' in row.index:
                industry_val = row['WI26']
                company['industry'] = str(industry_val).strip() if pd.notna(industry_val) else ''
            else:
                company['industry'] = ''

            # 모든 컬럼 추가 (NaN 처리)
            for col in df.columns:
                if col not in ['Ticker', 'Corp', 'Exchange', 'WI26']:
                    if col in row.index:
                        value = row[col]

                        # NaN, Infinity 처리
                        if pd.isna(value):
                            company[col] = None
                        elif isinstance(value, (int, float)):
                            if pd.isinf(value):
                                company[col] = None
                            else:
                                company[col] = float(value) if not isinstance(value, int) else int(value)
                        else:
                            company[col] = str(value).strip()

            companies.append(company)

        except Exception as e:
            print(f'WARNING: Row {idx} error: {e}')
            skipped += 1
            continue

    print(f'✅ 변환 완료: {len(companies)}개 기업')
    print(f'⚠️ 스킵: {skipped}개 기업 (Ticker 또는 corpName 누락)')

    # 기존 파일 백업
    if output_json.exists():
        timestamp = datetime.now().strftime('%Y%m%dT%H%M%SZ')
        backup_file = backup_dir / f'enhanced_summary_data_{timestamp}.json'
        print(f'\n💾 기존 파일 백업: {backup_file.name}')
        output_json.rename(backup_file)

    # JSON 저장
    print(f'\n💾 JSON 파일 저장 중...')
    output_data = {
        'metadata': {
            'source': 'M_Company.csv',
            'generated_at': datetime.now().isoformat(),
            'total_companies': len(companies),
            'conversion_script': 'convert_m_company_to_json.py'
        },
        'companies': companies
    }

    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f'✅ 저장 완료: {output_json}')
    print(f'\n📊 최종 통계:')
    print(f'  - 원본 CSV: {len(df)}개 행')
    print(f'  - 변환 성공: {len(companies)}개 기업')
    print(f'  - 스킵: {skipped}개')
    print(f'  - 성공률: {len(companies) / len(df) * 100:.1f}%')

    # 샘플 데이터 출력
    print(f'\n🔍 샘플 데이터 (첫 3개):')
    for i, company in enumerate(companies[:3], 1):
        print(f'\n{i}. {company["corpName"]} ({company["Ticker"]})')
        print(f'   Exchange: {company.get("exchange")}')
        print(f'   Industry: {company.get("industry")}')
        print(f'   ROE (Fwd): {company.get("ROE (Fwd)")}')
        print(f'   OPM (Fwd): {company.get("OPM (Fwd)")}')

    return len(companies)

if __name__ == '__main__':
    try:
        total = convert_m_company_to_json()
        print(f'\n✅ 변환 완료: {total}개 기업 데이터 생성')
        sys.exit(0)
    except Exception as e:
        print(f'\n❌ 오류 발생: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
