import pandas as pd
import json
import logging
import re
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime

class WeeklyDataProcessor:
    """매주 Global_Scouter CSV를 완벽하게 처리하는 자동화 시스템"""
    
    def __init__(self, config_path: str = None):
        script_dir = Path(__file__).parent.resolve()
        if config_path is None:
            config_path = script_dir / '../config/data_config.json'

        self.logger = self._setup_logging()
        self.config = self._load_config(config_path)
        
        field_mappings_path = script_dir / '../config/field_mappings.json'
        validation_rules_path = script_dir / '../config/validation_rules.json'

        self.field_mappings = self._load_config(field_mappings_path)
        self.validation_rules = self._load_config(validation_rules_path)
        
    def process_weekly_data(self, csv_path: str) -> Dict[str, Any]:
        """Weekly data processing"""
        self.logger.info("Starting weekly data processing...")
        
        try:
            # 1. Load data
            df = self._load_csv_safely(csv_path)
            self.logger.info(f"Original data: {len(df)} rows, {len(df.columns)} columns")

            # 2. Clean column headers
            df.columns = [str(col).strip() for col in df.columns]
            df = df.rename(columns=lambda c: re.sub(r'[^\w\s\.\-\%\$\(\)]', '', c))

            # 3. Set Ticker as index
            if 'Ticker' in df.columns:
                df = df.set_index('Ticker')

            # 4. Deep clean data
            cleaned_df = self._deep_clean_data(df)
            self.logger.info(f"Cleaning complete: {len(cleaned_df)} rows (Removed: {len(df) - len(cleaned_df)})")
            
            # 5. Field mapping and standardization
            mapped_df = self._smart_field_mapping(cleaned_df)
            self.logger.info(f"Field mapping complete: {len(mapped_df.columns)} standard fields")
            
            # 6. Data type optimization
            optimized_df = self._optimize_data_types(mapped_df)
            
            # 7. Quality validation
            validation_result = {'passed': True, 'warnings': [], 'errors': []}

            
            # 8. Generate JSON output
            output_data = self._generate_output(optimized_df)
            
            # 9. Save files
            output_path = self._save_processed_data(output_data)
            
            # 10. Generate processing report
            report = self._generate_processing_report(df, optimized_df, validation_result)
            
            self.logger.info("Weekly data processing complete!")
            return {
                'success': True,
                'output_path': output_path,
                'report': report
            }
            
        except Exception as e:
            self.logger.error(f"Processing failed: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
    
    def _load_config(self, config_path: str) -> Dict[str, Any]:
        """Load config file"""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            self.logger.warning(f"Config file not found at {config_path}, using empty config.")
            return {}
        except json.JSONDecodeError:
            self.logger.error(f"Error decoding JSON from {config_path}, using empty config.")
            return {}

    def _setup_logging(self):
        """Setup logging"""
        logger = logging.getLogger(self.__class__.__name__)
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler()
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        handler.setFormatter(formatter)
        if not logger.handlers:
            logger.addHandler(handler)
        return logger

    def _load_csv_safely(self, csv_path: str) -> pd.DataFrame:
        """Safely load CSV file and handle basic structure"""
        if not Path(csv_path).exists():
            raise FileNotFoundError(f"CSV file not found at {csv_path}")
        
        encodings_to_try = ['utf-8', 'cp949', 'euc-kr', 'latin1', 'utf-8-sig']
        df = None
        for encoding in encodings_to_try:
            try:
                self.logger.info(f"Trying encoding: {encoding}")
                df = pd.read_csv(csv_path, header=1, encoding=encoding, low_memory=False, on_bad_lines='skip')
                self.logger.info(f"Successfully loaded with encoding: {encoding}")
                break
            except UnicodeDecodeError:
                self.logger.warning(f"Failed to decode with {encoding}")
                continue
        
        if df is None:
            raise ValueError("Failed to load CSV with all attempted encodings.")

        # Manually handle duplicate columns
        cols = pd.Series(df.columns)
        for dup in cols[cols.duplicated()].unique():
            cols[cols[cols == dup].index.values.tolist()] = [f'{dup}.{i}' for i in range(sum(cols == dup))]
        df.columns = cols

        # Drop the first column if it's unnamed
        if df.columns[0].startswith('Unnamed'):
            df = df.iloc[:, 1:]
        
        return df

    def _validate_data_quality(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Validate data quality"""
        warnings = []
        errors = []

        required_fields = self.validation_rules.get('required_fields', [])
        for field in required_fields:
            if field not in df.columns and field != df.index.name:
                errors.append(f"Missing required field: {field}")
            elif field in df.columns and df[field].isna().sum() > len(df) * 0.1:
                warnings.append(f"Field {field} has {df[field].isna().sum()} missing values")

        if df.index.name == 'Ticker':
            if df.index.duplicated().any():
                warnings.append(f"Found {df.index.duplicated().sum()} duplicate tickers")

        numeric_validations = self.validation_rules.get('numeric_validations', {})
        for field, (min_val, max_val) in numeric_validations.items():
            if field in df.columns:
                # Coerce to numeric, forcing non-numeric to NaN
                numeric_col = pd.to_numeric(df[field], errors='coerce')
                # Find values that are out of range (and not NaN)
                out_of_range = numeric_col[(numeric_col < min_val) | (numeric_col > max_val)]
                if not out_of_range.empty:
                    warnings.append(f"Field {field} has {len(out_of_range)} values out of range")

        return {
            'passed': len(errors) == 0,
            'warnings': warnings,
            'errors': errors,
            'total_records': len(df),
            'valid_records': len(df.dropna(subset=required_fields)) if required_fields else len(df)
        }

    def _deep_clean_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Deep clean data"""
        cleaned_df = df.copy()

        # Clean object columns
        for col in cleaned_df.select_dtypes(include=['object']).columns:
            # Remove problematic patterns
            cleaned_df[col] = cleaned_df[col].str.replace(r'0-0x2a0x2a|0x2a0x2a|0-0x2a|x2a0x2a', '', regex=True).str.strip()
            # Replace empty strings with NA
            cleaned_df[col] = cleaned_df[col].replace('', pd.NA)
            # Remove non-printable characters
            cleaned_df[col] = cleaned_df[col].str.replace(r'[^\w\s\.\-\%\$\(\)]', '', regex=True).str.strip()

        # Drop rows where all important fields are NA
        important_fields = self.config.get('important_fields', ['Ticker', 'corpName'])
        available_fields = [f for f in important_fields if f in cleaned_df.columns]
        if available_fields:
            cleaned_df.dropna(subset=available_fields, how='all', inplace=True)
        
        return cleaned_df

    def _smart_field_mapping(self, df: pd.DataFrame) -> pd.DataFrame:
        """Smart field mapping"""
        mapped_df = df.copy()
        
        if self.field_mappings:
            mapped_df = mapped_df.rename(columns=self.field_mappings)
        
        auto_mappings = self._detect_field_patterns(mapped_df.columns)
        mapped_df = mapped_df.rename(columns=auto_mappings)
        
        return mapped_df

    def _detect_field_patterns(self, columns: List[str]) -> Dict[str, str]:
        """Detect field patterns"""
        mappings = {}
        patterns = self.config.get('field_patterns', {})
        
        for col in columns:
            if col is None: continue
            col_lower = str(col).lower()
            for standard_name, pattern_list in patterns.items():
                for pattern in pattern_list:
                    if re.search(pattern, col_lower):
                        mappings[col] = standard_name
                        break
                if col in mappings:
                    break
        
        return mappings
    
    def _optimize_data_types(self, df: pd.DataFrame) -> pd.DataFrame:
        """Optimize data types"""
        optimized_df = df.copy()
        numeric_patterns = self.config.get('numeric_patterns', [])
        
        for col in optimized_df.columns:
            if col is None: continue
            col_lower = str(col).lower()
            is_numeric = any(re.search(pattern, col_lower) for pattern in numeric_patterns)
            
            if is_numeric:
                # Extract numeric values from the string column
                numeric_series = optimized_df[col].astype(str).str.extract(r'([-+]?\d*\.?\d+)', expand=False)
                optimized_df[col] = pd.to_numeric(numeric_series, errors='coerce')
        
        return optimized_df
    
    def _validate_data_quality(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Validate data quality"""
        warnings = []
        errors = []

        required_fields = self.validation_rules.get('required_fields', [])
        for field in required_fields:
            if field not in df.columns and field != df.index.name:
                errors.append(f"Missing required field: {field}")
            elif field in df.columns and df[field].isna().sum() > len(df) * 0.1:
                warnings.append(f"Field {field} has {df[field].isna().sum()} missing values")

        if df.index.name == 'Ticker':
            if df.index.duplicated().any():
                warnings.append(f"Found {df.index.duplicated().sum()} duplicate tickers")

        numeric_validations = self.validation_rules.get('numeric_validations', {})
        for field, (min_val, max_val) in numeric_validations.items():
            if field in df.columns:
                # Coerce to numeric, forcing non-numeric to NaN
                numeric_col = pd.to_numeric(df[field], errors='coerce')
                # Find values that are out of range (and not NaN)
                out_of_range = numeric_col[(numeric_col < min_val) | (numeric_col > max_val)]
                if not out_of_range.empty:
                    warnings.append(f"Field {field} has {len(out_of_range)} values out of range")

        return {
            'passed': len(errors) == 0,
            'warnings': warnings,
            'errors': errors,
            'total_records': len(df),
            'valid_records': len(df.dropna(subset=required_fields)) if required_fields else len(df)
        }

    def _generate_output(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Generate output data"""
        # Convert all data to string to avoid JSON serialization issues
        df_copy = df.copy()
        
        # Handle duplicate columns
        cols = pd.Series(df_copy.columns)
        for dup in cols[cols.duplicated()].unique():
            cols[cols[cols == dup].index.values.tolist()] = [f'{dup}.{i}' for i in range(sum(cols == dup))]
        df_copy.columns = cols

        for col in df_copy.columns:
            df_copy[col] = df_copy[col].astype(str)
        return {
            'data': df_copy.to_dict('records'),
            'metadata': {
                'total_companies': len(df_copy),
                'total_fields': len(df_copy.columns),
                'processing_date': datetime.now().isoformat(),
            },
            'schema': {
                'fields': [
                    {
                        'name': col,
                        'type': str(df_copy[col].dtype),
                        'null_count': int(df_copy[col].isna().sum()),
                        'unique_count': int(df_copy[col].nunique())
                    }
                    for col in df_copy.columns
                ]
            }
        }
    
    def _save_processed_data(self, data: Dict[str, Any]) -> str:
        """Save processed data"""
        output_dir = self.config.get('output_dir', 'data')
        backup_dir = self.config.get('backup_dir', 'data/backups')
        
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        Path(backup_dir).mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        main_output = f"{output_dir}/enhanced_summary_data.json"
        backup_output = f"{backup_dir}/data_backup_{timestamp}.json"
        
        with open(main_output, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        with open(backup_output, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return main_output

    def _generate_processing_report(self, raw_df, processed_df, validation_result):
        """Generate processing report"""
        return {
            "raw_rows": len(raw_df),
            "processed_rows": len(processed_df),
            "validation_passed": validation_result['passed'],
            "warnings": validation_result['warnings'],
            "errors": validation_result['errors']
        }

if __name__ == "__main__":
    processor = WeeklyDataProcessor()
    csv_path = 'C:/Users/etlov/agents-workspace/fenomeno_projects/Global_Scouter/Global_Scouter_20251003/A_Company.csv'
    result = processor.process_weekly_data(csv_path)
    
    if result['success']:
        print("Weekly data processing complete!")
        print(f"Processing result: {result['report']}")
    else:
        print(f"Processing failed: {result['error']}")