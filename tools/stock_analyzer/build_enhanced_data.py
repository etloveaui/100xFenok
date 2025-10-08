#!/usr/bin/env python3
"""
Enhanced Stock Data Builder
Global_Scouter CSV 데이터를 웹에서 사용할 수 있는 풍부한 JSON 형태로 변환
"""

import pandas as pd
import json
import os
from pathlib import Path

# 설정
CSV_SOURCE_DIR = "../../../../fenomeno_projects/Global_Scouter/Global_Scouter_20251003"
OUTPUT_DIR = "./data"

def load_and_clean_csv(file_path):
    """CSV 파일을 로드하고 정제"""
    try:
        # CSV 파일 읽기 (인코딩 문제 해결)
        df = pd.read_csv(file_path, encoding='utf-8')
        
        # 빈 행 제거
        df = df.dropna(how='all')
        
        # 첫 번째 행이 헤더 설명인 경우 제거
        if df.iloc[0, 1] and '데이터-모두' in str(df.iloc[0, 1]):
            df = df.drop(0).reset_index(drop=True)
            
        return df
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return None

def extract_company_data():
    """A_Company.csv에서 기업 데이터 추출"""
    csv_path = os.path.join(CSV_SOURCE_DIR, "A_Company.csv")
    df = load_and_clean_csv(csv_path)
    
    if df is None:
        return []
    
    print(f"Loaded A_Company.csv with {len(df)} rows and {len(df.columns)} columns")
    print("Column names:", df.columns.tolist()[:10])  # 처음 10개 컬럼만 출력
    
    companies = []
    
    for idx, row in df.iterrows():
        try:
            # 기본 정보 추출
            ticker = str(row.iloc[1]) if pd.notna(row.iloc[1]) else ""
            corp_name = str(row.iloc[2]) if pd.notna(row.iloc[2]) else ""
            exchange = str(row.iloc[3]) if pd.notna(row.iloc[3]) else ""
            industry = str(row.iloc[4]) if pd.notna(row.iloc[4]) else ""
            
            # 빈 티커는 스킵
            if not ticker or ticker == "nan" or ticker == "Ticker":
                continue
                
            # 숫자 데이터 추출 및 변환
            def safe_float(value):
                try:
                    if pd.isna(value) or value == "" or str(value).strip() == "":
                        return None
                    # 한국 원화 표시 제거 (₩ 기호와 쉼표)
                    if isinstance(value, str):
                        value = value.replace('₩', '').replace(',', '').strip()
                    return float(value)
                except:
                    return None
            
            # 현재가 (컬럼 7)
            current_price = safe_float(row.iloc[7])
            
            # 시가총액 (컬럼 10)
            market_cap = safe_float(row.iloc[10])
            
            # ROE (컬럼 11)
            roe_fwd = safe_float(row.iloc[11])
            
            # OPM (컬럼 12)
            opm_fwd = safe_float(row.iloc[12])
            
            # PER (컬럼 14)
            per_current = safe_float(row.iloc[14])
            
            # PBR (컬럼 16)
            pbr_current = safe_float(row.iloc[16])
            
            # 성장률 (컬럼 17)
            sales_growth = safe_float(row.iloc[17])
            
            # PER 3년 (컬럼 19)
            per_3y = safe_float(row.iloc[19])
            
            # PER 5년 (컬럼 20)
            per_5y = safe_float(row.iloc[20])
            
            # PEG (컬럼 22)
            peg_ratio = safe_float(row.iloc[22])
            
            # 배당수익률 (컬럼 26)
            dividend_yield = safe_float(row.iloc[26])
            
            # 수익률 데이터 (컬럼 27-32: 1주, 1개월, 3개월, 6개월, YTD, 12개월)
            returns = {
                "1W": safe_float(row.iloc[27]),
                "1M": safe_float(row.iloc[28]),
                "3M": safe_float(row.iloc[29]),
                "6M": safe_float(row.iloc[30]),
                "YTD": safe_float(row.iloc[31]),
                "12M": safe_float(row.iloc[32])
            }
            
            company_data = {
                "Ticker": ticker,
                "corpName": corp_name,
                "exchange": exchange,
                "industry": industry,
                "currentPrice": current_price,
                "marketCapUSD": market_cap,
                "roeFwd": roe_fwd,
                "opmFwd": opm_fwd,
                "perCurrent": per_current,
                "pbrCurrent": pbr_current,
                "salesGrowth": sales_growth,
                "per3Y": per_3y,
                "per5Y": per_5y,
                "pegRatio": peg_ratio,
                "dividendYield": dividend_yield,
                "returns": returns,
                # 검색 최적화용
                "searchIndex": f"{ticker} {corp_name}".lower()
            }
            
            companies.append(company_data)
            
        except Exception as e:
            print(f"Error processing row {idx}: {e}")
            continue
    
    print(f"Successfully processed {len(companies)} companies")
    return companies

def remove_duplicates(companies):
    """중복 제거 (같은 Ticker)"""
    seen_tickers = set()
    unique_companies = []
    
    for company in companies:
        ticker = company["Ticker"]
        if ticker not in seen_tickers:
            seen_tickers.add(ticker)
            unique_companies.append(company)
        else:
            print(f"Duplicate removed: {ticker}")
    
    print(f"Removed {len(companies) - len(unique_companies)} duplicates")
    return unique_companies

def analyze_data_quality(companies):
    """데이터 품질 분석"""
    print("\n=== 데이터 품질 분석 ===")
    print(f"총 기업 수: {len(companies)}")
    
    # 거래소별 분포
    exchanges = {}
    for company in companies:
        exchange = company["exchange"]
        exchanges[exchange] = exchanges.get(exchange, 0) + 1
    
    print("\n거래소별 분포:")
    for exchange, count in sorted(exchanges.items(), key=lambda x: x[1], reverse=True):
        print(f"  {exchange}: {count}개")
    
    # 업종별 분포 (상위 10개)
    industries = {}
    for company in companies:
        industry = company["industry"]
        industries[industry] = industries.get(industry, 0) + 1
    
    print("\n업종별 분포 (상위 10개):")
    for industry, count in sorted(industries.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  {industry}: {count}개")
    
    # 데이터 완성도
    fields = ["marketCapUSD", "roeFwd", "perCurrent", "pbrCurrent"]
    print("\n데이터 완성도:")
    for field in fields:
        non_null_count = sum(1 for c in companies if c[field] is not None)
        percentage = (non_null_count / len(companies)) * 100
        print(f"  {field}: {non_null_count}/{len(companies)} ({percentage:.1f}%)")

def save_enhanced_data(companies):
    """향상된 데이터를 JSON으로 저장"""
    
    # 메인 데이터 저장
    output_path = os.path.join(OUTPUT_DIR, "summary_data.json")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(companies, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ Enhanced data saved to {output_path}")
    print(f"   File size: {os.path.getsize(output_path) / 1024 / 1024:.2f} MB")
    
    # 샘플 데이터 확인
    if companies:
        print(f"\n📊 Sample company data:")
        sample = companies[0]
        for key, value in sample.items():
            if key != "returns":
                print(f"   {key}: {value}")
            else:
                print(f"   returns: {value}")

def main():
    """메인 실행 함수"""
    print("🚀 Enhanced Stock Data Builder 시작")
    
    # 출력 디렉토리 확인
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # 1. 기업 데이터 추출
    print("\n1️⃣ A_Company.csv에서 데이터 추출 중...")
    companies = extract_company_data()
    
    if not companies:
        print("❌ 데이터 추출 실패")
        return
    
    # 2. 중복 제거
    print("\n2️⃣ 중복 데이터 제거 중...")
    companies = remove_duplicates(companies)
    
    # 3. 데이터 품질 분석
    analyze_data_quality(companies)
    
    # 4. JSON 저장
    print("\n3️⃣ JSON 파일 저장 중...")
    save_enhanced_data(companies)
    
    print("\n🎉 완료!")

if __name__ == "__main__":
    main()