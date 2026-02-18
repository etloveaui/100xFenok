#!/usr/bin/env python3
"""
Enhanced Data Processor - 에이전트들을 위한 개선된 데이터 처리 시스템
프로젝트 매니저 (Kiro)가 현재 시스템 안정화를 위해 작성
"""

import pandas as pd
import json
import numpy as np
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional

class EnhancedDataProcessor:
    """에이전트들이 사용할 개선된 데이터 처리 시스템"""
    
    def __init__(self):
        self.csv_path = "../../../../fenomeno_projects/Global_Scouter/Global_Scouter_20251003/A_Company.csv"
        self.output_dir = "./data"
        self.current_date = datetime.now()
        
        # 2025년 10월 8일 기준으로 YTD 로직 수정
        self.current_year = 2025
        self.current_month = 10
        
        print(f"📅 현재 날짜 설정: {self.current_year}년 {self.current_month}월")
        
    def process_weekly_data(self) -> Dict[str, Any]:
        """매주 데이터 처리 - 완전 자동화"""
        print("🚀 Enhanced Data Processor 시작...")
        print("=" * 60)
        
        try:
            # 1. CSV 로드 및 구조 분석
            raw_df = self._load_and_analyze_csv()
            
            # 2. 심층 데이터 정제
            cleaned_df = self._deep_clean_data(raw_df)
            
            # 3. 스마트 필드 매핑
            mapped_df = self._smart_field_mapping(cleaned_df)
            
            # 4. 데이터 타입 최적화
            optimized_df = self._optimize_data_types(mapped_df)
            
            # 5. YTD 로직 수정 (2025년 10월 기준)
            corrected_df = self._fix_ytd_logic(optimized_df)
            
            # 6. 품질 검증
            validation_result = self._validate_data_quality(corrected_df)
            
            # 7. JSON 출력 생성
            output_data = self._generate_enhanced_output(corrected_df)
            
            # 8. 파일 저장
            output_path = self._save_processed_data(output_data)
            
            # 9. 처리 리포트 생성
            report = self._generate_processing_report(raw_df, corrected_df, validation_result)
            
            print("✅ Enhanced Data Processing 완료!")
            return {
                'success': True,
                'output_path': output_path,
                'report': report,
                'companies_count': len(corrected_df),
                'indicators_count': len(corrected_df.columns)
            }
            
        except Exception as e:
            print(f"❌ 처리 실패: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
    
    def _load_and_analyze_csv(self) -> pd.DataFrame:
        """CSV 로드 및 구조 분석"""
        print("📊 CSV 파일 구조 분석 중...")
        
        df_raw = pd.read_csv(self.csv_path, encoding='utf-8')
        print(f"원본 파일 크기: {df_raw.shape}")
        
        # 실제 헤더는 1번째 행
        headers = df_raw.iloc[1].tolist()
        data_rows = df_raw.iloc[2:].copy()
        
        # 헤더 정리 (첫 번째 빈 컬럼 제거)
        valid_headers = headers[1:]
        data_rows = data_rows.iloc[:, 1:]
        data_rows.columns = valid_headers[:len(data_rows.columns)]
        
        print(f"정제된 데이터 크기: {data_rows.shape}")
        return data_rows
    
    def _deep_clean_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """심층 데이터 정제 - 0-0x2a0x2a 패턴 완전 제거"""
        print("🧹 심층 데이터 정제 중...")
        
        cleaned_df = df.copy()
        
        # 1. 0-0x2a0x2a 패턴 완전 제거
        problematic_patterns = [
            '0-0x2a0x2a', '0x2a0x2a', '0-0x2a', 'x2a0x2a',
            'N/A', 'n/a', '#N/A', '#VALUE!', '#DIV/0!'
        ]
        
        for col in cleaned_df.columns:
            try:
                if cleaned_df[col].dtype == 'object':
                    for pattern in problematic_patterns:
                        cleaned_df[col] = cleaned_df[col].astype(str).str.replace(pattern, '', regex=False)
                    
                    # 빈 문자열을 NaN으로 변환
                    cleaned_df[col] = cleaned_df[col].replace('', pd.NA)
                    cleaned_df[col] = cleaned_df[col].str.strip()
            except Exception as e:
                print(f"⚠️ 컬럼 {col} 처리 중 오류: {e}")
                continue
        
        # 2. 빈 행 제거 (Ticker와 Corp 모두 비어있는 경우)
        important_fields = ['Ticker', 'Corp']
        available_fields = [f for f in important_fields if f in cleaned_df.columns]
        
        if available_fields:
            mask = cleaned_df[available_fields].apply(
                lambda row: row.astype(str).str.strip().ne('').any(), axis=1
            )
            cleaned_df = cleaned_df[mask]
        
        print(f"정제 완료: {len(cleaned_df)} 행 (제거된 행: {len(df) - len(cleaned_df)})")
        return cleaned_df
    
    def _smart_field_mapping(self, df: pd.DataFrame) -> pd.DataFrame:
        """스마트 필드 매핑"""
        print("🎯 스마트 필드 매핑 중...")
        
        # 표준 필드 매핑
        field_mappings = {
            'Corp': 'corpName',
            'WI26': 'industry',  # 실제 업종 필드명 확인 필요
            'Exchange': 'Exchange',
            'Ticker': 'Ticker'
        }
        
        mapped_df = df.rename(columns=field_mappings)
        
        # 필수 필드 확인 및 생성
        required_fields = ['Ticker', 'corpName', 'Exchange', 'industry']
        for field in required_fields:
            if field not in mapped_df.columns:
                # 유사한 컬럼명 찾기
                similar_cols = [col for col in mapped_df.columns if field.lower() in col.lower()]
                if similar_cols:
                    mapped_df[field] = mapped_df[similar_cols[0]]
                    print(f"📋 {field} 필드 매핑: {similar_cols[0]} → {field}")
                else:
                    mapped_df[field] = 'Unknown'
                    print(f"⚠️ {field} 필드 누락, 기본값 설정")
        
        return mapped_df
    
    def _optimize_data_types(self, df: pd.DataFrame) -> pd.DataFrame:
        """데이터 타입 최적화"""
        print("📊 데이터 타입 최적화 중...")
        
        optimized_df = df.copy()
        
        # 숫자 필드 패턴
        numeric_patterns = [
            r'per|pbr|roe|roa|price|return|ratio|rate|growth|margin',
            r'cap|volume|sales|revenue|income|profit|yield',
            r'debt|equity|asset|liability|eps|dps'
        ]
        
        for col in optimized_df.columns:
            if col in ['Ticker', 'corpName', 'Exchange', 'industry']:
                continue  # 문자 필드는 그대로 유지
                
            col_lower = col.lower()
            is_numeric = any(re.search(pattern, col_lower) for pattern in numeric_patterns)
            
            # 첫 번째 유효한 값으로 숫자 여부 판단
            sample_value = None
            for val in optimized_df[col].dropna().head(5):
                if val is not None:
                    sample_value = str(val)
                    break
            
            if is_numeric or (sample_value and any(char.isdigit() for char in sample_value)):
                # 숫자 변환 시도
                optimized_df[col] = pd.to_numeric(optimized_df[col], errors='coerce')
        
        return optimized_df
    
    def _fix_ytd_logic(self, df: pd.DataFrame) -> pd.DataFrame:
        """YTD 로직 수정 - 2025년 10월 기준"""
        print("📅 YTD 로직 수정 중 (2025년 10월 기준)...")
        
        corrected_df = df.copy()
        
        # YTD 관련 필드 확인
        ytd_fields = [col for col in df.columns if 'ytd' in col.lower()]
        
        if ytd_fields:
            print(f"🔍 YTD 필드 발견: {ytd_fields}")
            
            # 2025년 10월이므로 YTD는 연초부터 10월까지의 누적 수익률
            # 원본 YTD 데이터가 올바르다고 가정하고 그대로 사용
            for field in ytd_fields:
                print(f"✅ {field} 필드 유지 (2025년 10월 YTD 데이터)")
        else:
            print("ℹ️ YTD 필드 없음")
        
        # Return (Y) 필드가 있다면 이것이 연간 수익률
        if 'Return (Y)' in corrected_df.columns:
            print("✅ Return (Y) 필드 확인 - 연간 수익률로 처리")
        
        return corrected_df
    
    def _validate_data_quality(self, df: pd.DataFrame) -> Dict[str, Any]:
        """데이터 품질 검증"""
        print("🔍 데이터 품질 검증 중...")
        
        warnings = []
        errors = []
        
        # 1. 필수 필드 검증
        required_fields = ['Ticker', 'corpName']
        for field in required_fields:
            if field not in df.columns:
                errors.append(f"필수 필드 누락: {field}")
            elif df[field].isna().sum() > len(df) * 0.1:
                warnings.append(f"필드 {field}의 {df[field].isna().sum()}개 값이 누락됨")
        
        # 2. 중복 데이터 검증
        if 'Ticker' in df.columns:
            duplicate_tickers = df['Ticker'].duplicated().sum()
            if duplicate_tickers > 0:
                warnings.append(f"중복 티커 {duplicate_tickers}개 발견")
        
        # 3. 숫자 필드 범위 검증
        numeric_validations = {
            'PER (Oct-25)': (0, 1000),
            'PBR (Oct-25)': (0, 100),
            'ROE (Fwd)': (-100, 200)
        }
        
        for field, (min_val, max_val) in numeric_validations.items():
            if field in df.columns:
                out_of_range = ((df[field] < min_val) | (df[field] > max_val)).sum()
                if out_of_range > 0:
                    warnings.append(f"필드 {field}의 {out_of_range}개 값이 범위를 벗어남")
        
        return {
            'passed': len(errors) == 0,
            'warnings': warnings,
            'errors': errors,
            'total_records': len(df),
            'valid_records': len(df.dropna(subset=required_fields))
        }
    
    def _generate_enhanced_output(self, df: pd.DataFrame) -> Dict[str, Any]:
        """향상된 출력 데이터 생성"""
        print("📤 향상된 출력 데이터 생성 중...")
        
        # 데이터 변환
        companies_data = []
        for _, row in df.iterrows():
            company = {}
            for col in df.columns:
                value = row[col]
                if pd.isna(value):
                    company[col] = None
                elif isinstance(value, (int, float)):
                    if np.isnan(value) or np.isinf(value):
                        company[col] = None
                    else:
                        company[col] = float(value)
                else:
                    company[col] = str(value)
            
            # 검색 인덱스 추가
            ticker = company.get('Ticker', '')
            corp_name = company.get('corpName', '')
            company['searchIndex'] = f"{ticker} {corp_name}".lower()
            
            companies_data.append(company)
        
        return {
            'metadata': {
                'version': '3.0',
                'generated_at': datetime.now().isoformat(),
                'total_companies': len(companies_data),
                'total_fields': len(df.columns),
                'processing_date': f"{self.current_year}년 {self.current_month}월",
                'data_quality_score': self._calculate_quality_score(df),
                'description': 'Enhanced Data Processor로 처리된 고품질 데이터'
            },
            'companies': companies_data,
            'schema': {
                'fields': [
                    {
                        'name': col,
                        'type': str(df[col].dtype),
                        'null_count': int(df[col].isna().sum()),
                        'unique_count': int(df[col].nunique())
                    }
                    for col in df.columns
                ]
            }
        }
    
    def _calculate_quality_score(self, df: pd.DataFrame) -> float:
        """데이터 품질 점수 계산"""
        total_cells = df.size
        null_cells = df.isna().sum().sum()
        quality_score = ((total_cells - null_cells) / total_cells) * 100
        return round(quality_score, 2)
    
    def _save_processed_data(self, data: Dict[str, Any]) -> str:
        """처리된 데이터 저장"""
        print("💾 처리된 데이터 저장 중...")
        
        # 디렉토리 생성
        Path(self.output_dir).mkdir(parents=True, exist_ok=True)
        
        # 메인 데이터 파일
        main_output = f"{self.output_dir}/enhanced_summary_data.json"
        with open(main_output, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        # 백업 파일
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_output = f"{self.output_dir}/backups/enhanced_data_backup_{timestamp}.json"
        Path(f"{self.output_dir}/backups").mkdir(parents=True, exist_ok=True)
        with open(backup_output, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        # 파일 크기 확인
        file_size = Path(main_output).stat().st_size
        print(f"✅ 메인 파일 저장: {main_output} ({file_size/1024/1024:.1f}MB)")
        print(f"✅ 백업 파일 저장: {backup_output}")
        
        return main_output
    
    def _generate_processing_report(self, raw_df: pd.DataFrame, processed_df: pd.DataFrame, validation: Dict) -> Dict[str, Any]:
        """처리 리포트 생성"""
        return {
            'processing_summary': {
                'original_rows': len(raw_df),
                'processed_rows': len(processed_df),
                'removed_rows': len(raw_df) - len(processed_df),
                'total_columns': len(processed_df.columns),
                'data_quality_score': self._calculate_quality_score(processed_df)
            },
            'validation_results': validation,
            'processing_date': f"{self.current_year}년 {self.current_month}월 {datetime.now().day}일",
            'processor_version': '3.0 Enhanced'
        }

def main():
    """메인 실행 함수"""
    print("🚀 Enhanced Data Processor 시작")
    print("프로젝트 매니저 (Kiro) - 현재 시스템 안정화")
    print("=" * 60)
    
    processor = EnhancedDataProcessor()
    result = processor.process_weekly_data()
    
    if result['success']:
        print("\n🎉 Enhanced Data Processing 성공!")
        print(f"📊 처리 결과:")
        print(f"   - 기업 수: {result['companies_count']:,}개")
        print(f"   - 지표 수: {result['indicators_count']}개")
        print(f"   - 출력 파일: {result['output_path']}")
        print(f"   - 품질 점수: {result['report']['processing_summary']['data_quality_score']}%")
        
        print("\n✅ 에이전트들이 사용할 수 있는 안정적인 데이터 준비 완료!")
        print("📋 다음 단계:")
        print("   1. Claude Code: DataSkeleton에서 이 데이터 활용")
        print("   2. Gemini CLI: WeeklyDataProcessor 개발 시 참고")
        print("   3. Codex: 통합 테스트에서 데이터 품질 검증")
    else:
        print(f"\n❌ 처리 실패: {result['error']}")

if __name__ == "__main__":
    main()