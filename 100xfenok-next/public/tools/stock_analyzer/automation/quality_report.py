from pathlib import Path
from datetime import datetime


def generate_markdown(report_path, stats):
    """
    Write markdown quality report to `report_path`.
    """
    lines = [
        "# 데이터 정제 품질 리포트",
        "",
        f"- 생성 시각: {datetime.utcnow().isoformat()}Z",
        f"- 총 기업 수: {stats.get('total_companies', 0)}",
        "",
        "## 필수 필드 누락 현황",
    ]

    missing_required = stats.get("missing_required", {})
    if missing_required:
        for field, count in missing_required.items():
            lines.append(f"- {field}: {count}건")
    else:
        lines.append("- 누락 없음")

    type_issues = stats.get("type_issues", [])
    lines.append("")
    lines.append("## 타입/데이터 이슈")
    if type_issues:
        for ticker, key, value in type_issues[:20]:
            lines.append(f"- {ticker or 'UNKNOWN'} / {key}: {value}")
        if len(type_issues) > 20:
            lines.append(f"- ...외 {len(type_issues) - 20}건")
    else:
        lines.append("- 추가 이슈 없음")

    Path(report_path).write_text("\n".join(lines), encoding="utf-8")
    return report_path
