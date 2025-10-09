from collections import Counter
from pathlib import Path
import json


class DataValidator:
    def __init__(self, required_fields=None):
        self.required_fields = required_fields or ["Ticker", "corpName"]

    def validate(self, data):
        """
        Validate cleaned dataset.
        Returns dict with summary statistics and issues encountered.
        """
        metadata = data.get("metadata", {})
        companies = data.get("companies", [])

        missing_required = Counter()
        type_issues = []

        for company in companies:
            for field in self.required_fields:
                value = company.get(field)
                if value in (None, "", " "):
                    missing_required[field] += 1

            for key, value in company.items():
                if isinstance(value, float) and (value != value):  # NaN check
                    type_issues.append((company.get("Ticker"), key, value))

        return {
            "metadata": metadata,
            "total_companies": len(companies),
            "missing_required": dict(missing_required),
            "type_issues": type_issues,
        }

    def validate_file(self, path):
        content = Path(path).read_text(encoding="utf-8")
        data = json.loads(content)
        return self.validate(data)
