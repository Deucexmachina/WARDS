from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_config import RESULTS_CSV, validate_required
from evaluator import run_test
from metrics import compute_and_print
from test_catalog import all_tests


def main() -> None:
    parser = argparse.ArgumentParser(description="Run WARDS confusion-matrix evaluation.")
    parser.add_argument("--only", action="append", default=[], help="Run only the given test id. Can be repeated.")
    parser.add_argument("--domain", action="append", default=[], help="Run only a domain such as application_files, context, ai_ml_assets, vm1_database.")
    parser.add_argument("--actual", choices=["attack", "benign"], help="Run only attack or benign cases.")
    parser.add_argument("--fresh", action="store_true", help="Delete the previous CSV before running.")
    parser.add_argument("--list", action="store_true", help="List registered tests and exit.")
    args = parser.parse_args()

    tests = all_tests()
    if args.list:
        for case in tests:
            print(f"{case.test_id}\t{case.actual}\t{case.domain}\t{case.scenario}")
        print(f"Total: {len(tests)}")
        return

    validate_required()
    selected = tests
    if args.only:
        allowed = set(args.only)
        selected = [case for case in selected if case.test_id in allowed]
    if args.domain:
        allowed_domains = set(args.domain)
        selected = [case for case in selected if case.domain in allowed_domains]
    if args.actual:
        selected = [case for case in selected if case.actual == args.actual]
    if args.fresh and RESULTS_CSV.exists():
        RESULTS_CSV.unlink()

    print(f"Running {len(selected)} of {len(tests)} registered tests")
    for case in selected:
        run_test(case)
    compute_and_print()


if __name__ == "__main__":
    main()
