#!/usr/bin/env python3
"""
xlsb_to_csv_converter.py
Sprint 4 Phase 0 Task 0.3 - xlsb → CSV 변환 스크립트 (개선)

주요 기능:
1. 22개 메인 시트만 추출 (티커 시트 제외)
2. 시트명 정규화 (공백 → 언더스코어)
3. Header = Row 2 (Row 0-1 메타데이터)
4. 빈 행 제거
5. 검증 로직 내장

사용법:
    python xlsb_to_csv_converter.py data/xlsb/Global_Scouter_20251010.xlsb
    python xlsb_to_csv_converter.py data/xlsb/Global_Scouter_20251010.xlsb --output data/csv
"""

import sys
import os
from pathlib import Path
import pyxlsb
import pandas as pd
from datetime import datetime


# 20개 메인 시트 목록 (ReadMe 포함)
# 주의: T_EPS_H, T_Growth_H는 xlsb에 없음 (53 records 샘플 시트, 별도 파일)
MAIN_SHEETS = [
    # Master (2)
    'M_Company',
    'M_ETFs',

    # Technical (7) - 공백 주의!
    'T_CFO',
    'T_EPS C',        # 공백!
    'T_Growth C',     # 공백!
    'T_Rank',
    'T_Correlation',
    'T_Chart',
    'T_Chk',
    # 'T_EPS_H',      # xlsb에 없음 (53 records 샘플)
    # 'T_Growth_H',   # xlsb에 없음 (53 records 샘플)

    # Advanced (5)
    'A_Company',
    'A_Compare',
    'A_Contrast',
    'A_Distribution',
    'A_ETFs',

    # Screening (3)
    'S_Chart',
    'S_Mylist',
    'S_Valuation',

    # Economic (1)
    'E_Indicators',

    # Special (2)
    'ReadMe',
    'UP & Down',      # 공백!
]


def normalize_sheet_name(sheet_name):
    """
    시트명 정규화: 공백 → 언더스코어

    예: "T_EPS C" → "T_EPS_C"
    """
    return sheet_name.replace(' ', '_')


def convert_sheet_to_csv(xlsb_path, sheet_name, output_dir):
    """
    단일 시트를 CSV로 변환

    Args:
        xlsb_path: xlsb 파일 경로
        sheet_name: 시트 이름 (원본, 공백 포함 가능)
        output_dir: 출력 디렉터리

    Returns:
        dict: 변환 결과 정보 (성공 여부, 레코드 수, 필드 수)
    """
    result = {
        'sheet': sheet_name,
        'success': False,
        'records': 0,
        'fields': 0,
        'csv_path': None,
        'error': None
    }

    try:
        # 1. xlsb 파일 열기
        with pyxlsb.open_workbook(xlsb_path) as wb:
            # 2. 시트 읽기 (모든 행)
            with wb.get_sheet(sheet_name) as sheet:
                rows = []
                for row in sheet.rows():
                    rows.append([cell.v if cell else None for cell in row])

        # 3. DataFrame 생성
        if len(rows) < 3:
            result['error'] = f"Insufficient rows: {len(rows)}"
            return result

        # Row 0-1: 메타데이터 (보존하지 않음)
        # Row 2: 헤더
        # Row 3+: 데이터
        header = rows[2]
        data_rows = rows[3:]

        df = pd.DataFrame(data_rows, columns=header)

        # 4. 빈 행 제거 (모든 값이 None/NaN인 행)
        df = df.dropna(how='all')

        # 5. 빈 컬럼 제거 (컬럼명이 None인 경우)
        df = df.loc[:, df.columns.notna()]

        # 6. CSV 파일명 생성 (정규화)
        csv_name = normalize_sheet_name(sheet_name) + '.csv'
        csv_path = os.path.join(output_dir, csv_name)

        # 7. CSV 저장 (UTF-8, 인덱스 없음)
        df.to_csv(csv_path, index=False, encoding='utf-8')

        # 8. 결과 기록
        result['success'] = True
        result['records'] = len(df)
        result['fields'] = len(df.columns)
        result['csv_path'] = csv_path

        print(f"[OK] {sheet_name:20s} -> {csv_name:25s} ({result['records']:>5} records, {result['fields']:>2} fields)")

    except Exception as e:
        result['error'] = str(e)
        print(f"[FAIL] {sheet_name:20s} -> Failed: {e}")

    return result


def validate_results(results):
    """
    변환 결과 검증

    기대값:
    - M_Company: ~6,000 records, 33 fields
    - A_Company: ~1,250 records, 50 fields
    - T_EPS_C: ~1,250 records, 40 fields

    Returns:
        bool: 검증 통과 여부
    """
    print("\n" + "="*80)
    print("변환 결과 검증")
    print("="*80)

    validation_rules = {
        'M_Company': {'min_records': 5000, 'max_records': 7000, 'expected_fields': 33},
        'A_Company': {'min_records': 1000, 'max_records': 1500, 'expected_fields': 50},
        'T_EPS_C': {'min_records': 1000, 'max_records': 1500, 'expected_fields': 40},
        'T_Growth_C': {'min_records': 1000, 'max_records': 1500, 'expected_fields': 49},
        'T_Rank': {'min_records': 1000, 'max_records': 1500, 'expected_fields': 36},  # 실제 36
        'T_CFO': {'min_records': 1000, 'max_records': 1500, 'expected_fields': 35},   # 실제 35
        'T_Correlation': {'min_records': 1000, 'max_records': 1500, 'expected_fields': 21},  # 실제 21
    }

    all_passed = True

    for result in results:
        if not result['success']:
            print(f"[FAIL] {result['sheet']:20s} - 변환 실패: {result['error']}")
            all_passed = False
            continue

        sheet = result['sheet']
        normalized = normalize_sheet_name(sheet)

        if normalized in validation_rules:
            rule = validation_rules[normalized]
            records_ok = rule['min_records'] <= result['records'] <= rule['max_records']
            fields_ok = result['fields'] == rule['expected_fields']

            if records_ok and fields_ok:
                print(f"[PASS] {sheet:20s} - 검증 통과 ({result['records']} records, {result['fields']} fields)")
            else:
                print(f"[WARN] {sheet:20s} - 검증 실패:")
                if not records_ok:
                    print(f"   레코드: {result['records']} (기대: {rule['min_records']}-{rule['max_records']})")
                if not fields_ok:
                    print(f"   필드: {result['fields']} (기대: {rule['expected_fields']})")
                all_passed = False
        else:
            print(f"[INFO] {sheet:20s} - 검증 규칙 없음 ({result['records']} records, {result['fields']} fields)")

    return all_passed


def convert_xlsb_to_csv(xlsb_path, output_dir=None):
    """
    xlsb 파일의 22개 메인 시트를 CSV로 변환

    Args:
        xlsb_path: xlsb 파일 경로
        output_dir: 출력 디렉터리 (기본: xlsb와 같은 디렉터리)

    Returns:
        list: 변환 결과 리스트
    """
    xlsb_path = Path(xlsb_path)

    if not xlsb_path.exists():
        print(f"[ERROR] 파일 없음: {xlsb_path}")
        return []

    if output_dir is None:
        output_dir = xlsb_path.parent
    else:
        output_dir = Path(output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)

    print("="*80)
    print(f"xlsb → CSV 변환 시작")
    print("="*80)
    print(f"입력: {xlsb_path}")
    print(f"출력: {output_dir}")
    print(f"시트: {len(MAIN_SHEETS)}개")
    print("="*80)

    results = []

    for sheet_name in MAIN_SHEETS:
        result = convert_sheet_to_csv(xlsb_path, sheet_name, output_dir)
        results.append(result)

    # 검증
    validation_passed = validate_results(results)

    # 요약
    print("\n" + "="*80)
    print("변환 완료 요약")
    print("="*80)

    success_count = sum(1 for r in results if r['success'])
    total_records = sum(r['records'] for r in results if r['success'])

    print(f"[SUMMARY] 성공: {success_count}/{len(MAIN_SHEETS)} 시트")
    print(f"[SUMMARY] 총 레코드: {total_records:,}")
    print(f"[SUMMARY] 검증: {'통과' if validation_passed else '실패'}")
    print("="*80)

    return results


def main():
    """메인 함수"""
    if len(sys.argv) < 2:
        print("사용법: python xlsb_to_csv_converter.py <xlsb_file> [output_dir]")
        print("예시: python xlsb_to_csv_converter.py data/xlsb/Global_Scouter_20251010.xlsb")
        print("예시: python xlsb_to_csv_converter.py data/xlsb/Global_Scouter_20251010.xlsb data/csv")
        sys.exit(1)

    xlsb_file = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None

    results = convert_xlsb_to_csv(xlsb_file, output_dir)

    # 실패한 시트가 있으면 exit code 1
    if any(not r['success'] for r in results):
        sys.exit(1)


if __name__ == '__main__':
    main()
