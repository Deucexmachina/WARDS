import csv
import sys
from pathlib import Path


def test_evaluation_metrics_writes_excel_outputs(tmp_path, monkeypatch):
    evaluation_dir = Path(__file__).resolve().parents[1] / "evaluation"
    if str(evaluation_dir) not in sys.path:
        sys.path.insert(0, str(evaluation_dir))

    import metrics

    csv_path = tmp_path / "evaluation_results.csv"
    json_path = tmp_path / "summary.json"
    md_path = tmp_path / "summary.md"
    xlsx_path = tmp_path / "confusion_matrix_results.xlsx"
    fields = [
        "test_id",
        "scenario",
        "domain",
        "actual",
        "predicted",
        "result",
        "incident_id",
        "detection_id",
        "ai_score",
        "ai_prediction",
        "latency_seconds",
        "timestamp",
        "notes",
    ]
    rows = [
        {"test_id": "ATK-X", "scenario": "attack", "domain": "context", "actual": "attack", "predicted": "attack", "result": "TP", "latency_seconds": "1.5"},
        {"test_id": "BEN-X", "scenario": "benign", "domain": "context", "actual": "benign", "predicted": "benign", "result": "TN", "latency_seconds": "0.5"},
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    monkeypatch.setattr(metrics, "SUMMARY_JSON", json_path)
    monkeypatch.setattr(metrics, "SUMMARY_MD", md_path)
    monkeypatch.setattr(metrics, "SUMMARY_XLSX", xlsx_path)

    summary = metrics.compute_and_print(csv_path)

    assert summary["tp"] == 1
    assert summary["tn"] == 1
    assert summary["accuracy_percent"] == 100.0
    assert json_path.exists()
    assert md_path.exists()
    assert xlsx_path.exists()


def test_evaluation_metrics_deduplicates_rerun_rows(tmp_path, monkeypatch):
    evaluation_dir = Path(__file__).resolve().parents[1] / "evaluation"
    if str(evaluation_dir) not in sys.path:
        sys.path.insert(0, str(evaluation_dir))

    import metrics

    csv_path = tmp_path / "evaluation_results.csv"
    json_path = tmp_path / "summary.json"
    md_path = tmp_path / "summary.md"
    xlsx_path = tmp_path / "confusion_matrix_results.xlsx"
    fields = [
        "test_id", "scenario", "domain", "actual", "predicted", "result",
        "incident_id", "detection_id", "ai_score", "ai_prediction",
        "latency_seconds", "timestamp", "notes",
    ]
    rows = [
        {"test_id": "ATK-X", "scenario": "attack", "domain": "context", "actual": "attack", "predicted": "benign", "result": "FN", "latency_seconds": "1.5"},
        {"test_id": "BEN-X", "scenario": "benign", "domain": "context", "actual": "benign", "predicted": "benign", "result": "TN", "latency_seconds": "0.5"},
        # Re-run ATK-X now passes (TP)
        {"test_id": "ATK-X", "scenario": "attack", "domain": "context", "actual": "attack", "predicted": "attack", "result": "TP", "latency_seconds": "2.0"},
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    monkeypatch.setattr(metrics, "SUMMARY_JSON", json_path)
    monkeypatch.setattr(metrics, "SUMMARY_MD", md_path)
    monkeypatch.setattr(metrics, "SUMMARY_XLSX", xlsx_path)

    summary = metrics.compute_and_print(csv_path)

    assert summary["tp"] == 1
    assert summary["tn"] == 1
    assert summary["fn"] == 0
    assert summary["total"] == 2


def test_evaluation_scan_payload_forces_vm1_manual_scan(monkeypatch):
    evaluation_dir = Path(__file__).resolve().parents[1] / "evaluation"
    if str(evaluation_dir) not in sys.path:
        sys.path.insert(0, str(evaluation_dir))

    import evaluator

    calls = []
    monkeypatch.setattr(evaluator, "_last_scan_at", 0.0)
    monkeypatch.setattr(evaluator.time, "time", lambda: 10_000.0)
    monkeypatch.setattr(evaluator.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(evaluator, "api_post", lambda path, payload, headers=None: calls.append((path, payload, headers)) or {"detections": []})

    evaluator.trigger_scan_all()

    assert calls[0][0] == "/v1/scan/all"
    assert calls[0][1]["context"]["manual_scan"] is True
    assert calls[0][1]["context"]["force_full_registration"] is True


def test_evaluation_catalog_has_100_cases_and_no_outside_file_attack_paths():
    evaluation_dir = Path(__file__).resolve().parents[1] / "evaluation"
    if str(evaluation_dir) not in sys.path:
        sys.path.insert(0, str(evaluation_dir))

    import test_catalog

    cases = test_catalog.all_tests()
    ids = {case.test_id for case in cases}

    assert len(cases) == 100
    assert len(ids) == 100
    assert "ATK-F-10" in ids
    assert {"BEN-F-03", "BEN-F-04", "BEN-F-10"}.issubset(ids)
