from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_config import FINAL_CLEANUP_ENABLED, RESULTS_CSV, VM1_DIRECT_MANIFEST, validate_required
from evaluator import cleanup_after_evaluation, list_vm1_database_backups, print_diagnostics, run_test, vm1_manifest_for_targets, wait_for_vm1_targets
from metrics import compute_and_print
from test_catalog import all_tests


def main() -> None:
    parser = argparse.ArgumentParser(description="Run WARDS confusion-matrix evaluation.")
    parser.add_argument("--only", action="append", default=[], help="Run only the given test id. Can be repeated.")
    parser.add_argument("--domain", action="append", default=[], help="Run only a domain such as application_files, context, ai_ml_assets, vm1_database.")
    parser.add_argument("--actual", choices=["attack", "benign"], help="Run only attack or benign cases.")
    parser.add_argument("--fresh", action="store_true", help="Delete the previous CSV before running.")
    parser.add_argument("--list", action="store_true", help="List registered tests and exit.")
    parser.add_argument("--diagnose", action="store_true", help="Print VM1 reporter/baseline diagnostics and exit.")
    parser.add_argument("--skip-preflight", action="store_true", help="Skip VM1 baseline preflight for file attack cases.")
    parser.add_argument("--cleanup-only", action="store_true", help="Restore evaluation file backups, remove scratch files, reset deployed code, rebuild containers, then exit.")
    parser.add_argument("--skip-final-cleanup", action="store_true", help="Do not run post-evaluation cleanup.")
    parser.add_argument("--no-cleanup-rebuild", action="store_true", help="During cleanup, restore/reset files but do not rebuild containers.")
    parser.add_argument("--no-cleanup-git-reset", action="store_true", help="During cleanup, do not git reset deployed source to origin/main.")
    parser.add_argument("--restore-vm1-db", action="store_true", help="During cleanup, restore VM1 MySQL from the newest completed VM1 database backup.")
    parser.add_argument("--list-vm1-db-backups", action="store_true", help="List VM1 database backup rows and dump files, then exit.")
    args = parser.parse_args()

    tests = all_tests()
    if args.list:
        for case in tests:
            print(f"{case.test_id}\t{case.actual}\t{case.domain}\t{case.scenario}")
        print(f"Total: {len(tests)}")
        return

    validate_required()
    if args.list_vm1_db_backups:
        print(list_vm1_database_backups())
        return
    if args.cleanup_only:
        notes = cleanup_after_evaluation(
            git_reset=not args.no_cleanup_git_reset,
            rebuild=not args.no_cleanup_rebuild,
            restore_vm1_db=args.restore_vm1_db,
        )
        print("Cleanup complete:")
        for note in notes:
            print(f"  - {note}")
        return
    selected = tests
    if args.only:
        allowed = set(args.only)
        selected = [case for case in selected if case.test_id in allowed]
    if args.domain:
        allowed_domains = set(args.domain)
        selected = [case for case in selected if case.domain in allowed_domains]
    if args.actual:
        selected = [case for case in selected if case.actual == args.actual]
    if args.diagnose:
        print_diagnostics(selected)
        return
    file_attack_targets = sorted(
        {
            str(case.target_hint or "").replace("\\", "/").strip("/")
            for case in selected
            if case.domain == "application_files" and case.actual == "attack" and case.target_hint
        }
    )
    if file_attack_targets and not args.skip_preflight:
        if VM1_DIRECT_MANIFEST:
            vm1_manifest_for_targets(file_attack_targets)
        missing, _files = wait_for_vm1_targets(file_attack_targets)
        if missing:
            print("VM1 baseline preflight failed. Missing monitored baseline(s):")
            for target in missing:
                print(f"  - {target}")
            print("Run with --diagnose for reporter status, or --skip-preflight to run anyway.")
            raise SystemExit(2)
    if args.fresh and RESULTS_CSV.exists():
        RESULTS_CSV.unlink()

    print(f"Running {len(selected)} of {len(tests)} registered tests")
    try:
        for case in selected:
            run_test(case)
    finally:
        if FINAL_CLEANUP_ENABLED and not args.skip_final_cleanup:
            print("Running final evaluation cleanup...")
            notes = cleanup_after_evaluation(
                git_reset=not args.no_cleanup_git_reset,
                rebuild=not args.no_cleanup_rebuild,
                restore_vm1_db=args.restore_vm1_db,
            )
            for note in notes:
                print(f"  - {note}")
    compute_and_print()


if __name__ == "__main__":
    main()
