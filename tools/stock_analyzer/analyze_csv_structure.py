#!/usr/bin/env python3
"""
Global_Scouter CSV 파일 구조 분석 도구
22개 CSV 파일의 구조, 컬럼, 데이터 타입을 분석하여 
웹 애플리케이션에서 활용할 수 있는 데이터 구조를 파악합니다.
"""

import pandas as pd
import os
import json
from pathlib import Path

# Global_Scouter CSV 파일 경로
CSV_DIR = Path(r"C:\Users\etlov\agents-workspace\fenomeno_projects\Global_Scouter\Global_Scouter_20251003")

def analyze_csv_files():
    """모든 CSV 파일을 분석하여 구조 정보를 추출합니다."""
    
    analysis_results = {}
    
    # CSV 파일 목록 가져오기
    print(f"🔍 CSV 디렉토리 경로: {CSV_DIR}")
    print(f"🔍 경로 존재 여부: {CSV_DIR.exists()}")
    
    if CSV_DIR.exists():
        csv_files = list(CSV_DIR.glob("*.csv"))
        print(f"🔍 찾은 파일들: {[f.name for f in csv_files]}")
    else:
        csv_files = []
    
    print(f"📊 총 {len(csv_files)}개 CSV 파일 분석 시작...")
    print("=" * 60)
    
    for csv_file in csv_files:
        print(f"\n🔍 분석 중: {csv_file.name}")
        
        try:
            # CSV 파일 읽기 (다중 헤더 구조 처리)
            try:
                # 먼저 헤더 구조 파악
                header_df = pd.read_csv(csv_file, encoding='utf-8', nrows=5)
                
                # 실제 데이터는 3행부터 시작 (0-based index로 2)
                df = pd.read_csv(csv_file, encoding='utf-8', header=[2])
                
                # 헤더 정보도 저장
                if len(header_df) >= 3:
                    category_headers = header_df.iloc[1].fillna('').tolist()
                    column_headers = header_df.iloc[2].fillna('').tolist()
                else:
                    category_headers = []
                    column_headers = list(df.columns)
                    
            except UnicodeDecodeError:
                df = pd.read_csv(csv_file, encoding='cp949', header=[2])
                category_headers = []
                column_headers = list(df.columns)
            except Exception as e:
                print(f"   ⚠️  헤더 파싱 실패, 기본 방식 사용: {e}")
                df = pd.read_csv(csv_file, encoding='utf-8')
                category_headers = []
                column_headers = list(df.columns)
            
            # 기본 정보
            file_info = {
                'filename': csv_file.name,
                'rows': len(df),
                'columns': len(df.columns),
                'column_names': column_headers,
                'category_headers': category_headers,
                'data_types': df.dtypes.astype(str).to_dict(),
                'sample_data': {},
                'key_columns': [],
                'numeric_columns': [],
                'categorical_columns': [],
                'financial_indicators': []
            }
            
            # 샘플 데이터 (첫 3행)
            for col in df.columns[:10]:  # 처음 10개 컬럼만
                sample_values = df[col].head(3).fillna('NULL').tolist()
                file_info['sample_data'][col] = sample_values
            
            # 컬럼 분류 (실제 컬럼명 사용)
            for i, col in enumerate(column_headers):
                col_lower = str(col).lower()
                
                # 키 컬럼 식별
                if any(keyword in col_lower for keyword in ['ticker', 'corp', 'symbol', 'company']):
                    file_info['key_columns'].append(col)
                
                # 데이터 타입별 분류
                if i < len(df.columns):
                    if df.iloc[:, i].dtype in ['int64', 'float64']:
                        file_info['numeric_columns'].append(col)
                    elif df.iloc[:, i].dtype == 'object':
                        file_info['categorical_columns'].append(col)
            
            # 금융 지표 식별 (더 포괄적으로)
            financial_indicators = []
            for col in column_headers:
                col_str = str(col).lower()
                if any(keyword in col_str for keyword in 
                      ['per', 'pbr', 'roe', 'roa', 'eps', 'sales', 'growth', 
                       'margin', 'ratio', 'return', 'yield', 'cap', 'price',
                       'opm', 'ccc', 'peg', 'bps', 'dy', 'ytd']):
                    financial_indicators.append(col)
            
            file_info['financial_indicators'] = financial_indicators
            
            analysis_results[csv_file.name] = file_info
            
            # 간단한 요약 출력
            print(f"   📏 크기: {len(df)} 행 × {len(df.columns)} 열")
            print(f"   🔑 주요 컬럼: {file_info['key_columns']}")
            print(f"   📈 금융지표: {len(financial_indicators)}개")
            
        except Exception as e:
            print(f"   ❌ 오류: {str(e)}")
            analysis_results[csv_file.name] = {'error': str(e)}
    
    return analysis_results

def identify_key_files(analysis_results):
    """핵심 파일들을 식별합니다."""
    
    print("\n" + "=" * 60)
    print("🎯 핵심 파일 식별")
    print("=" * 60)
    
    key_files = {}
    
    for filename, info in analysis_results.items():
        if 'error' in info:
            continue
            
        # 파일 중요도 평가
        importance_score = 0
        
        # 기업 정보가 있는 파일
        if any('ticker' in col.lower() or 'corp' in col.lower() 
               for col in info.get('column_names', [])):
            importance_score += 10
        
        # 금융 지표가 많은 파일
        importance_score += len(info.get('financial_indicators', []))
        
        # 데이터가 많은 파일
        if info.get('rows', 0) > 100:
            importance_score += 5
        
        key_files[filename] = {
            'importance_score': importance_score,
            'rows': info.get('rows', 0),
            'financial_indicators': len(info.get('financial_indicators', [])),
            'description': get_file_description(filename)
        }
    
    # 중요도 순으로 정렬
    sorted_files = sorted(key_files.items(), 
                         key=lambda x: x[1]['importance_score'], 
                         reverse=True)
    
    print("\n📊 파일 중요도 순위:")
    for i, (filename, info) in enumerate(sorted_files[:10], 1):
        print(f"{i:2d}. {filename}")
        print(f"    점수: {info['importance_score']}, "
              f"행수: {info['rows']}, "
              f"지표수: {info['financial_indicators']}")
        print(f"    설명: {info['description']}")
        print()
    
    return sorted_files

def get_file_description(filename):
    """파일명을 기반으로 설명을 생성합니다."""
    
    descriptions = {
        'A_Company.csv': '기업 기본정보 및 핵심 지표',
        'A_Compare.csv': '동종업계 비교 분석',
        'A_Contrast.csv': '대조 분석 데이터',
        'A_Distribution.csv': '분배 관련 데이터',
        'A_ETFs.csv': 'ETF 관련 정보',
        'T_Rank.csv': '각종 지표별 순위',
        'T_Growth_C.csv': '성장률 컨센서스',
        'T_Growth_H.csv': '성장률 히스토리',
        'T_EPS_C.csv': 'EPS 컨센서스',
        'T_EPS_H.csv': 'EPS 히스토리',
        'S_Valuation.csv': '밸류에이션 분석',
        'S_Chart.csv': '차트 데이터',
        'S_Mylist.csv': '사용자 관심 종목',
        'T_CFO.csv': 'CFO 관련 지표',
        'T_Chart.csv': '기술적 분석 데이터',
        'T_Chk.csv': '체크리스트 데이터',
        'T_Correlation.csv': '상관관계 분석',
        'M_Company.csv': '월간 기업 데이터',
        'M_ETFs.csv': '월간 ETF 데이터',
        'E_Indicators.csv': '경제 지표',
        'UP_&_Down.csv': '상승/하락 분석',
        'ReadMe.csv': '설명서'
    }
    
    return descriptions.get(filename, '기타 데이터')

def generate_data_strategy(analysis_results, key_files):
    """데이터 활용 전략을 생성합니다."""
    
    print("\n" + "=" * 60)
    print("🚀 데이터 활용 전략")
    print("=" * 60)
    
    strategy = {
        'primary_files': [],      # 핵심 파일들
        'secondary_files': [],    # 보조 파일들
        'web_columns': [],        # 웹에서 표시할 컬럼들
        'filter_columns': [],     # 필터링용 컬럼들
        'sort_columns': [],       # 정렬용 컬럼들
        'chart_columns': []       # 차트용 컬럼들
    }
    
    # 상위 5개 파일을 핵심 파일로 선정
    for filename, info in key_files[:5]:
        strategy['primary_files'].append({
            'filename': filename,
            'description': info['description'],
            'usage': get_usage_recommendation(filename)
        })
    
    # A_Company.csv 상세 분석 (가장 중요한 파일)
    if 'A_Company.csv' in analysis_results:
        company_info = analysis_results['A_Company.csv']
        
        print("\n📋 A_Company.csv 상세 분석:")
        print(f"   총 {company_info['rows']}개 기업")
        print(f"   총 {company_info['columns']}개 컬럼")
        
        # 웹에서 표시할 핵심 컬럼들 추천
        recommended_columns = []
        for col in company_info['column_names']:
            col_lower = col.lower()
            if any(keyword in col_lower for keyword in 
                  ['ticker', 'corp', 'exchange', 'industry', 'market', 
                   'roe', 'per', 'pbr', 'sales', 'growth', 'price']):
                recommended_columns.append(col)
        
        strategy['web_columns'] = recommended_columns[:15]  # 상위 15개
        
        print(f"   🌐 웹 표시 추천 컬럼 ({len(strategy['web_columns'])}개):")
        for col in strategy['web_columns']:
            print(f"      - {col}")
    
    return strategy

def get_usage_recommendation(filename):
    """파일별 사용 용도를 추천합니다."""
    
    usage_map = {
        'A_Company.csv': '메인 테이블 - 기업 목록 및 핵심 지표 표시',
        'T_Rank.csv': '랭킹 시스템 - 각 지표별 상위 종목 표시',
        'S_Valuation.csv': '밸류에이션 분석 - 적정가격 vs 현재가 비교',
        'A_Compare.csv': '섹터 비교 - 동종업계 벤치마킹',
        'T_Growth_C.csv': '성장률 분석 - 미래 성장 전망'
    }
    
    return usage_map.get(filename, '추가 분석용 데이터')

def save_analysis_results(analysis_results, strategy):
    """분석 결과를 JSON 파일로 저장합니다."""
    
    output_file = "csv_analysis_results.json"
    
    output_data = {
        'analysis_date': pd.Timestamp.now().isoformat(),
        'total_files': len(analysis_results),
        'file_analysis': analysis_results,
        'data_strategy': strategy
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print(f"\n💾 분석 결과 저장: {output_file}")

def main():
    """메인 실행 함수"""
    
    print("🔍 Global_Scouter CSV 구조 분석 도구")
    print("=" * 60)
    
    # CSV 파일들 분석
    analysis_results = analyze_csv_files()
    
    # 핵심 파일들 식별
    key_files = identify_key_files(analysis_results)
    
    # 데이터 활용 전략 생성
    strategy = generate_data_strategy(analysis_results, key_files)
    
    # 결과 저장
    save_analysis_results(analysis_results, strategy)
    
    print("\n✅ 분석 완료!")
    print("\n📋 다음 단계:")
    print("1. csv_analysis_results.json 파일 검토")
    print("2. 핵심 파일들의 데이터 통합 계획 수립")
    print("3. 웹 애플리케이션 컬럼 구조 설계")

if __name__ == "__main__":
    main()