#!/usr/bin/env python3
"""
데이터 품질 검증 스크립트
엔비디아 등 주요 기업의 데이터 정확성 확인
"""

import json
import pandas as pd
import numpy as np

def load_data():
    """데이터 로드"""
    try:
        with open('projects/100xFenok/tools/stock_analyzer/data/enhanced_summary_data.json', 'r', encoding='utf-8') as f:
            json_data = json.load(f)
        
        # JSON 구조 확인
        if isinstance(json_data, dict) and 'companies' in json_data:
            data = json_data['companies']
        elif isinstance(json_data, dict) and 'data' in json_data:
            data = json_data['data']
        elif isinstance(json_data, list):
            data = json_data
        else:
            print("❌ 알 수 없는 데이터 구조")
            return []
            
        print(f"✅ 데이터 로드 완료: {len(data)}개 기업")
        return data
    except Exception as e:
        print(f"❌ 데이터 로드 실패: {e}")
        return []

def verify_nvidia_data(data):
    """엔비디아 데이터 검증"""
    nvidia = None
    for company in data:
        if company.get('Ticker') == 'NVDA' or 'NVIDIA' in str(company.get('corpName', '')):
            nvidia = company
            break
    
    if not nvidia:
        print("❌ 엔비디아 데이터를 찾을 수 없습니다")
        return
    
    print("\n🔍 엔비디아 데이터 검증:")
    print(f"티커: {nvidia.get('Ticker')}")
    print(f"회사명: {nvidia.get('corpName')}")
    print(f"업종: {nvidia.get('industry')}")
    print(f"거래소: {nvidia.get('Exchange')}")
    
    # 주요 지표 검증
    key_metrics = {
        'PER (Oct-25)': nvidia.get('PER (Oct-25)'),
        'PBR (Oct-25)': nvidia.get('PBR (Oct-25)'),
        'ROE (Fwd)': nvidia.get('ROE (Fwd)'),
        'OPM (Fwd)': nvidia.get('OPM (Fwd)'),
        'Sales (3)': nvidia.get('Sales (3)'),
        'Return (Y)': nvidia.get('Return (Y)'),
        '12 M': nvidia.get('12 M'),
        '(USD mn)': nvidia.get('(USD mn)')
    }
    
    print("\n📊 주요 지표:")
    for metric, value in key_metrics.items():
        print(f"{metric}: {value}")
        
        # 이상값 체크
        if metric == 'Sales (3)' and value is not None:
            try:
                sales_growth = float(value)
                if sales_growth < 10:  # 엔비디아 매출성장률이 10% 미만이면 이상
                    print(f"⚠️  이상값 감지: {metric} = {sales_growth}% (너무 낮음)")
            except:
                pass
                
        if metric == 'Return (Y)' and value is not None:
            try:
                yearly_return = float(value)
                if yearly_return < 50:  # 엔비디아 연간수익률이 50% 미만이면 이상
                    print(f"⚠️  이상값 감지: {metric} = {yearly_return}% (너무 낮음)")
            except:
                pass

def check_data_quality(data):
    """전체 데이터 품질 체크"""
    print("\n🔍 전체 데이터 품질 분석:")
    
    # 기본 통계
    total_companies = len(data)
    print(f"총 기업 수: {total_companies}")
    
    # 필수 필드 체크
    required_fields = ['Ticker', 'corpName', 'industry', 'Exchange']
    for field in required_fields:
        missing_count = sum(1 for company in data if not company.get(field))
        print(f"{field} 누락: {missing_count}개 ({missing_count/total_companies*100:.1f}%)")
    
    # 수치 데이터 이상값 체크
    numeric_fields = ['PER (Oct-25)', 'PBR (Oct-25)', 'ROE (Fwd)', 'Sales (3)', 'Return (Y)']
    
    print("\n📈 수치 데이터 분석:")
    for field in numeric_fields:
        values = []
        for company in data:
            try:
                val = float(company.get(field, 0))
                if not np.isnan(val) and val != 0:
                    values.append(val)
            except:
                continue
        
        if values:
            values = np.array(values)
            print(f"\n{field}:")
            print(f"  평균: {np.mean(values):.2f}")
            print(f"  중앙값: {np.median(values):.2f}")
            print(f"  최소값: {np.min(values):.2f}")
            print(f"  최대값: {np.max(values):.2f}")
            print(f"  유효 데이터: {len(values)}개")
            
            # 이상값 탐지 (IQR 방법)
            q1, q3 = np.percentile(values, [25, 75])
            iqr = q3 - q1
            lower_bound = q1 - 1.5 * iqr
            upper_bound = q3 + 1.5 * iqr
            outliers = values[(values < lower_bound) | (values > upper_bound)]
            
            if len(outliers) > 0:
                print(f"  ⚠️  이상값: {len(outliers)}개 ({len(outliers)/len(values)*100:.1f}%)")

def find_suspicious_companies(data):
    """의심스러운 데이터를 가진 기업 찾기"""
    print("\n🚨 의심스러운 데이터 기업:")
    
    suspicious = []
    
    for company in data:
        ticker = company.get('Ticker', '')
        corp_name = company.get('corpName', '')
        
        # 대형 기술주인데 성장률이 낮은 경우
        tech_giants = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']
        if ticker in tech_giants:
            try:
                sales_growth = float(company.get('Sales (3)', 0))
                yearly_return = float(company.get('Return (Y)', 0))
                
                if sales_growth < 5:  # 매출성장률 5% 미만
                    suspicious.append({
                        'ticker': ticker,
                        'name': corp_name,
                        'issue': f'매출성장률 너무 낮음: {sales_growth}%',
                        'field': 'Sales (3)',
                        'value': sales_growth
                    })
                
                if yearly_return < 10:  # 연간수익률 10% 미만
                    suspicious.append({
                        'ticker': ticker,
                        'name': corp_name,
                        'issue': f'연간수익률 너무 낮음: {yearly_return}%',
                        'field': 'Return (Y)',
                        'value': yearly_return
                    })
            except:
                continue
    
    for item in suspicious[:10]:  # 상위 10개만 표시
        print(f"  {item['ticker']} ({item['name']}): {item['issue']}")
    
    return suspicious

def generate_data_report(data):
    """데이터 품질 리포트 생성"""
    report = {
        'total_companies': len(data),
        'timestamp': pd.Timestamp.now().isoformat(),
        'quality_issues': [],
        'recommendations': []
    }
    
    # 의심스러운 데이터 찾기
    suspicious = find_suspicious_companies(data)
    report['quality_issues'] = suspicious
    
    # 권장사항
    if len(suspicious) > 0:
        report['recommendations'].append("대형 기술주의 성장률 데이터 재검토 필요")
        report['recommendations'].append("데이터 소스 및 계산 방식 확인 필요")
        report['recommendations'].append("최신 재무 데이터로 업데이트 필요")
    
    # 리포트 저장
    with open('projects/100xFenok/tools/stock_analyzer/data/data_quality_report.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    print(f"\n📋 데이터 품질 리포트 저장: data/data_quality_report.json")
    return report

def main():
    print("🔍 데이터 품질 검증 시작")
    
    # 데이터 로드
    data = load_data()
    if not data:
        return
    
    # 엔비디아 데이터 검증
    verify_nvidia_data(data)
    
    # 전체 데이터 품질 체크
    check_data_quality(data)
    
    # 의심스러운 데이터 찾기
    find_suspicious_companies(data)
    
    # 리포트 생성
    generate_data_report(data)
    
    print("\n✅ 데이터 품질 검증 완료")

if __name__ == "__main__":
    main()