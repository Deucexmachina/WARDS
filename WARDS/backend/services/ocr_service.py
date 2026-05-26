import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict

from dotenv import dotenv_values, load_dotenv
from PIL import Image
import requests


class OCRService:
    def __init__(self):
        self.engine_name = "llmwhisperer"
        self._ocr_backend_dir = self._resolve_ocr_backend_dir()
        self._output_dir = Path(__file__).resolve().parents[1] / "uploads" / "ocr_output"
        self._output_dir.mkdir(parents=True, exist_ok=True)
        self._api_key = None
        self._api_key_source = None
        self._base_url = None
        self._api_error = None
        self._api_checked = False

    def process_receipt(
        self,
        image_path: str,
        filename: str = "receipt",
        category: str = "RPT",
    ) -> Dict[str, Any]:
        category = self._normalize_category(category)
        if category not in {"RPT", "BUSINESS", "MISC"}:
            raise RuntimeError("Unsupported receipt category. Use RPT, BUSINESS, or MISC.")

        raw_text = self._extract_text_with_llmwhisperer(image_path)
        parsed = self._parse_receipt_text(raw_text, filename, category)
        category_analysis = self._detect_category_from_text(raw_text)
        parsed["success"] = True
        parsed["engine"] = self.engine_name
        parsed["message"] = "Receipt processed with LLMWhisperer. Please review before saving."
        parsed["tax_type"] = category
        parsed["selected_category"] = category
        parsed["detected_category"] = category_analysis["detected_category"]
        parsed["category_confidence"] = category_analysis["confidence"]
        parsed["category_match"] = category_analysis["detected_category"] == category
        parsed["category_evidence"] = category_analysis["evidence"]
        parsed["category_warning"] = (
            ""
            if parsed["category_match"]
            else (
                f"The uploaded receipt looks like a {category_analysis['detected_category']} receipt, "
                f"but {category} was selected."
            )
        )
        return parsed

    def _normalize_category(self, category: str | None) -> str:
        normalized = (category or "RPT").strip().upper()
        aliases = {
            "BT": "BUSINESS",
            "BUSINESS TAX": "BUSINESS",
            "MAYOR'S PERMIT": "BUSINESS",
            "MAYORS PERMIT": "BUSINESS",
            "MISCELLANEOUS": "MISC",
        }
        return aliases.get(normalized, normalized)

    def _resolve_ocr_backend_dir(self) -> Path | None:
        configured = os.getenv("OCR_PROJECT_DIR", "").strip()
        candidates = []

        if configured:
            configured_path = Path(configured).expanduser()
            candidates.append(configured_path)
            candidates.append(configured_path / "backend")

        desktop_sibling = Path(__file__).resolve().parents[3] / "OCR" / "backend"
        candidates.append(desktop_sibling)

        for candidate in candidates:
            if candidate.exists() and (candidate / "core").exists():
                return candidate
        return None

    def _load_llmwhisperer_config(self):
        if self._api_checked:
            return

        self._api_checked = True
        wards_env_path = Path(__file__).resolve().parents[1] / ".env"
        wards_env_values = dotenv_values(wards_env_path)
        wards_key = self._clean_env_value(wards_env_values.get("LLMWHISPERER_API_KEY"))
        wards_base_url = self._clean_env_value(wards_env_values.get("LLMWHISPERER_BASE_URL"))
        ocr_env_values = {}
        if self._ocr_backend_dir:
            load_dotenv(self._ocr_backend_dir / ".env", override=False)
            ocr_env_values = dotenv_values(self._ocr_backend_dir / ".env")

        ocr_key = self._clean_env_value(ocr_env_values.get("LLMWHISPERER_API_KEY"))
        env_key = self._clean_env_value(os.getenv("LLMWHISPERER_API_KEY"))
        if not self._looks_placeholder(wards_key):
            self._api_key = wards_key
            self._api_key_source = "WARDS/backend/.env"
        elif not self._looks_placeholder(ocr_key):
            self._api_key = ocr_key
            self._api_key_source = "OCR/backend/.env"
        elif not self._looks_placeholder(env_key):
            self._api_key = env_key
            self._api_key_source = "process environment"

        if not self._api_key:
            self._api_error = (
                "LLMWHISPERER_API_KEY is not configured. Set it in WARDS backend .env "
                "or point OCR_PROJECT_DIR to the OCR project backend."
            )
            return

        self._base_url = (
            wards_base_url
            or self._clean_env_value(ocr_env_values.get("LLMWHISPERER_BASE_URL"))
            or "https://llmwhisperer-api.us-central.unstract.com/api/v2"
        ).rstrip("/")

    def _clean_env_value(self, value: str | None) -> str:
        return (value or "").strip().strip('"').strip("'")

    def _looks_placeholder(self, value: str | None) -> bool:
        cleaned = self._clean_env_value(value)
        lowered = cleaned.lower()
        return (
            not cleaned
            or "replace-with" in lowered
            or "your-" in lowered
            or "your_" in lowered
            or cleaned in {"changeme", "change_this", "api_key", "llmwhisperer_api_key"}
        )

    def _key_fingerprint(self) -> str:
        if not self._api_key:
            return "none"
        if len(self._api_key) <= 8:
            return f"{self._api_key[:2]}...{len(self._api_key)} chars"
        return f"{self._api_key[:4]}...{self._api_key[-4:]} ({len(self._api_key)} chars)"

    def _unauthorized_message(self, stage: str = "starting OCR") -> str:
        source = self._api_key_source or "environment"
        return (
            f"LLMWhisperer rejected the API key loaded from {source} while {stage}. "
            f"Key fingerprint: {self._key_fingerprint()}. Check that the key is valid for "
            f"{self._base_url}, remove extra spaces or quotes, then restart the WARDS backend."
        )

    def _extract_text_with_llmwhisperer(self, image_path: str) -> str:
        self._load_llmwhisperer_config()
        if not self._api_key:
            raise RuntimeError(self._api_error or "LLMWhisperer configuration is unavailable.")

        pdf_path = self._image_to_pdf(image_path)
        headers = {
            "unstract-key": self._api_key,
            "Content-Type": "application/octet-stream",
        }
        base_url = self._base_url or "https://llmwhisperer-api.us-central.unstract.com/api/v2"
        params = {
            "mode": "form",
            "output_mode": "layout_preserving",
            "file_name": pdf_path.name,
        }

        try:
            with open(pdf_path, "rb") as pdf_file:
                whisper_start = requests.post(
                    f"{base_url}/whisper",
                    params=params,
                    headers=headers,
                    data=pdf_file.read(),
                    timeout=60,
            )
            if whisper_start.status_code == 401:
                raise RuntimeError(self._unauthorized_message("starting OCR"))
            whisper_start.raise_for_status()
            whisper_job = whisper_start.json()

            if whisper_job.get("status") == "processed":
                extraction = whisper_job.get("extraction") or {}
                return (extraction.get("result_text") or "").strip()

            whisper_hash = whisper_job.get("whisper_hash")
            if not whisper_hash:
                raise RuntimeError("LLMWhisperer did not return a whisper_hash.")

            deadline = time.time() + 200
            status_payload = {}
            while time.time() < deadline:
                status_response = requests.get(
                    f"{base_url}/whisper-status",
                    params={"whisper_hash": whisper_hash},
                    headers={"unstract-key": self._api_key},
                    timeout=30,
                )
                if status_response.status_code == 401:
                    raise RuntimeError(self._unauthorized_message("checking OCR status"))
                status_response.raise_for_status()
                status_payload = status_response.json()
                status = (status_payload.get("status") or "").lower()

                if status == "processed":
                    break
                if status == "error":
                    raise RuntimeError(status_payload.get("message") or "LLMWhisperer reported an OCR error.")

                time.sleep(2)
            else:
                raise RuntimeError("Timed out waiting for LLMWhisperer OCR to finish.")

            retrieve_response = requests.get(
                f"{base_url}/whisper-retrieve",
                params={"whisper_hash": whisper_hash},
                headers={"unstract-key": self._api_key},
                timeout=60,
            )
            if retrieve_response.status_code == 401:
                raise RuntimeError(self._unauthorized_message("retrieving OCR output"))
            retrieve_response.raise_for_status()
            whisper = retrieve_response.json()
        except Exception as exc:
            raise RuntimeError(f"LLMWhisperer OCR failed: {exc}") from exc

        whisper_dump = self._output_dir / "whisperer.json"
        try:
            whisper_dump.write_text(json.dumps(whisper, indent=2), encoding="utf-8")
        except Exception:
            pass

        extraction = whisper.get("extraction") or whisper
        return (extraction.get("result_text") or "").strip()

    def _image_to_pdf(self, image_path: str) -> Path:
        base_name = Path(image_path).stem
        pdf_path = self._output_dir / f"{base_name}.pdf"

        with Image.open(image_path) as image:
            if image.mode != "RGB":
                image = image.convert("RGB")
            image.save(pdf_path, "PDF", resolution=300)

        return pdf_path

    def _parse_receipt_text(self, text: str, filename: str, category: str) -> Dict[str, Any]:
        fallback_source = f"{filename}\n{text}".strip()

        ref_number = self._clean_reference_value(self._extract_reference_value(fallback_source, category))
        taxpayer_name = self._extract_taxpayer_name(fallback_source, category)
        transaction_date = self._normalize_transaction_date(self._extract_transaction_date(fallback_source))
        amount = self._extract_amount(fallback_source, category)

        confidence = 0.45 if text else 0.0
        populated_fields = sum(
            1 for value in [ref_number, taxpayer_name, transaction_date, amount] if value not in ("", None)
        )
        if text:
            confidence = min(0.97, 0.55 + (populated_fields * 0.08))

        return {
            "ref_number": ref_number or "",
            "txn_id": ref_number or "",
            "taxpayer_name": taxpayer_name,
            "transaction_date": transaction_date,
            "amount": amount,
            "raw_text": text,
            "confidence": round(confidence, 2),
        }

    def _detect_category_from_text(self, text: str) -> Dict[str, Any]:
        normalized = text.upper()
        category_signals = {
            "RPT": [
                "REAL PROPERTY TAX",
                "PROPERTY TAX",
                "LAND TAX",
                "ASSESSED VALUE",
                "TAX DECLARATION",
                "ARP NO",
                "PIN NO",
                "MACHINE VALIDATION NO",
                "BILL NUMBER",
            ],
            "BUSINESS": [
                "BUSINESS TAX",
                "MAYOR'S PERMIT",
                "BUSINESS PERMIT",
                "PERMIT NO",
                "PERMIT NUMBER",
                "BUSINESS NAME",
                "GROSS SALES",
                "GROSS RECEIPTS",
                "LINE OF BUSINESS",
            ],
            "MISC": [
                "MISCELLANEOUS",
                "OTHER FEES",
                "CLEARANCE",
                "CERTIFICATION",
                "DOCUMENTARY",
                "SERVICE FEE",
                "REGISTRATION FEE",
                "COMMUNITY TAX",
            ],
        }

        scores: dict[str, int] = {}
        evidence: dict[str, list[str]] = {}
        for category, signals in category_signals.items():
            matched_signals = [signal for signal in signals if signal in normalized]
            evidence[category] = matched_signals[:5]
            scores[category] = len(matched_signals)

        ref_text = self._extract_reference_value(normalized, "RPT")
        if ref_text.startswith("R-"):
            scores["RPT"] += 2
            evidence["RPT"].append("R-prefixed reference")

        if re.search(r"\b\d{2}-\d{6}\b", normalized):
            scores["BUSINESS"] += 2
            evidence["BUSINESS"].append("Permit number format")

        if "MISC" in normalized and "BUSINESS" not in normalized and "PROPERTY" not in normalized:
            scores["MISC"] += 1
            evidence["MISC"].append("MISC keyword")

        detected_category = max(scores, key=scores.get)
        max_score = scores[detected_category]
        if max_score <= 0:
            detected_category = "MISC"

        confidence = 0.45
        if max_score >= 4:
            confidence = 0.95
        elif max_score == 3:
            confidence = 0.86
        elif max_score == 2:
            confidence = 0.75
        elif max_score == 1:
            confidence = 0.62

        return {
            "detected_category": detected_category,
            "confidence": round(confidence, 2),
            "evidence": evidence.get(detected_category, []),
        }

    def _extract_reference_value(self, text: str, category: str) -> str:
        if category == "RPT":
            return self._match(
                [
                    r"(?:bil(?:l)?\s*number)[:#\s-]*([A-Z0-9-]{8,})",
                    r"\b(R-\d{4}-\d{2,4}-\d{2,8}-[A-Z0-9]+)\b",
                    r"\b(R-\d{4}-\d{2,4}-\d{2,8})\b",
                    r"(?:machine\s*validation\s*no\.?)[:#\s-]*([A-Z0-9-]{10,})",
                ],
                text,
            )

        if category == "BUSINESS":
            return self._match(
                [
                    r"\b(\d{2}-\d{6})\b",
                    r"(?:mayor'?s?\s*permit(?:\s*no\.?)?)[:#\s-]*([A-Z0-9-]{6,})",
                ],
                text,
            )

        return self._match(
            [
                r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+([0-9]{5,}\s*[A-Z]?)\b",
                r"(?:official\s*receipt\s*)?(?:no\.?|number|n[o0]?)\s*[:#\s-]*([0-9]{5,}\s*[A-Z]?)\b",
                r"(?:machine\s*validation\s*no\.?)[:#\s-]*([A-Z0-9-]{10,})",
                r"(?:reference\s*(?:no\.?|number)?)[:#\s-]*([A-Z0-9-]{6,})",
                r"\b([A-Z]-\d{3}-\d{5})\b",
            ],
            text,
        )

    def _extract_taxpayer_name(self, text: str, category: str) -> str:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        stop_words = (
            "NATURE OF COLLECTION",
            "FUND",
            "ACCOUNT",
            "AMOUNT",
            "CODE",
            "TOTAL",
            "DATE",
        )
        name_labels = r"payor|payor'?s?|payer|pavor|payr|taxpayer|received\s*from|name"

        for index, line in enumerate(lines):
            if re.search(rf"\b({name_labels})\b", line, re.IGNORECASE):
                candidate = re.sub(rf"(?i).*\b({name_labels})\b[:#\s-]*", "", line).strip()
                if not self._looks_like_person_name(candidate):
                    for next_line in lines[index + 1:index + 4]:
                        candidate = next_line.strip()
                        if self._looks_like_person_name(candidate):
                            break

                candidate = re.sub(r"\s{2,}", " ", candidate).strip(" -:")
                upper_candidate = candidate.upper()
                for word in stop_words:
                    cut_index = upper_candidate.find(word)
                    if cut_index != -1:
                        candidate = candidate[:cut_index].strip()
                        break

                if category == "BUSINESS":
                    candidate = re.sub(r"^\d{2}-\d{6}\s+", "", candidate).strip()

                candidate = self._clean_name_candidate(candidate)
                if candidate:
                    return candidate.title()

        fallback = self._match(
            [
                r"\b([A-Z][A-Z\s,.'-]{5,})\b",
            ],
            text.upper(),
        )
        fallback = self._clean_name_candidate(fallback)
        return fallback.title() if fallback else ""

    def _extract_transaction_date(self, text: str) -> str:
        return self._match(
            [
                r"\b(\d{1,2}/\d{1,2}/\d{4})\b",
                r"\b(\d{1,2}/\d{1,2}/\d{2})\b",
                r"\b(\d{1,2}-\d{1,2}-\d{4})\b",
                r"\b(\d{1,2}-\d{1,2}-\d{2})\b",
                r"\b(\d{4}/\d{1,2}/\d{1,2})\b",
                r"\b(\d{4}-\d{1,2}-\d{1,2})\b",
            ],
            text,
        )

    def _extract_amount(self, text: str, category: str) -> float | None:
        explicit_total = self._match(
            [
                r"(?:GRANDTOTAL|GRAND\s*TOTAL)[^0-9]{0,200}([0-9][0-9,]*\.[0-9]{2})",
                r"(?:SUBTOTAL|SUB\s*TOTAL)[^0-9]{0,200}([0-9][0-9,]*\.[0-9]{2})",
                r"(?:AMOUNT\s*PAID)[^0-9]{0,10}([0-9][0-9,]*\.[0-9]{2})",
            ],
            text.upper(),
        )
        if explicit_total:
            return self._safe_float(explicit_total)

        if category == "RPT":
            line_item_amounts = []
            for line in text.splitlines():
                line = line.strip()
                if not line or not re.search(r"\d+\.\d{2}", line):
                    continue
                if re.search(r"(BASIC|FUND|TAX|DISCOUNT|PENALTY|FEE|CREDIT)", line, re.IGNORECASE):
                    match = re.search(r"([0-9][0-9,]*\.[0-9]{2})\s*$", line)
                    if match:
                        value = self._safe_float(match.group(1))
                        if value is not None:
                            if re.search(r"(DISCOUNT|CREDIT)", line, re.IGNORECASE):
                                value *= -1
                            line_item_amounts.append(value)
            if line_item_amounts:
                return round(sum(line_item_amounts), 2)

        if category == "MISC":
            misc_amounts = self._extract_misc_amounts(text)
            if misc_amounts:
                return max(misc_amounts)

        generic_amounts = [
            self._safe_float(match)
            for match in re.findall(r"\b([0-9][0-9,]*\.[0-9]{2})\b", text)
        ]
        generic_amounts = [value for value in generic_amounts if value is not None]
        if generic_amounts:
            return max(generic_amounts)
        return None

    def _extract_misc_amounts(self, text: str) -> list[float]:
        amounts: list[float] = []
        for line in text.splitlines():
            upper_line = line.upper()
            if re.search(r"\b(DATE|NO\.?|NUMBER|FORM|REVISED|ACCOUNTABLE)\b", upper_line):
                continue
            if not re.search(r"(AMOUNT|TOTAL|PESO|PHP|₱|\bP\s*[0-9])", upper_line):
                continue
            for match in re.findall(r"(?:PHP|P|₱)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*-?", line, re.IGNORECASE):
                value = self._safe_float(match)
                if value is not None and 0 < value < 1000000:
                    amounts.append(round(value, 2))

        if amounts:
            return amounts

        return [
            round(value, 2)
            for value in (
                self._safe_float(match)
                for match in re.findall(r"(?:PHP|P|₱)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)", text, re.IGNORECASE)
            )
            if value is not None and 0 < value < 1000000
        ]

    def _clean_name_candidate(self, value: str | None) -> str:
        candidate = re.sub(r"[^A-Za-zÀ-ÿ,.' -]", " ", value or "")
        candidate = re.sub(r"\s{2,}", " ", candidate).strip(" ,.-:")
        if not self._looks_like_person_name(candidate):
            return ""
        return candidate

    def _looks_like_person_name(self, value: str | None) -> bool:
        candidate = re.sub(r"\s{2,}", " ", value or "").strip(" -:")
        if len(candidate) < 4 or not re.search(r"[A-Za-z]", candidate):
            return False
        upper_candidate = candidate.upper()
        blocked_fragments = (
            "OFFICIAL RECEIPT",
            "REPUBLIC",
            "QUEZON CITY",
            "OFFICE OF THE TREASURER",
            "NATURE OF COLLECTION",
            "AMOUNT",
            "FUND",
            "ACCOUNT",
            "CODE",
            "TRIPLICATE",
            "ACCOUNTABLE FORM",
            "REVISED",
            "PAYOR",
            "PAYER",
        )
        if any(fragment in upper_candidate for fragment in blocked_fragments):
            return False
        letters = re.sub(r"[^A-Za-zÀ-ÿ]", "", candidate)
        return len(letters) >= 4

    def _safe_float(self, value: str | None) -> float | None:
        if not value:
            return None
        try:
            return float(value.replace(",", ""))
        except ValueError:
            return None

    def _clean_reference_value(self, value: str | None) -> str:
        candidate = re.sub(r"\s+", " ", value or "").strip()
        match = re.fullmatch(r"([0-9]{5,})\s+([A-Z])", candidate, re.IGNORECASE)
        if match:
            return f"{match.group(1)} {match.group(2).upper()}"
        return candidate

    def _normalize_transaction_date(self, value: str) -> str:
        if not value:
            return ""

        separator = "/" if "/" in value else "-"
        parts = value.split(separator)
        if len(parts) != 3:
            return value

        month_raw, day_raw, year_raw = parts
        if not (month_raw.isdigit() and day_raw.isdigit() and year_raw.isdigit()):
            return value

        month = int(month_raw)
        day = int(day_raw)
        year = int(year_raw)

        if month == 90:
            month = 1

        if year < 100:
            year += 2000

        if 1 <= month <= 12 and 1 <= day <= 31:
            return f"{month:02d}/{day:02d}/{year:04d}"

        return value

    def _match(self, patterns, text: str) -> str:
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1).strip()
        return ""


ocr_service = OCRService()
