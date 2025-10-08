#!/usr/bin/env python3
"""
퍼센트 데이터 수정 스크립트
소수점 형태로 저장된 퍼센트 데이터를 올바른 퍼센트로 변환
"""

import json
import shutil
from datetime import datetime

def load_data():
    """데이터 로드"""
    try:
        with open('projects/100xFenok/tools/stock_analyzer/data/enhanced_summary_data.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ 데이터 로드 실패: {e}")
        return None

def backup_data():
    """데이터 백업"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f'projects/100xFenok/tools/stock_analyzer/data/enhanced_summary_data_backup_{timestamp}.json'
    
    try:
        shutil.copy2(
            'projects/100xFenok/tools/stock_analyzer/data/enhanced_summary_data.json',
            backup_path
        )
        print(f"✅ 데이터 백업 완료: {backup_path}")
        return True
    except Exception as e:
        print(f"❌ 백업 실패: {e}")
        return False

def fix_percentage_fields(data):
    """퍼센트 필드 수정"""
    # 퍼센트로 변환해야 할 필드들 (소수점 → 퍼센트)
    percentage_fields = [
        'ROE (Fwd)',           # ROE 예상
        'OPM (Fwd)',           # 영업이익률 예상
        'Sales (3)',           # 매출성장률 3년
        'Return (Y)',          # 연간수익률
        'DY (FY+1)',          # 배당수익률
        'W',                   # 주간수익률
        '1 M',                 # 1개월수익률
        '3 M',                 # 3개월수익률
        '6 M',                 # 6개월수익률
        'YTD',                 # 연초대비수익률
        '12 M',                # 12개월수익률
        '% PER (Avg)',         # PER 평균대비 퍼센트
        '전일대비',             # 전일대비
        '전주대비'              # 전주대비
    ]
    
    companies = data.get('companies', data)
    fixed_count = 0
    
    print("🔧 퍼센트 데이터 수정 중...")
    
    for company in companies:
        company_fixed = False
        
        for field in percentage_fields:
            if field in company and company[field] is not None:
                try:
                    # 현재 값이 소수점 형태인지 확인
                    current_value = float(company[field])
                    
                    # 소수점 형태 (0.0 ~ 1.0 범위)를 퍼센트로 변환
                    if -1.0 <= current_value <= 1.0:
                        # 100을 곱해서 퍼센트로 변환
                        new_value = current_value * 100
                        company[field] = new_value
                        company_fixed = True
                        
                        # 주요 기업의 경우 로그 출력
                        if company.get('Ticker') in ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN']:
                            print(f"  {company.get('Ticker')} {field}: {current_value:.4f} → {new_value:.2f}%")
                    
                except (ValueError, TypeError):
                    continue
        
        if company_fixed:
            fixed_count += 1
    
    print(f"✅ {fixed_count}개 기업의 퍼센트 데이터 수정 완료")
    return data

def verify_fixes(data):
    """수정 결과 검증"""
    print("\n🔍 수정 결과 검증:")
    
    companies = data.get('companies', data)
    
    # 엔비디아 데이터 확인
    nvidia = None
    for company in companies:
        if company.get('Ticker') == 'NVDA':
            nvidia = company
            break
    
    if nvidia:
        print(f"\n📊 엔비디아 수정 후 데이터:")
        key_fields = ['Sales (3)', 'Return (Y)', 'ROE (Fwd)', 'OPM (Fwd)', '12 M']
        for field in key_fields:
            value = nvidia.get(field)
            if value is not None:
                print(f"  {field}: {value:.2f}%")
    
    # 다른 주요 기업들도 확인
    major_stocks = ['AAPL', 'MSFT', 'GOOGL', 'AMZN']
    for ticker in major_stocks:
        company = None
        for comp in companies:
            if comp.get('Ticker') == ticker:
                company = comp
                break
        
        if company:
            sales_growth = company.get('Sales (3)')
            yearly_return = company.get('Return (Y)')
            print(f"\n{ticker}: 매출성장률 {sales_growth:.2f}%, 연간수익률 {yearly_return:.2f}%")

def save_fixed_data(data):
    """수정된 데이터 저장"""
    try:
        with open('projects/100xFenok/tools/stock_analyzer/data/enhanced_summary_data.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\n✅ 수정된 데이터 저장 완료")
        return True
    except Exception as e:
        print(f"❌ 데이터 저장 실패: {e}")
        return False

def main():
    print("🔧 퍼센트 데이터 수정 시작")
    
    # 데이터 로드
    data = load_data()
    if not data:
        return
    
    # 백업 생성
    if not backup_data():
        print("❌ 백업 실패로 작업 중단")
        return
    
    # 퍼센트 데이터 수정
    fixed_data = fix_percentage_fields(data)
    
    # 수정 결과 검증
    verify_fixes(fixed_data)
    
    # 수정된 데이터 저장
    if save_fixed_data(fixed_data):
        print("\n🎉 퍼센트 데이터 수정 완료!")
        print("브라우저를 새로고침하여 수정된 데이터를 확인하세요.")
    else:
        print("❌ 데이터 저장 실패")

if __name__ == "__main__":
    main()