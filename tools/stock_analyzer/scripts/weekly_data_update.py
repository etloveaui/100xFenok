#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
매주 Global Scouter 데이터 자동 업데이트 스크립트
사용자는 Global_Scouter 폴더만 최신 버전으로 교체하면 됨
"""

import pandas as pd
import json
import sys
import io
from pathlib import Path
from datetime import datetime
import shutil

# UTF-8 출력 설정
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

class GlobalScouterDataProcessor:
    """Global Scouter 모든 CSV 파일을 JSON으로 변환하고 통합"""

    def __init__(self, source_dir, output_dir):
        self.source_dir = Path(source_dir)
        self.output_dir = Path(output_dir)
        self.backup_dir = output_dir / 'backups'
        self.timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        # 백업 디렉토리 생성
        self.backup_dir.mkdir(exist_ok=True, parents=True)

        # CSV 파일 분류
        self.csv_files = {
            # 핵심 데이터 (Main)
            'main': {
                'M_Company.csv': '모멘텀 기업 데이터 (6000+ 기업)',
                'A_Company.csv': '분석 기업 리스트',
            },

            # 기술 지표 (Technical)
            'technical': {
                'T_Chart.csv': '차트 데이터',
                'T_Rank.csv': '순위 데이터',
                'T_Growth_H.csv': '성장률 (History)',
                'T_Growth_C.csv': '성장률 (Current)',
                'T_EPS_H.csv': 'EPS (History)',
                'T_EPS_C.csv': 'EPS (Current)',
                'T_CFO.csv': '현금흐름',
                'T_Correlation.csv': '상관관계',
                'T_Chk.csv': '체크리스트',
            },

            # 분석 데이터 (Analysis)
            'analysis': {
                'A_Compare.csv': '기업 비교',
                'A_Contrast.csv': '대조 분석',
                'A_Distribution.csv': '분포 분석',
                'A_ETFs.csv': 'ETF 데이터',
            },

            # 시장 데이터 (Market)
            'market': {
                'S_Chart.csv': '차트 스냅샷',
                'S_Mylist.csv': '관심 종목',
                'S_Valuation.csv': '밸류에이션',
                'UP_&_Down.csv': '등락 데이터',
            },

            # 지표 (Indicators)
            'indicators': {
                'E_Indicators.csv': '경제 지표',
                'M_ETFs.csv': '모멘텀 ETF',
            }
        }

    def backup_existing_data(self):
        """기존 JSON 파일 백업"""
        print(f'\\n=== 기존 데이터 백업 시작 ===')
        json_files = list(self.output_dir.glob('*.json'))

        if not json_files:
            print('백업할 파일 없음')
            return

        backup_folder = self.backup_dir / f'backup_{self.timestamp}'
        backup_folder.mkdir(exist_ok=True)

        for json_file in json_files:
            if json_file.name.startswith('enhanced_summary_data'):
                backup_path = backup_folder / json_file.name
                shutil.copy2(json_file, backup_path)
                print(f'백업: {json_file.name} -> {backup_path.name}')

        print(f'백업 완료: {backup_folder}')

    def process_csv(self, csv_filename):
        """개별 CSV 파일 처리"""
        csv_path = self.source_dir / csv_filename

        if not csv_path.exists():
            print(f'⚠️ 파일 없음: {csv_filename}')
            return None

        print(f'처리 중: {csv_filename}')

        try:
            # CSV 읽기
            df = pd.read_csv(csv_path, encoding='utf-8')

            # 헤더 정리 (2번째 행이 실제 헤더인 경우)
            if df.iloc[0].isna().all() or any('Company' in str(val) or 'Corp' in str(val) for val in df.iloc[1].values if pd.notna(val)):
                df.columns = df.iloc[1].values
                df = df.iloc[2:].reset_index(drop=True)

            # DataFrame to dict
            data_dict = df.to_dict(orient='records')

            # NaN/Infinity 정리
            clean_data = []
            for record in data_dict:
                clean_record = {}
                for key, value in record.items():
                    if pd.isna(value):
                        clean_record[key] = None
                    elif isinstance(value, float) and (value == float('inf') or value == float('-inf')):
                        clean_record[key] = None
                    else:
                        clean_record[key] = value
                clean_data.append(clean_record)

            print(f'✅ {csv_filename}: {len(clean_data)}개 레코드')
            return clean_data

        except Exception as e:
            print(f'❌ {csv_filename} 처리 오류: {e}')
            return None

    def process_all_categories(self):
        """모든 카테고리 CSV 처리"""
        print(f'\\n=== 전체 CSV 파일 처리 시작 ===')

        results = {}

        for category, files in self.csv_files.items():
            print(f'\\n[{category.upper()}]')
            category_data = {}

            for csv_file, description in files.items():
                print(f'  {description}')
                data = self.process_csv(csv_file)

                if data:
                    # 파일명에서 확장자 제거
                    key = csv_file.replace('.csv', '')
                    category_data[key] = data

            results[category] = category_data

        return results

    def generate_m_company_json(self):
        """M_Company.csv를 enhanced_summary_data_full.json으로 변환 (기존 로직)"""
        print(f'\\n=== M_Company.csv -> enhanced_summary_data_full.json 변환 ===')

        csv_path = self.source_dir / 'M_Company.csv'
        output_json = self.output_dir / 'enhanced_summary_data_full.json'

        df = pd.read_csv(csv_path, encoding='utf-8')
        df.columns = df.iloc[1].values
        df = df.iloc[2:].reset_index(drop=True)

        data_dict = df.to_dict(orient='records')

        companies = []
        for record in data_dict:
            company = {}
            for key, value in record.items():
                if pd.isna(value):
                    company[key] = None
                elif isinstance(value, float) and (value == float('inf') or value == float('-inf')):
                    company[key] = None
                else:
                    company[key] = value

            # Ticker와 Corp 있는 경우만 추가
            if 'Ticker' in company and 'Corp' in company:
                if company['Ticker'] is not None and company['Corp'] is not None:
                    company['corpName'] = company.get('Corp', '')
                    companies.append(company)

        output_data = {
            'metadata': {
                'source': 'M_Company.csv',
                'generated_at': datetime.now().isoformat(),
                'total_companies': len(companies),
                'update_timestamp': self.timestamp,
            },
            'companies': companies
        }

        with open(output_json, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)

        print(f'✅ {output_json.name} 생성: {len(companies)}개 기업')
        return len(companies)

    def generate_integrated_json(self, all_data):
        """모든 CSV 데이터를 통합한 JSON 생성"""
        print(f'\\n=== 통합 JSON 생성 ===')

        output_json = self.output_dir / 'global_scouter_integrated.json'

        integrated_data = {
            'metadata': {
                'source': 'Global_Scouter',
                'generated_at': datetime.now().isoformat(),
                'update_timestamp': self.timestamp,
                'categories': list(all_data.keys()),
                'total_files': sum(len(files) for files in all_data.values()),
            },
            'data': all_data
        }

        with open(output_json, 'w', encoding='utf-8') as f:
            json.dump(integrated_data, f, ensure_ascii=False, indent=2)

        print(f'✅ {output_json.name} 생성')

        # 통계 출력
        print(f'\\n통합 데이터 통계:')
        for category, files in all_data.items():
            print(f'  [{category}]: {len(files)}개 파일')
            for filename, records in files.items():
                print(f'    - {filename}: {len(records)}개 레코드')

        return output_json

    def run(self):
        """전체 프로세스 실행"""
        print(f'╔═══════════════════════════════════════════════════════╗')
        print(f'║   Global Scouter 매주 데이터 자동 업데이트          ║')
        print(f'║   시작 시간: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}                 ║')
        print(f'╚═══════════════════════════════════════════════════════╝')

        # 1. 기존 데이터 백업
        self.backup_existing_data()

        # 2. M_Company.csv → enhanced_summary_data_full.json (기존 로직)
        total_companies = self.generate_m_company_json()

        # 3. 모든 CSV 파일 처리
        all_data = self.process_all_categories()

        # 4. 통합 JSON 생성
        integrated_json = self.generate_integrated_json(all_data)

        # 5. 완료 보고
        print(f'\\n╔═══════════════════════════════════════════════════════╗')
        print(f'║              데이터 업데이트 완료!                    ║')
        print(f'╚═══════════════════════════════════════════════════════╝')
        print(f'\\n📊 결과:')
        print(f'  - 메인 데이터: {total_companies}개 기업')
        print(f'  - 통합 파일: {integrated_json.name}')
        print(f'  - 백업 위치: {self.backup_dir / f"backup_{self.timestamp}"}')
        print(f'\\n✅ Stock Analyzer가 자동으로 새 데이터를 사용합니다.')

        return {
            'success': True,
            'total_companies': total_companies,
            'integrated_json': str(integrated_json),
            'timestamp': self.timestamp
        }

def main():
    # 경로 설정
    source_dir = Path(r'C:\Users\etlov\agents-workspace\fenomeno_projects\Global_Scouter\Global_Scouter_20251003')
    output_dir = Path(r'C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer\data')

    # 프로세서 실행
    processor = GlobalScouterDataProcessor(source_dir, output_dir)
    result = processor.run()

    return 0 if result['success'] else 1

if __name__ == '__main__':
    sys.exit(main())
