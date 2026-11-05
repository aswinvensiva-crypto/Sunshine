"""
reporter.py — Generates structured evaluation reports (JSON + Markdown).
All numbers must come from actual computation; no hand-typed results.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from typing import Any, Dict, Tuple


def get_git_commit() -> str:
    """Retrieve current short git commit hash or 'unknown'."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "unknown"


def write_report(
    module: str,
    metrics: Dict[str, Any],
    tenant_id: int,
    data_source: str,
    seed: int,
    model_version: str,
    notes: str = "",
    output_dir: str = "docs/evaluation",
) -> Tuple[str, str]:
    """
    Write evaluation report as JSON + Markdown.
    data_source must be 'real', 'synthetic', or 'mixed'.
    All metrics must be actual computed values, not placeholders.
    Returns (json_path, md_path).
    """
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    if data_source == "synthetic":
        data_source_note = (
            "SYNTHETIC DATA: Results are plumbing/feasibility evidence only. "
            "Do not interpret as real-world performance (DAT-002, EV-006)."
        )
    elif data_source == "mixed":
        data_source_note = (
            "MIXED DATA: Results combine synthetic and real data. "
            "Refer to notes for detailed data provenance."
        )
    else:
        data_source_note = "Real data: results reflect actual system performance."

    report = {
        "module": module,
        "run_id": run_id,
        "tenant_id": tenant_id,
        "data_source": data_source,
        "data_source_note": data_source_note,
        "seed": seed,
        "model_version": model_version,
        "git_commit": get_git_commit(),
        "python_version": sys.version,
        "platform": platform.platform(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "notes": notes,
        "business_targets_note": (
            "PRD §7 targets (10% revenue lift, 15% cancellation reduction, 50% fewer inquiries) "
            "are HYPOTHESES TO TEST, not acceptance thresholds (U-11, EV-007)."
        ),
    }

    os.makedirs(output_dir, exist_ok=True)
    json_path = os.path.join(output_dir, f"{module}_{run_id}.json")
    md_path = os.path.join(output_dir, f"{module}_{run_id}.md")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)

    # Markdown version
    md = f"""# {module.title()} Evaluation Report

**Run:** {run_id} | **Tenant:** {tenant_id} | **Commit:** {report['git_commit']}

> **Data source:** {data_source.upper()}  
> {report['data_source_note']}

## Metrics

"""
    for k, v in metrics.items():
        if isinstance(v, float):
            md += f"- **{k}:** {v:.4f}\n"
        else:
            md += f"- **{k}:** {v}\n"

    md += f"\n## Notes\n\n{notes or 'None.'}\n"
    md += f"\n---\n*Generated {report['generated_at']} · Python {sys.version.split()[0]}*\n"

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md)

    print(f"  Report written: {json_path}")
    return json_path, md_path
