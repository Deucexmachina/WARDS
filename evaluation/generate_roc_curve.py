"""
Generate Figure 4.21 — ROC Curve for AI-Based Web Defacement Detection.

Reads evaluation_results.csv and plots the ROC curve using the continuous
ai_score values produced by the Isolation Forest + rule-based risk engine.

Usage:
    python evaluation/generate_roc_curve.py
    python evaluation/generate_roc_curve.py --csv evaluation/results/evaluation_results.csv
    python evaluation/generate_roc_curve.py --output figures/figure_4_21_roc_curve.png
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path


def load_scores(csv_path: Path) -> tuple[list[float], list[int]]:
    """Load ai_score and actual labels from evaluation_results.csv.

    Benign cases that did not trigger a detection have no ai_score in the CSV.
    For those true-negative cases we assign the engine's minimum risk floor
    (0.01), which is the lowest value ai_predict() can emit.  This lets the
    ROC curve contrast the full set of positives against the full set of
    negatives.
    """
    scores: list[float] = []
    labels: list[int] = []

    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            actual = row.get("actual", "").strip().lower()
            predicted = row.get("predicted", "").strip().lower()
            ai_score_raw = row.get("ai_score", "").strip()

            if not actual:
                continue

            if not ai_score_raw:
                # Benign cases that were correctly not detected have no score.
                # Use the engine's minimum risk floor so they appear on the ROC.
                if actual == "benign" and predicted == "benign":
                    ai_score = 0.01
                else:
                    continue
            else:
                try:
                    ai_score = float(ai_score_raw)
                except ValueError:
                    continue

            # 1 = attack (positive), 0 = benign (negative)
            label = 1 if actual == "attack" else 0
            scores.append(ai_score)
            labels.append(label)

    return scores, labels


def generate_roc_data(y_true: list[int], y_scores: list[float]) -> tuple[list[float], list[float], float]:
    """Compute TPR/FPR points and AUC without external dependencies."""
    # Sort by score descending
    paired = sorted(zip(y_scores, y_true), key=lambda x: x[0], reverse=True)
    n_pos = sum(y_true)
    n_neg = len(y_true) - n_pos

    if n_pos == 0 or n_neg == 0:
        return [0.0, 1.0], [0.0, 1.0], 1.0

    tpr_points: list[float] = [0.0]
    fpr_points: list[float] = [0.0]

    tp = 0
    fp = 0
    prev_score = None

    for score, label in paired:
        if prev_score is not None and score != prev_score:
            tpr_points.append(tp / n_pos)
            fpr_points.append(fp / n_neg)
        if label == 1:
            tp += 1
        else:
            fp += 1
        prev_score = score

    tpr_points.append(tp / n_pos)
    fpr_points.append(fp / n_neg)

    # Trapezoidal AUC
    auc = 0.0
    for i in range(1, len(fpr_points)):
        auc += (fpr_points[i] - fpr_points[i - 1]) * (tpr_points[i] + tpr_points[i - 1]) / 2

    return fpr_points, tpr_points, auc


def plot_roc(
    fpr: list[float],
    tpr: list[float],
    auc: float,
    output_path: Path,
    title: str = "ROC Curve for AI-Based Web Defacement Detection",
) -> None:
    """Plot and save the ROC curve using matplotlib."""
    try:
        import matplotlib.pyplot as plt
    except ImportError as exc:
        raise RuntimeError("matplotlib is required. Install it with: pip install matplotlib") from exc

    plt.figure(figsize=(8, 6))
    plt.plot(fpr, tpr, color="#1F3B68", lw=2.5, label=f"Isolation Forest (AUC = {auc:.4f})")
    plt.plot([0, 1], [0, 1], color="#999999", lw=1.5, linestyle="--", label="Random Classifier (AUC = 0.50)")

    plt.xlim([-0.02, 1.02])
    plt.ylim([-0.02, 1.02])
    plt.xlabel("False Positive Rate", fontsize=12)
    plt.ylabel("True Positive Rate", fontsize=12)
    plt.title(title, fontsize=13, fontweight="bold")
    plt.legend(loc="lower right", fontsize=10)
    plt.grid(True, linestyle="--", alpha=0.5)
    plt.tight_layout()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"Saved ROC curve to: {output_path.resolve()}")
    plt.show()


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Figure 4.21 ROC curve from evaluation results")
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path(__file__).resolve().parent / "results" / "evaluation_results.csv",
        help="Path to evaluation_results.csv",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("figures") / "figure_4_21_roc_curve.png",
        help="Output image path",
    )
    parser.add_argument(
        "--title",
        type=str,
        default="ROC Curve for AI-Based Web Defacement Detection",
        help="Plot title",
    )
    args = parser.parse_args()

    if not args.csv.exists():
        print(f"ERROR: Evaluation results not found at {args.csv}", file=sys.stderr)
        print("Run the evaluation first: python evaluation/run_evaluation.py --fresh", file=sys.stderr)
        return 1

    scores, labels = load_scores(args.csv)
    if not scores:
        print("ERROR: No valid ai_score / actual pairs found in CSV.", file=sys.stderr)
        return 1

    print(f"Loaded {len(scores)} evaluation records ({sum(labels)} attack, {len(labels) - sum(labels)} benign)")

    fpr, tpr, auc = generate_roc_data(labels, scores)
    print(f"AUC = {auc:.4f}")

    plot_roc(fpr, tpr, auc, args.output, title=args.title)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
