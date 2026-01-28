#!/usr/bin/env python3
import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

# Configuration
TEMPLATE_PATH = Path(__file__).parent / "100x-daily-wrap-template.html"
OUTPUT_DIR = Path(__file__).parent
DATA_DIR = Path(__file__).parent / "data"

def load_template(path: Path) -> str:
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def generate_report(template: str, data: dict, date_str: str) -> str:
    # Basic info
    template = template.replace("[YYYY년 MM월 DD일 (요일)]", data.get("reportMeta", {}).get("date", date_str))
    template = template.replace("2025년 07월 22일", data.get("reportMeta", {}).get("date", date_str)) # fallback for hardcoded dates in template
    
    # Key Indicators replacement
    # S&P 500
    sp500 = data.get("indices", {}).get("S&P 500", {})
    template = template.replace("[지수 값]", str(sp500.get("close", "-")), 1)
    template = template.replace("[+0.00%]", f"{sp500.get('change_pct', 0):+.2f}%", 1)
    
    # Nasdaq 100
    nasdaq = data.get("indices", {}).get("NASDAQ", {})
    template = template.replace("[지수 값]", str(nasdaq.get("close", "-")), 1)
    template = template.replace("[+0.00%]", f"{nasdaq.get('change_pct', 0):+.2f}%", 1)
    
    # VIX
    vix = data.get("indices", {}).get("VIX (Volatility)", {})
    template = template.replace("[지수 값]", str(vix.get("close", "-")), 1)
    template = template.replace("[+0.00%]", f"{vix.get('change_pct', 0):+.2f}%", 1)
    
    # 10Y Treasury
    tnx = data.get("treasury", {}).get("10-Year Treasury Yield", {})
    template = template.replace("[금리 값]", f"{tnx.get('close', 0):.3f}%", 1)
    template = template.replace("[-0bp]", f"{tnx.get('change', 0)*100:+.1f}bp", 1)

    # Thesis & Headlines
    header = data.get("header", {})
    template = template.replace("Test Thesis for 2026-01-28", header.get("todaysThesis", "시장 데이터 수집 완료. 분석 진행 중입니다."))
    
    # S01 Cards
    cards = data.get("s01_thesis", {}).get("cards", [])
    for card in cards:
        if "market-driver" in card.get("id", ""):
            template = template.replace("[Primary Market Driver's 내용]", card.get("content", ""))
        elif "liquidity-indicator" in card.get("id", ""):
            template = template.replace("[100x Liquidity Indicator's 내용]", card.get("content", ""))
        elif "correlation-shift" in card.get("id", ""):
            template = template.replace("[Key Correlation Shift's 내용]", card.get("content", ""))
        elif "actionable-signal" in card.get("id", ""):
            template = template.replace("[Actionable Signal's 내용]", card.get("content", ""))

    # Sector Heatmap Injection
    sector_data = data.get("s07_sectorPulse", {}).get("heatmapData", [])
    heatmap_js = f"const sectorData = {json.dumps(sector_data, ensure_ascii=False)};"
    template = template.replace("const sectorData = [];", heatmap_js)

    return template

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", type=str, default="2026-01-28")
    args = parser.parse_args()

    date_str = args.date
    json_path = DATA_DIR / f"{date_str}.json"
    output_path = OUTPUT_DIR / f"{date_str}_100x-daily-wrap.html"

    template = load_template(TEMPLATE_PATH)
    
    with open(json_path, 'r', encoding='utf-8') as f:
        market_raw = json.load(f)

    # Transform raw data to template format (Mocking the AI analysis part for now)
    formatted_data = {
        "reportMeta": {"date": f"{date_str} (수)"},
        "header": {
            "todaysThesis": "실시간 데이터 수집 성공. 엔비디아와 브로드컴이 프리장을 주도하며 나스닥 강세를 견인 중입니다."
        },
        "indices": market_raw.get("indices", {}),
        "treasury": market_raw.get("treasury", {}),
        "s01_thesis": {
            "cards": [
                {"id": "market-driver", "content": "빅테크 실적 기대감과 유동성 공급이 시장의 하방을 지지하고 있습니다."},
                {"id": "liquidity-indicator", "content": "TGA 잔액 및 RRP 추이를 볼 때 시스템 유동성은 아직 안정적인 수준을 유지하고 있습니다."},
                {"id": "correlation-shift", "content": "금리와 기술주의 역상관관계가 다소 약화되며 독자적인 실적 장세를 연출 중입니다."},
                {"id": "actionable-signal", "content": "엔비디아 190달러선 안착 여부가 오늘 본장의 핵심 변곡점이 될 전망입니다."}
            ]
        },
        "s07_sectorPulse": {
            "heatmapData": [
                {"name": "기술", "etf": "XLK", "day": market_raw.get("indices", {}).get("NASDAQ", {}).get("change_pct", 0.8), "ytd": 12.5},
                {"name": "금융", "etf": "XLF", "day": 0.2, "ytd": 4.1},
                {"name": "에너지", "etf": "XLE", "day": -0.5, "ytd": -1.2},
                {"name": "헬스케어", "etf": "XLV", "day": 0.1, "ytd": 2.3}
            ]
        }
    }

    final_html = generate_report(template, formatted_data, date_str)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(final_html)
    
    print(f"✅ Generated: {output_path}")

if __name__ == "__main__":
    main()
