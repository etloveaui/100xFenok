import json
import re
from collections import Counter
from pathlib import Path

from backup_manager import create_backup
from data_validator import DataValidator
from quality_report import generate_markdown


class AdvancedDataCleaner:
    def __init__(self):
        self.problematic_values = {
            "nan",
            "infinity",
            "-infinity",
            "0x2a",
            "#n/a",
            "0xf",
            "",
            "null",
            "undefined",
        }
        self.problematic_keys = {"nan", "null", "undefined"}
        self.required_fields = ["Ticker", "corpName"]
        self.numeric_field_hints = re.compile(
            r"(?:price|per|pbr|roe|dy|return|sales|market|value|ratio|growth|opm|w$|^\d+)", re.IGNORECASE
        )
        self.currency_map = {
            "$": "USD",
            "₩": "KRW",
            "€": "EUR",
            "£": "GBP",
            "¥": "JPY",
            "HK$": "HKD",
        }
        self.stats = Counter()

    def clean_enhanced_summary_data(self, source_path, output_path=None, backup=True):
        source = Path(source_path)
        if not source.exists():
            raise FileNotFoundError(f"Source file not found: {source}")

        if backup:
            backup_path = create_backup(source)
            self.stats["backups_created"] += 1
        else:
            backup_path = None

        data = json.loads(source.read_text(encoding="utf-8"))
        companies = data.get("companies", [])

        cleaned_companies = []
        all_keys = set()

        for company in companies:
            cleaned = self.clean_company(company)

            if not self._has_required_fields(cleaned):
                self.stats["removed_missing_required"] += 1
                continue

            cleaned_companies.append(cleaned)
            all_keys.update(cleaned.keys())

        # unify structure
        for company in cleaned_companies:
            for key in all_keys:
                company.setdefault(key, None)

        cleaned_data = {
            "metadata": data.get("metadata", {}),
            "companies": cleaned_companies,
        }

        output = Path(output_path) if output_path else source.parent / "enhanced_summary_data_clean.json"
        output.write_text(json.dumps(cleaned_data, ensure_ascii=False, indent=2), encoding="utf-8")
        self.stats["output_path"] = str(output)

        validator = DataValidator(required_fields=self.required_fields)
        validation_stats = validator.validate(cleaned_data)
        report_path = source.parent / "enhanced_summary_quality_report.md"
        generate_markdown(report_path, validation_stats)

        summary = {
            "source": str(source),
            "backup": str(backup_path) if backup_path else None,
            "output": str(output),
            "report": str(report_path),
            "stats": dict(self.stats),
            "validation": validation_stats,
        }
        return summary

    def clean_company(self, company):
        cleaned = {}
        currency = None

        for key, value in company.items():
            normalized_key = key.strip() if isinstance(key, str) else key
            if isinstance(normalized_key, str) and normalized_key.strip().lower() in self.problematic_keys:
                self.stats["dropped_problematic_keys"] += 1
                continue

            normalized_value, detected_currency = self.normalize_value(normalized_key, value)
            if detected_currency and not currency:
                currency = detected_currency
            cleaned[normalized_key] = normalized_value

        if currency:
            cleaned.setdefault("currency", currency)

        return cleaned

    def normalize_value(self, field, value):
        detected_currency = None

        if isinstance(value, str):
            trimmed = value.strip()
            trimmed_lower = trimmed.lower()

            if trimmed_lower in self.problematic_values:
                self.stats["problematic_values_replaced"] += 1
                return None, None

            if self.numeric_field_hints.search(field) or self._looks_numeric(trimmed):
                numeric_value, detected_currency = self._parse_numeric(trimmed)
                if numeric_value is not None:
                    self.stats["numeric_normalized"] += 1
                    return numeric_value, detected_currency
                else:
                    self.stats["numeric_parse_failed"] += 1
                    return None, detected_currency

            return trimmed, None

        if isinstance(value, (int, float)):
            if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
                self.stats["problematic_values_replaced"] += 1
                return None, None
            return value, None

        if value is None:
            return None, None

        return value, None

    def _parse_numeric(self, text):
        currency = None
        working_text = text

        for symbol, code in self.currency_map.items():
            if working_text.startswith(symbol):
                currency = code
                working_text = working_text[len(symbol):].strip()
                break

        trailing_code = re.match(r"^([A-Za-z]{2,3})\s+([\d,\.\-]+)$", working_text)
        if trailing_code:
            currency = currency or trailing_code.group(1).upper()
            working_text = trailing_code.group(2)

        alpha_chars = re.sub(r"[^A-Za-z]", "", working_text)
        if alpha_chars:
            upper = alpha_chars.upper()
            allowed = set(self.currency_map.values()) | {sym.replace("$", "") for sym in self.currency_map.keys()}
            if upper not in allowed:
                return None, currency

        match = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?", working_text)
        if not match:
            return None, currency

        numeric_text = match.group(0).replace(",", "")

        try:
            numeric_value = float(numeric_text)
            return numeric_value, currency
        except ValueError:
            return None, currency

    def _looks_numeric(self, text):
        if not re.search(r"\d", text):
            return False
        stripped = re.sub(r"[\d,\.\-\s]", "", text)
        if not stripped:
            return True
        upper = stripped.upper()
        allowed = set(self.currency_map.values()) | {sym.replace("$", "") for sym in self.currency_map.keys()}
        return upper in allowed

    def _has_required_fields(self, company):
        for field in self.required_fields:
            value = company.get(field)
            if value is None:
                return False
            if isinstance(value, str) and not value.strip():
                return False
        return True


def main():
    cleaner = AdvancedDataCleaner()
    project_root = Path(__file__).resolve().parents[1]
    source = project_root / "data" / "enhanced_summary_data.json"
    summary = cleaner.clean_enhanced_summary_data(source)

    print("=== Data Cleaning Summary ===")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
