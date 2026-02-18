#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simplified xlsb validation - writes directly to markdown report
"""

import os
from pathlib import Path
from datetime import datetime
import pyxlsb
from collections import defaultdict

# Configuration
XLSB_DIR = Path("data/xlsb")
WEEKS = ["20250912", "20250919", "20250926", "20251003", "20251010"]
KEY_SHEETS = ["M_Company", "A_Company", "T_EPS_C"]

def main():
    report = []
    report.append("# xlsb → CSV 변환 검증 보고서\n")
    report.append(f"**검증일**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    report.append(f"**대상**: 5개 주차 xlsb 파일 (20250912~20251010)\n")
    report.append(f"**목적**: Phase 0 Task 0.2 - 변환 파이프라인 검증\n\n")
    report.append("---\n\n")

    # Part 1: File Inspection
    report.append("## Part 1: 파일 검사 결과\n\n")
    report.append("### 파일 존재 및 크기\n")
    report.append("| 주차 | 파일명 | 크기 | 상태 |\n")
    report.append("|------|--------|------|------|\n")

    file_results = {}
    for week in WEEKS:
        filepath = XLSB_DIR / f"Global_Scouter_{week}.xlsb"
        if filepath.exists():
            size_mb = filepath.stat().st_size / (1024 * 1024)
            status = "OK" if 80 <= size_mb <= 90 else "Size unusual"
            file_results[week] = (size_mb, status)
            report.append(f"| {week} | Global_Scouter_{week}.xlsb | {size_mb:.2f} MB | {status} |\n")
        else:
            file_results[week] = (0, "Not found")
            report.append(f"| {week} | Global_Scouter_{week}.xlsb | - | Not found |\n")

    report.append("\n### xlsb 읽기 테스트\n")
    can_read_all = True
    for week in WEEKS:
        filepath = XLSB_DIR / f"Global_Scouter_{week}.xlsb"
        try:
            with pyxlsb.open_workbook(str(filepath)) as wb:
                sheets = wb.sheets
                report.append(f"- Week {week}: SUCCESS (시트 수: {len(sheets)})\n")
        except Exception as e:
            report.append(f"- Week {week}: FAILED - {str(e)}\n")
            can_read_all = False

    report.append("\n---\n\n")

    # Part 2: Sheet List Comparison
    report.append("## Part 2: 시트 목록 비교 (5개 주차)\n\n")

    sheet_lists = {}
    for week in WEEKS:
        filepath = XLSB_DIR / f"Global_Scouter_{week}.xlsb"
        try:
            with pyxlsb.open_workbook(str(filepath)) as wb:
                sheets = wb.sheets
                sheet_lists[week] = sheets
                report.append(f"### Week {week}\n")
                report.append(f"- 시트 수: {len(sheets)}\n")
                report.append(f"- 시트 목록: {', '.join(sheets[:10])}{'...' if len(sheets) > 10 else ''}\n\n")
        except Exception as e:
            sheet_lists[week] = []
            report.append(f"### Week {week}\n")
            report.append(f"- ERROR: {str(e)}\n\n")

    report.append("### 일관성 검증\n")
    if len(sheet_lists[WEEKS[0]]) > 0:
        first_week_sheets = set(sheet_lists[WEEKS[0]])
        all_consistent = True
        for week in WEEKS[1:]:
            week_sheets = set(sheet_lists[week])
            if week_sheets != first_week_sheets:
                all_consistent = False
                added = week_sheets - first_week_sheets
                removed = first_week_sheets - week_sheets
                report.append(f"- Week {week} differs from {WEEKS[0]}:\n")
                if added:
                    report.append(f"  - Added: {', '.join(added)}\n")
                if removed:
                    report.append(f"  - Removed: {', '.join(removed)}\n")

        if all_consistent:
            report.append("- ALL CONSISTENT: 모든 주차 동일한 시트 구조\n")
    else:
        report.append("- ERROR: 첫 주차 시트 목록 읽기 실패\n")

    report.append("\n---\n\n")

    # Part 3: Record and Field Validation
    report.append("## Part 3: 레코드/필드 검증 (주요 시트 기준)\n\n")
    report.append("### 레코드 수 추세\n")
    report.append("| 주차 | M_Company | A_Company | T_EPS_C |\n")
    report.append("|------|-----------|-----------|----------|\n")

    record_counts = defaultdict(dict)
    field_info = defaultdict(dict)

    for week in WEEKS:
        row_data = [week]
        filepath = XLSB_DIR / f"Global_Scouter_{week}.xlsb"

        for sheet in KEY_SHEETS:
            try:
                with pyxlsb.open_workbook(str(filepath)) as wb:
                    with wb.get_sheet(sheet) as ws:
                        rows = list(ws.rows())
                        if len(rows) >= 2:
                            header = [cell.v if cell else "" for cell in rows[0]]
                            record_count = len(rows) - 1
                            record_counts[sheet][week] = record_count
                            field_info[week][sheet] = header
                            row_data.append(f"{record_count:,}")
                        else:
                            row_data.append("N/A")
            except Exception as e:
                row_data.append(f"ERROR")

        report.append(f"| {' | '.join(row_data)} |\n")

    report.append("\n### 필드명 비교\n")
    for sheet in KEY_SHEETS:
        report.append(f"\n#### {sheet}\n")
        if WEEKS[0] in field_info and sheet in field_info[WEEKS[0]]:
            first_fields = field_info[WEEKS[0]][sheet]
            report.append(f"- 필드 수 (Week {WEEKS[0]}): {len(first_fields)}\n")
            # Filter out None values for display
            field_sample = [str(f) if f else "" for f in first_fields[:5]]
            report.append(f"- 샘플 필드: {', '.join(field_sample)}...\n")

            field_consistent = True
            for week in WEEKS[1:]:
                if week in field_info and sheet in field_info[week]:
                    week_fields = field_info[week][sheet]
                    if week_fields != first_fields:
                        field_consistent = False
                        report.append(f"- Week {week}: 필드 구조 다름 (필드 수: {len(week_fields)})\n")

            if field_consistent:
                report.append(f"- CONSISTENT: 모든 주차 동일한 필드 구조\n")
        else:
            report.append(f"- ERROR: 첫 주차 필드 정보 없음\n")

    report.append("\n---\n\n")

    # Part 4: Encoding Test
    report.append("## Part 4: 인코딩 및 포맷 검증\n\n")
    report.append("### 한글 처리 (M_Company 샘플)\n")

    for week in [WEEKS[0], WEEKS[-1]]:
        report.append(f"\n#### Week {week}\n")
        filepath = XLSB_DIR / f"Global_Scouter_{week}.xlsb"
        try:
            with pyxlsb.open_workbook(str(filepath)) as wb:
                with wb.get_sheet("M_Company") as ws:
                    rows = list(ws.rows())
                    if len(rows) >= 4:
                        header = [cell.v if cell else "" for cell in rows[0]]
                        for i in range(1, min(4, len(rows))):
                            record = {header[j]: (cell.v if cell else "") for j, cell in enumerate(rows[i])}
                            # Find a field with text
                            for key, value in record.items():
                                if value and isinstance(value, str) and len(value) > 0:
                                    has_korean = any('\uac00' <= c <= '\ud7a3' for c in value)
                                    status = "Korean OK" if has_korean else "No Korean"
                                    report.append(f"- Record {i}: {key} = '{value[:30]}...' ({status})\n")
                                    break
        except Exception as e:
            report.append(f"- ERROR: {str(e)}\n")

    report.append("\n---\n\n")

    # Part 5: Issues Summary
    report.append("## Part 5: 발견된 문제점\n\n")
    report.append("### Critical Issues\n")

    critical_issues = []
    for week in WEEKS:
        size_mb, status = file_results.get(week, (0, "Unknown"))
        if status != "OK":
            critical_issues.append(f"Week {week}: {status}")

    if critical_issues:
        for issue in critical_issues:
            report.append(f"1. {issue}\n")
    else:
        report.append("- None detected\n")

    report.append("\n### Medium Issues\n")
    medium_issues = []

    # Check record count variations
    for sheet in KEY_SHEETS:
        counts = [record_counts[sheet].get(week, 0) for week in WEEKS if week in record_counts[sheet]]
        if len(counts) > 0:
            avg_count = sum(counts) / len(counts)
            for week in WEEKS:
                if week in record_counts[sheet]:
                    deviation = abs(record_counts[sheet][week] - avg_count) / avg_count if avg_count > 0 else 0
                    if deviation > 0.1:
                        medium_issues.append(
                            f"{sheet} Week {week}: Record count {record_counts[sheet][week]} "
                            f"deviates {deviation*100:.1f}% from average"
                        )

    if medium_issues:
        for issue in medium_issues:
            report.append(f"1. {issue}\n")
    else:
        report.append("- None detected\n")

    report.append("\n---\n\n")

    # Part 6: Recommendations
    report.append("## Part 6: 권장 사항\n\n")
    report.append("### 변환 스크립트 개선 필요 사항\n")
    report.append("1. 시트 수 자동 검증 (예상: 22-23개)\n")
    report.append("2. 레코드 수 범위 체크 (M_Company: 5,500-6,500)\n")
    report.append("3. 필드명 일치 검증 자동화\n")
    report.append("4. 한글 인코딩 자동 검증\n")
    report.append("5. 날짜 포맷 표준화\n\n")

    report.append("### 검증 자동화 필요\n")
    report.append("- 주차별 자동 검증 파이프라인\n")
    report.append("- 필드 구조 변경 알림\n")
    report.append("- 레코드 수 추세 모니터링\n\n")

    report.append("---\n\n")

    # Conclusion
    report.append("## 결론\n\n")

    total_issues = len(critical_issues) + len(medium_issues)
    if total_issues == 0:
        verdict = "VALIDATION PASSED"
    elif len(critical_issues) > 0:
        verdict = "VALIDATION FAILED - Critical issues detected"
    else:
        verdict = "VALIDATION PASSED WITH WARNINGS"

    report.append(f"**검증 결과**: {verdict}\n\n")
    report.append("**다음 단계**:\n")
    report.append("- Task 0.3: 변환 스크립트 개선\n")
    report.append("- Task 0.4: 자동 검증 파이프라인 구축\n")

    # Write report to file
    output_path = Path("CONVERSION_VALIDATION_REPORT.md")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(''.join(report))

    print(f"Report written to: {output_path.absolute()}")
    return output_path

if __name__ == "__main__":
    main()
