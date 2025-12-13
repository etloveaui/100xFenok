#!/usr/bin/env python3
"""
100xFenok Benchmarks 밸류에이션 데이터 품질 검증 스크립트
"""
import json
import os
from datetime import datetime
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any

# 데이터 경로
DATA_DIR = Path("source/100xFenok/data/benchmarks")
FILES = ["us.json", "us_sectors.json", "micro_sectors.json", "developed.json", "emerging.json", "msci.json"]
REQUIRED_FIELDS = ["date", "px_last", "best_eps", "best_pe_ratio", "px_to_book_ratio", "roe"]

class DataValidator:
    def __init__(self):
        self.results = defaultdict(dict)
        self.issues = defaultdict(list)
        
    def load_file(self, filename: str) -> Dict:
        """JSON 파일 로드"""
        path = DATA_DIR / filename
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def validate_structure(self, filename: str, data: Dict) -> Dict:
        """기본 구조 검증"""
        issues = []
        
        # metadata 체크
        if 'metadata' not in data:
            issues.append("❌ metadata 필드 누락")
        else:
            meta = data['metadata']
            required_meta = ['version', 'generated', 'source', 'update_frequency']
            for field in required_meta:
                if field not in meta:
                    issues.append(f"❌ metadata.{field} 누락")
        
        # sections 체크
        if 'sections' not in data:
            issues.append("❌ sections 필드 누락")
            return {'valid': False, 'issues': issues}
        
        sections = data['sections']
        section_count = len(sections)
        
        return {
            'valid': len(issues) == 0,
            'section_count': section_count,
            'sections': list(sections.keys()),
            'issues': issues
        }
    
    def validate_fields(self, filename: str, data: Dict) -> Dict:
        """필드 완결성 검증"""
        field_stats = defaultdict(lambda: {'missing': 0, 'null': 0, 'total': 0})
        
        for section_key, section in data['sections'].items():
            if 'data' not in section:
                self.issues[filename].append(f"⚠️ {section_key}: data 배열 누락")
                continue
            
            for i, record in enumerate(section['data']):
                for field in REQUIRED_FIELDS:
                    field_stats[field]['total'] += 1
                    
                    if field not in record:
                        field_stats[field]['missing'] += 1
                    elif record[field] is None:
                        field_stats[field]['null'] += 1
        
        return dict(field_stats)
    
    def validate_data_quality(self, filename: str, data: Dict) -> Dict:
        """데이터 품질 검증 (이상값, 음수 등)"""
        anomalies = defaultdict(list)
        
        for section_key, section in data['sections'].items():
            if 'data' not in section:
                continue
            
            for i, record in enumerate(section['data']):
                date_str = record.get('date', 'unknown')
                
                # px_last 음수 체크
                px_last = record.get('px_last')
                if px_last is not None and px_last <= 0:
                    anomalies['negative_price'].append(f"{section_key}[{date_str}]: px_last={px_last}")
                
                # best_pe_ratio 음수 또는 극단값
                pe = record.get('best_pe_ratio')
                if pe is not None:
                    if pe < 0:
                        anomalies['negative_pe'].append(f"{section_key}[{date_str}]: PE={pe}")
                    elif pe > 1000:
                        anomalies['extreme_pe'].append(f"{section_key}[{date_str}]: PE={pe}")
                
                # px_to_book_ratio 음수 또는 극단값
                pb = record.get('px_to_book_ratio')
                if pb is not None:
                    if pb < 0:
                        anomalies['negative_pb'].append(f"{section_key}[{date_str}]: PB={pb}")
                    elif pb > 100:
                        anomalies['extreme_pb'].append(f"{section_key}[{date_str}]: PB={pb}")
                
                # roe 범위 체크 (일반적으로 -1 ~ 1)
                roe = record.get('roe')
                if roe is not None:
                    if roe < -1 or roe > 1:
                        anomalies['roe_out_of_range'].append(f"{section_key}[{date_str}]: ROE={roe}")
        
        return dict(anomalies)
    
    def validate_date_range(self, filename: str, data: Dict) -> Dict:
        """날짜 범위 및 빈도 검증"""
        date_info = {}
        
        for section_key, section in data['sections'].items():
            if 'data' not in section or len(section['data']) == 0:
                continue
            
            dates = [record['date'] for record in section['data'] if 'date' in record]
            if not dates:
                continue
            
            dates_sorted = sorted(dates)
            
            # 날짜 간격 계산 (주간 데이터 가정: 7일)
            gaps = []
            for i in range(1, len(dates_sorted)):
                d1 = datetime.fromisoformat(dates_sorted[i-1])
                d2 = datetime.fromisoformat(dates_sorted[i])
                gap_days = (d2 - d1).days
                if gap_days > 14:  # 2주 이상 간격
                    gaps.append(f"{dates_sorted[i-1]} → {dates_sorted[i]} ({gap_days}일)")
            
            date_info[section_key] = {
                'start': dates_sorted[0],
                'end': dates_sorted[-1],
                'count': len(dates),
                'large_gaps': gaps[:5] if gaps else []  # 상위 5개만
            }
        
        return date_info
    
    def cross_file_consistency(self, all_data: Dict[str, Dict]) -> Dict:
        """크로스 파일 일관성 검사"""
        consistency_issues = []
        
        # 날짜 범위 일관성
        date_ranges = {}
        for filename, data in all_data.items():
            for section_key, section in data['sections'].items():
                if 'data' in section and section['data']:
                    dates = [r['date'] for r in section['data'] if 'date' in r]
                    if dates:
                        date_ranges[f"{filename}:{section_key}"] = (min(dates), max(dates))
        
        # 전체 날짜 범위
        all_starts = [r[0] for r in date_ranges.values()]
        all_ends = [r[1] for r in date_ranges.values()]
        
        global_start = min(all_starts) if all_starts else None
        global_end = max(all_ends) if all_ends else None
        
        # 범위 차이가 큰 경우
        for key, (start, end) in date_ranges.items():
            if global_start and start > global_start:
                start_diff = (datetime.fromisoformat(start) - datetime.fromisoformat(global_start)).days
                if start_diff > 365:  # 1년 이상 차이
                    consistency_issues.append(f"⚠️ {key}: 시작일이 전체보다 {start_diff}일 늦음")
            
            if global_end and end < global_end:
                end_diff = (datetime.fromisoformat(global_end) - datetime.fromisoformat(end)).days
                if end_diff > 30:  # 1개월 이상 차이
                    consistency_issues.append(f"⚠️ {key}: 종료일이 전체보다 {end_diff}일 이름")
        
        return {
            'global_range': (global_start, global_end),
            'section_count': len(date_ranges),
            'issues': consistency_issues[:10]  # 상위 10개만
        }

def main():
    print("=" * 80)
    print("100xFenok Benchmarks 밸류에이션 데이터 품질 검증")
    print("=" * 80)
    print()
    
    validator = DataValidator()
    all_data = {}
    
    # 1. 파일별 검증
    for filename in FILES:
        print(f"\n📁 {filename}")
        print("-" * 80)
        
        try:
            data = validator.load_file(filename)
            all_data[filename] = data
            
            # 구조 검증
            struct_result = validator.validate_structure(filename, data)
            print(f"✅ 구조: {struct_result['section_count']}개 섹션")
            if struct_result['issues']:
                for issue in struct_result['issues']:
                    print(f"  {issue}")
            
            # 필드 검증
            field_result = validator.validate_fields(filename, data)
            print(f"\n📊 필드 통계:")
            for field, stats in field_result.items():
                missing_pct = (stats['missing'] / stats['total'] * 100) if stats['total'] > 0 else 0
                null_pct = (stats['null'] / stats['total'] * 100) if stats['total'] > 0 else 0
                print(f"  - {field}: 전체={stats['total']:,}, 누락={stats['missing']} ({missing_pct:.2f}%), null={stats['null']} ({null_pct:.2f}%)")
            
            # 데이터 품질
            quality_result = validator.validate_data_quality(filename, data)
            if quality_result:
                print(f"\n⚠️ 이상값 탐지:")
                for anomaly_type, cases in quality_result.items():
                    print(f"  - {anomaly_type}: {len(cases)}건")
                    for case in cases[:3]:  # 상위 3개만
                        print(f"    · {case}")
            
            # 날짜 범위
            date_result = validator.validate_date_range(filename, data)
            print(f"\n📅 날짜 범위:")
            for section_key, info in list(date_result.items())[:3]:  # 상위 3개만
                print(f"  - {section_key}: {info['start']} ~ {info['end']} ({info['count']}포인트)")
                if info['large_gaps']:
                    print(f"    ⚠️ 큰 간격: {len(info['large_gaps'])}건")
                    
        except Exception as e:
            print(f"❌ 오류: {e}")
    
    # 2. 크로스 파일 일관성
    print("\n\n" + "=" * 80)
    print("크로스 파일 일관성 검증")
    print("=" * 80)
    
    consistency = validator.cross_file_consistency(all_data)
    print(f"\n전체 날짜 범위: {consistency['global_range'][0]} ~ {consistency['global_range'][1]}")
    print(f"전체 섹션 수: {consistency['section_count']}")
    
    if consistency['issues']:
        print(f"\n⚠️ 일관성 이슈 ({len(consistency['issues'])}건):")
        for issue in consistency['issues']:
            print(f"  {issue}")
    
    print("\n\n검증 완료!")

if __name__ == "__main__":
    main()
