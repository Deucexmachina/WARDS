import json
import os
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from dotenv import dotenv_values, load_dotenv
from PIL import Image
import requests


class OCRProcessingError(RuntimeError):
    """Raised when OCR cannot complete within the configured safety limits."""


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
        self._config_lock = threading.Lock()
        self._request_connect_timeout = self._env_int("OCR_REQUEST_CONNECT_TIMEOUT_SECONDS", 10)
        self._request_read_timeout = self._env_int("OCR_REQUEST_READ_TIMEOUT_SECONDS", 30)
        self._start_timeout = self._env_int("OCR_START_TIMEOUT_SECONDS", 45)
        self._retrieve_timeout = self._env_int("OCR_RETRIEVE_TIMEOUT_SECONDS", 45)
        self._poll_interval = max(1, self._env_int("OCR_POLL_INTERVAL_SECONDS", 2))
        self._poll_timeout = self._env_int("OCR_TOTAL_TIMEOUT_SECONDS", 120)

    def process_receipt(
        self,
        image_path: str,
        filename: str = "receipt",
        category: str = "RPT",
    ) -> Dict[str, Any]:
        category = self._normalize_category(category)
        if category not in {"RPT", "BUSINESS", "MISC", "PTR", "MARKET"}:
            raise RuntimeError("Unsupported receipt category. Use RPT, BUSINESS, MISC, PTR, or MARKET.")

        raw_text = self._extract_text_with_llmwhisperer(image_path)
        parsed = self._parse_receipt_text(raw_text, filename, category)
        category_analysis = self._detect_category_from_text(raw_text)
        color_hint = self._detect_category_from_image(image_path)
        if category == "MISC" and color_hint.get("detected_category") == "MISC":
            category_analysis = color_hint
        elif color_hint.get("detected_category") == "MISC" and category_analysis.get("detected_category") == "UNKNOWN":
            category_analysis = color_hint
        elif category == "MISC" and category_analysis.get("detected_category") == "MISC" and color_hint.get("detected_category") != "MISC":
            category_analysis = {
                "detected_category": "PTR",
                "confidence": max(category_analysis.get("confidence", 0.0), 0.82),
                "evidence": ["Receipt lacks the MISC color signature"],
            }
        if category == "MARKET" and category_analysis.get("detected_category") == "UNKNOWN":
            if any(parsed.get(key) for key in ("taxpayer_name", "transaction_date", "market_purpose_of_renewal", "market_valid_until")):
                category_analysis = {
                    "detected_category": "MARKET",
                    "confidence": 0.82,
                    "evidence": ["Market certificate field matches"],
                }
        elif category == "PTR" and category_analysis.get("detected_category") == "UNKNOWN":
            receipt_number = (parsed.get("receipt_number") or parsed.get("ref_number") or parsed.get("txn_id") or "").strip()
            fallback_text = f"{raw_text}\n{filename}".upper()
            if (
                receipt_number
                and re.search(r"\bOFFICIAL\s+RECEIPT\b", fallback_text)
                and (
                    re.search(r"\bPAYOR\b", fallback_text)
                    or re.search(r"\bOFFICE\s+OF\s+THE\s+TREASURER\b", fallback_text)
                    or re.search(r"\bDATE\b", fallback_text)
                )
            ):
                category_analysis = {
                    "detected_category": "PTR",
                    "confidence": 0.82,
                    "evidence": ["Official receipt layout with receipt number"],
                }
        if category == "RPT" and category_analysis.get("detected_category") in {"UNKNOWN", "PTR", "MISC"}:
            if self._looks_like_rpt_receipt(raw_text, filename, parsed):
                category_analysis = {
                    "detected_category": "RPT",
                    "confidence": max(category_analysis.get("confidence", 0.0), 0.88),
                    "evidence": ["RPT bill and machine-validation receipt layout"],
                }
        elif category == "PTR" and category_analysis.get("detected_category") in {"UNKNOWN", "MISC", "RPT"}:
            if self._looks_like_ptr_receipt(raw_text, filename, parsed):
                category_analysis = {
                    "detected_category": "PTR",
                    "confidence": max(category_analysis.get("confidence", 0.0), 0.88),
                    "evidence": ["Official receipt PTR layout"],
                }
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
                "This looks like a Different recipt"
            )
        )
        return parsed

    def analyze_receipt_category_only(self, image_path: str) -> Dict[str, Any]:
        try:
            raw_text = self._extract_text_with_llmwhisperer(image_path)
        except Exception:
            raw_text = ""

        category_analysis = self._detect_category_from_text(raw_text)
        image_hint = self._detect_category_from_image(image_path)

        if image_hint.get("detected_category") == "MISC":
            category_analysis = image_hint
        elif category_analysis.get("detected_category") == "MISC":
            category_analysis = {
                "detected_category": "PTR",
                "confidence": max(category_analysis.get("confidence", 0.0), 0.82),
                "evidence": ["Receipt lacks the MISC color signature"],
            }
        elif category_analysis.get("detected_category") == "UNKNOWN" and image_hint.get("detected_category") != "UNKNOWN":
            category_analysis = image_hint

        return {
            "detected_category": category_analysis.get("detected_category", "UNKNOWN"),
            "confidence": category_analysis.get("confidence", 0.0),
            "evidence": category_analysis.get("evidence", []),
            "raw_text": raw_text,
        }

    def _looks_like_rpt_receipt(self, raw_text: str, filename: str, parsed: Dict[str, Any]) -> bool:
        lookup = f"{filename}\n{raw_text}".upper()
        reference_values = [
            (parsed.get("receipt_number") or "").strip().upper(),
            (parsed.get("ref_number") or "").strip().upper(),
            (parsed.get("txn_id") or "").strip().upper(),
        ]
        rpt_markers = sum(
            1
            for marker in (
                "REAL PROPERTY TAX",
                "PROPERTY TAX",
                "MACHINE VALIDATION NO",
                "BILL NUMBER",
                "COMPUTERIZED OFFICIAL RECEIPT",
                "SOCIALIZED HOUSING TAX",
                "IDLE LAND TAX",
            )
            if marker in lookup
        )
        r_prefixed_reference = any(value.startswith("R-") for value in reference_values if value)
        has_machine_validation_and_bill = "MACHINE VALIDATION NO" in lookup and "BILL NUMBER" in lookup
        has_rpt_amount_line = any(marker in lookup for marker in ("BASIC TAX", "LAND TAX", "SH GARBAGE FEE"))

        return (
            has_machine_validation_and_bill
            or (r_prefixed_reference and rpt_markers >= 1)
            or (rpt_markers >= 2 and has_rpt_amount_line)
        )

    def _looks_like_ptr_receipt(self, raw_text: str, filename: str, parsed: Dict[str, Any]) -> bool:
        lookup = f"{filename}\n{raw_text}".upper()
        receipt_identifier = (
            (parsed.get("receipt_number") or parsed.get("ref_number") or parsed.get("txn_id") or "")
            .strip()
            .upper()
        )
        ptr_signals = sum(
            1
            for marker in (
                "OFFICIAL RECEIPT",
                "ACCOUNTABLE FORM NO. 51",
                "PAYOR",
                "OFFICE OF THE TREASURER",
                "CITY TREASURER",
            )
            if marker in lookup
        )
        has_ptr_number = bool(receipt_identifier and re.search(r"\d{5,}", receipt_identifier))
        return ptr_signals >= 3 and has_ptr_number

    def _detect_category_from_image(self, image_path: str) -> Dict[str, Any]:
        try:
            with Image.open(image_path) as image:
                rgb = image.convert("RGB")
                rgb.thumbnail((96, 96))
                pixels = list(rgb.getdata())
        except Exception:
            return {"detected_category": "UNKNOWN", "confidence": 0.0, "evidence": []}

        if not pixels:
            return {"detected_category": "UNKNOWN", "confidence": 0.0, "evidence": []}

        red = sum(pixel[0] for pixel in pixels) / len(pixels)
        green = sum(pixel[1] for pixel in pixels) / len(pixels)
        blue = sum(pixel[2] for pixel in pixels) / len(pixels)
        green_dominant_pixels = sum(1 for r, g, b in pixels if g > r + 6 and g > b + 2)
        cool_tinted_pixels = sum(1 for r, g, b in pixels if r + 8 < g and r + 8 < b)
        green_ratio = green_dominant_pixels / len(pixels)
        cool_tint_ratio = cool_tinted_pixels / len(pixels)
        green_dominant = (
            green_ratio >= 0.12
            and green > red + 4
            and green > blue + 2
        )
        cool_tinted = (
            cool_tint_ratio >= 0.12
            and green > red + 8
            and blue > red + 8
        )

        if green_dominant or cool_tinted:
            return {
                "detected_category": "MISC",
                "confidence": 0.96,
                "evidence": ["Green/cool-tinted receipt layout"],
            }

        return {"detected_category": "UNKNOWN", "confidence": 0.0, "evidence": []}

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

        with self._config_lock:
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

    def _env_int(self, name: str, default: int) -> int:
        try:
            return max(1, int(os.getenv(name, str(default))))
        except ValueError:
            return default

    def _request_timeout(self, read_timeout: int | None = None) -> tuple[int, int]:
        return (self._request_connect_timeout, read_timeout or self._request_read_timeout)

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
        whisper = {}
        try:
            started_at = time.monotonic()
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
            with open(pdf_path, "rb") as pdf_file:
                whisper_start = requests.post(
                    f"{base_url}/whisper",
                    params=params,
                    headers=headers,
                    data=pdf_file.read(),
                    timeout=self._request_timeout(self._start_timeout),
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

            deadline = time.monotonic() + self._poll_timeout
            status_payload = {}
            with requests.Session() as session:
                while time.monotonic() < deadline:
                    status_response = session.get(
                        f"{base_url}/whisper-status",
                        params={"whisper_hash": whisper_hash},
                        headers={"unstract-key": self._api_key},
                        timeout=self._request_timeout(),
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

                    remaining = deadline - time.monotonic()
                    time.sleep(min(self._poll_interval, max(0.1, remaining)))
                else:
                    elapsed = int(time.monotonic() - started_at)
                    raise OCRProcessingError(f"Timed out waiting for LLMWhisperer OCR after {elapsed} seconds.")

                retrieve_response = session.get(
                    f"{base_url}/whisper-retrieve",
                    params={"whisper_hash": whisper_hash},
                    headers={"unstract-key": self._api_key},
                    timeout=self._request_timeout(self._retrieve_timeout),
                )
                if retrieve_response.status_code == 401:
                    raise RuntimeError(self._unauthorized_message("retrieving OCR output"))
                retrieve_response.raise_for_status()
                whisper = retrieve_response.json()
        except requests.Timeout as exc:
            raise OCRProcessingError("LLMWhisperer OCR request timed out. Please try again with a clearer or smaller image.") from exc
        except OCRProcessingError:
            raise
        except Exception as exc:
            raise OCRProcessingError(f"LLMWhisperer OCR failed: {exc}") from exc
        finally:
            if pdf_path.exists():
                try:
                    pdf_path.unlink()
                except OSError:
                    pass

        whisper_dump = self._output_dir / f"whisperer_{uuid.uuid4().hex}.json"
        try:
            whisper_dump.write_text(json.dumps(whisper, indent=2), encoding="utf-8")
        except Exception:
            pass

        extraction = whisper.get("extraction") or whisper
        return (extraction.get("result_text") or "").strip()

    def _image_to_pdf(self, image_path: str) -> Path:
        base_name = Path(image_path).stem
        pdf_path = self._output_dir / f"{base_name}_{uuid.uuid4().hex}.pdf"

        with Image.open(image_path) as image:
            if image.mode != "RGB":
                image = image.convert("RGB")
            image.save(pdf_path, "PDF", resolution=300)

        return pdf_path

    def _parse_receipt_text(self, text: str, filename: str, category: str) -> Dict[str, Any]:
        if category == "MARKET":
            return self._parse_market_certificate_text(text, filename)
        fallback_source = f"{filename}\n{text}".strip()

        receipt_number = self._clean_reference_value(self._extract_receipt_number(fallback_source))
        txn_id = self._clean_reference_value(self._extract_machine_validation_number(fallback_source))
        ref_number = self._clean_reference_value(self._extract_reference_value(fallback_source, category))
        taxpayer_name = self._extract_taxpayer_name(fallback_source, category)
        transaction_date = self._normalize_transaction_date(self._extract_transaction_date(fallback_source))
        amount = self._extract_amount(fallback_source, category)

        if category == "MISC":
            if receipt_number and self._looks_like_person_name(receipt_number) and not re.search(r"\d", receipt_number):
                receipt_number = ""
            if ref_number and self._looks_like_person_name(ref_number) and not re.search(r"\d", ref_number):
                ref_number = ""
            if txn_id and self._looks_like_person_name(txn_id) and not re.search(r"\d", txn_id):
                txn_id = ""

        if not ref_number:
            ref_number = receipt_number or txn_id
        if not txn_id:
            txn_id = receipt_number or ref_number

        confidence = 0.45 if text else 0.0
        populated_fields = sum(
            1 for value in [receipt_number, txn_id, ref_number, taxpayer_name, transaction_date, amount] if value not in ("", None)
        )
        if text:
            confidence = min(0.97, 0.55 + (populated_fields * 0.08))

        return {
            "receipt_number": receipt_number or "",
            "ref_number": ref_number or "",
            "txn_id": txn_id or "",
            "taxpayer_name": taxpayer_name,
            "transaction_date": transaction_date,
            "amount": amount,
            "raw_text": text,
            "confidence": round(confidence, 2),
        }

    def _parse_market_certificate_text(self, text: str, filename: str) -> Dict[str, Any]:
        fallback_source = f"{filename}\n{text}".strip()
        market_lookup_text = self._normalize_market_ocr_text(fallback_source)
        market_name = self._extract_market_name(market_lookup_text)
        certificate_number = self._extract_market_certificate_number(market_lookup_text)
        transaction_date = self._extract_market_issue_date(market_lookup_text) or self._normalize_transaction_date(self._extract_transaction_date(market_lookup_text))
        market_purpose_of_renewal = self._extract_market_purpose_of_renewal(market_lookup_text)
        market_valid_until = self._extract_market_valid_until(market_lookup_text)
        if not market_name:
            market_name = self._extract_taxpayer_name(fallback_source, "MISC")

        confidence = 0.45 if text else 0.0
        populated_fields = sum(
            1 for value in [market_name, certificate_number, transaction_date, market_purpose_of_renewal, market_valid_until] if value not in ("", None)
        )
        if text:
            confidence = min(0.97, 0.56 + (populated_fields * 0.08))

        return {
            "receipt_number": certificate_number or "",
            "ref_number": certificate_number or "",
            "txn_id": certificate_number or "",
            "taxpayer_name": market_name,
            "transaction_date": transaction_date,
            "amount": None,
            "market_purpose_of_renewal": market_purpose_of_renewal,
            "market_valid_until": market_valid_until,
            "raw_text": text,
            "confidence": round(confidence, 2),
        }

    def _normalize_market_ocr_text(self, text: str) -> str:
        normalized = re.sub(r"\s+", " ", text or "").strip()
        normalized = re.sub(r"(?<=\d)\s+(?=\d)", "", normalized)
        return normalized

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
                "MISC.",
                "OTHER FEES",
                "CLEARANCE",
                "CERTIFICATION",
                "DOCUMENTARY",
                "SERVICE FEE",
                "REGISTRATION FEE",
            ],
            "PTR": [
                "PROFESSIONAL TAX RECEIPT",
                "PROFESSIONAL TAX",
                "PROFESSIONAL REGULATORY",
            ],
            "MARKET": [
                "CERTIFICATE OF STALL OCCUPANCY",
                "STALL AWARDEE",
                "PUBLIC MARKET",
                "MARKET CERTIFICATE",
                "VALID UNTIL",
                "PURPOSE OF RENEWAL",
            ],
            "CTC": [
                "COMMUNITY TAX CERTIFICATE",
                "COMMUNITY TAX",
                "CEDULA",
                "COMMUNITY TAX RECEIPT",
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

        if re.search(r"\b\d{2}-\d{6}\s+[A-Z0-9 .,&'-]{4,}\b", normalized):
            scores["BUSINESS"] += 3
            evidence["BUSINESS"].append("Permit number with business name")

        if re.search(r"\b(?:INC\.?|CORP\.?|CORPORATION|COMPANY|CO\.|LLC|LTD\.?)\b", normalized):
            scores["BUSINESS"] += 2
            evidence["BUSINESS"].append("Business entity suffix")

        if "MISC" in normalized and "BUSINESS" not in normalized and "PROPERTY" not in normalized:
            scores["MISC"] += 1
            evidence["MISC"].append("MISC keyword")

        misc_layout_signals = {
            "NATURE OF COLLECTION": 1,
            "AMOUNT IN WORDS": 1,
            "ACCOUNTABLE FORM NO. 51": 1,
            "RECEIVED THE AMOUNT STATED": 1,
        }
        misc_layout_hits = []
        for signal, weight in misc_layout_signals.items():
            if signal in normalized:
                scores["MISC"] += weight
                misc_layout_hits.append(signal)
        if misc_layout_hits:
            evidence.setdefault("MISC", []).extend(misc_layout_hits[:5])
        if len(misc_layout_hits) >= 2 and "OFFICIAL RECEIPT" in normalized:
            scores["MISC"] += 2
            evidence.setdefault("MISC", []).append("Official receipt MISC layout")

        if re.search(r"\bPROFESSIONAL\s+TAX\b", normalized):
            scores["PTR"] += 2
            evidence.setdefault("PTR", []).append("Professional tax keyword")

        if "OFFICIAL RECEIPT" in normalized:
            scores["PTR"] += 1
            evidence.setdefault("PTR", []).append("Official receipt title")

        if "PAYOR" in normalized:
            scores["PTR"] += 1
            evidence.setdefault("PTR", []).append("Payor label")

        if any(signal in normalized for signal in ("CITY TREASURER", "TREASURY WARRANT", "CHECK, MONEY ORDER", "COLLECTING OFFICER")):
            scores["PTR"] += 1
            evidence.setdefault("PTR", []).append("Treasurer receipt layout")

        if re.search(r"\bN[???O0]\.?\s*\d{5,}\b", normalized) or re.search(r"\bNO\.?\s*\d{5,}\b", normalized):
            scores["PTR"] += 2
            evidence.setdefault("PTR", []).append("Official receipt number format")

        if any(signal in normalized for signal in ("CERTIFICATE OF STALL OCCUPANCY", "STALL AWARDEE", "PUBLIC MARKET")):
            scores["MARKET"] += 3
            evidence.setdefault("MARKET", []).append("Market certificate keyword")
        if re.search(r"\bVALID UNTIL\b", normalized):
            scores["MARKET"] += 1
            evidence.setdefault("MARKET", []).append("Valid until label")

        if any(signal in normalized for signal in ("COMMUNITY TAX CERTIFICATE", "COMMUNITY TAX RECEIPT", "CEDULA")):
            scores["CTC"] += 3
            evidence.setdefault("CTC", []).append("Community tax certificate keyword")
        elif "COMMUNITY TAX" in normalized:
            scores["CTC"] += 2
            evidence.setdefault("CTC", []).append("Community tax keyword")

        strong_misc_markers = ("MISCELLANEOUS", "MISC.")
        has_strong_misc_marker = any(marker in normalized for marker in strong_misc_markers)
        ptr_supporting_markers = (
            "OFFICIAL RECEIPT",
            "PAYOR",
            "CITY TREASURER",
            "TREASURY WARRANT",
            "CHECK, MONEY ORDER",
            "COLLECTING OFFICER",
        )
        ptr_support_count = sum(1 for marker in ptr_supporting_markers if marker in normalized)
        if scores.get("MISC", 0) >= scores.get("PTR", 0) and ptr_support_count >= 3 and not has_strong_misc_marker:
            scores["PTR"] += 2
            evidence.setdefault("PTR", []).append("Generic official receipt layout without strong MISC marker")
        elif has_strong_misc_marker:
            scores["MISC"] += 2
            evidence.setdefault("MISC", []).append("Strong MISC marker")

        detected_category = max(scores, key=scores.get)
        max_score = scores[detected_category]
        if max_score <= 0:
            detected_category = "UNKNOWN"

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
                    r"\b([A-Z]-\d{3}-\d{5,})\b",
                    r"\b(?:OR|O\.?R\.?)\b\s*(?:NO\.?|NUMBER)?[:#\s-]*([A-Z0-9-]{6,})",
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
                    r"\b([A-Z]-\d{3}-\d{5,})\b",
                ],
                text,
            )

        if category == "MARKET":
            return self._match(
                [
                    r"\b(\d{2}-\d{4,})\b",
                    r"(?:certificate(?:\s*no\.?)?|stall\s*number|award\s*no\.?)[:#\s-]*([A-Z0-9-]{4,})",
                ],
                text,
            )

        if category == "PTR":
            return self._match(
                [
                    r"(?:official\s*receipt\s*)?(?:no\.?|number|n[oº°№]\.?)\s*[:#\s-]*([0-9]{5,}\s*[A-Z]?)\b",
                    r"\b(?:n[oº°№]\.?)\s*([0-9]{5,}\s*[A-Z]?)\b",
                    r"\b([0-9]{6,}\s*[A-Z]?)\b",
                ],
                text,
            ) or self._extract_receipt_number(text)

        return self._match(
            [
                r"\b(\d{2}-\d{6})\b",
                r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+([0-9]{5,}\s*[A-Z]?)\b",
                r"(?:official\s*receipt\s*)?(?:no\.?|number|n[o0]\.?)\s*[:#\s-]*([0-9]{5,}\s*[A-Z]?)\b",
                r"\bN[º°O0]\.?\s*([0-9]{5,}\s*[A-Z]?)\b",
                r"\b(?:OR|O\.?R\.?)\b\s*(?:NO\.?|NUMBER)?[:#\s-]*([A-Z0-9-]{6,})",
                r"(?:machine\s*validation\s*no\.?)[:#\s-]*([A-Z0-9-]{10,})",
                r"(?:reference\s*(?:no\.?|number)?)[:#\s-]*([A-Z0-9-]{6,})",
                r"\b([A-Z]-\d{3}-\d{5})\b",
            ],
            text,
        )

    def _extract_receipt_number(self, text: str) -> str:
        return self._match(
            [
                r"\bN[º°O0]\.?\s*([0-9]{5,}\s*[A-Z]?)\b",
                r"\b(?:OR|O\.?R\.?)\b\s*(?:NO\.?|NUMBER)?[:#\s-]*([A-Z0-9-]{6,})",
                r"(?:official\s*receipt\s*)?(?:no\.?|number|n[o0]\.?)\s*[:#\s-]*([A-Z0-9-]{6,})",
                r"\b([A-Z]-\d{3}-\d{5,})\b",
            ],
            text,
        )

    def _extract_machine_validation_number(self, text: str) -> str:
        candidate = self._match(
            [
                r"(?:machine\s*validation\s*no\.?)[:#\s-]*([A-Z0-9-]{4,}(?:\s+[A-Z0-9-]{1,})?)",
            ],
            text,
        )
        if any(fragment in candidate.upper() for fragment in ("MACHINE", "BILL", "NATURE", "TOTAL", "AMOUNT")):
            return ""
        return candidate

    def _extract_taxpayer_name(self, text: str, category: str) -> str:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if category == "MARKET":
            market_name = self._extract_market_name(text)
            if market_name:
                return market_name
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
        structural_markers = (
            "BILL NUMBER",
            "MACHINE VALIDATION",
            "NATURE OF COLLECTION",
            "FUND AND ACCOUNT CODE",
            "AMOUNT",
            "TOTAL",
        )

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

        for index, line in enumerate(lines):
            upper_line = line.upper()
            if "BILL NUMBER" in upper_line or "MACHINE VALIDATION" in upper_line:
                for next_line in lines[index + 1:index + 5]:
                    candidate = self._extract_taxpayer_name_candidate(next_line, category)
                    if candidate:
                        return candidate.title()

        for line in lines:
            candidate = self._extract_taxpayer_name_candidate(line, category)
            if candidate:
                upper_candidate = candidate.upper()
                if any(marker in upper_candidate for marker in structural_markers):
                    continue
                return candidate.title()

        fallback = self._match(
            [
                r"\b([A-Z][A-Z\s,.'-]{5,})\b",
            ],
            text.upper(),
        )
        fallback = self._clean_name_candidate(fallback)
        return fallback.title() if fallback else ""

    def _extract_market_name(self, text: str) -> str:
        normalized_text = self._normalize_market_ocr_text(text)
        lines = [line.strip() for line in normalized_text.splitlines() if line.strip()]
        text_upper = normalized_text.upper()

        match = re.search(
            r"(?:this\s+is\s+to\s+certify\s+that|name\s*[:\-])\s*(.*?)\s*(?:is\s+the\s+stall\s+awardee|,|\.|$)",
            normalized_text,
            re.IGNORECASE | re.DOTALL,
        )
        if match:
            candidate = re.sub(r"\s{2,}", " ", match.group(1)).strip(" ,.-:")
            candidate = self._clean_name_candidate(candidate)
            if candidate:
                return candidate.title()

        match = re.search(
            r"(?:this\s+is\s+to\s+certify\s+that)\s*(.*?)\s*(?:is\s+the\s+stall\s+awardee\s+at|is\s+the\s+stall\s+awardee)",
            normalized_text,
            re.IGNORECASE | re.DOTALL,
        )
        if match:
            candidate = re.sub(r"\s{2,}", " ", match.group(1)).strip(" ,.-:")
            candidate = self._clean_name_candidate(candidate)
            if candidate:
                return candidate.title()

        for line in lines:
            if re.search(r"\b(STALL AWARDEE|CERTIFY THAT)\b", line, re.IGNORECASE):
                candidate = re.sub(r"(?i).*\b(?:certify\s+that|name|stall\s+awardee)\b\s*[:\-]?\s*", "", line).strip(" ,.-:")
                candidate = re.sub(r"\s+is\s+the\s+stall\s+awardee.*$", "", candidate, flags=re.IGNORECASE).strip(" ,.-:")
                candidate = self._clean_name_candidate(candidate)
                if candidate:
                    return candidate.title()

        after_certify = re.search(r"this\s+is\s+to\s+certify\s+that\s*(.+?)\s+is\s+the\s+stall\s+awardee", normalized_text, re.IGNORECASE | re.DOTALL)
        if after_certify:
            candidate = re.sub(r"\s{2,}", " ", after_certify.group(1)).strip(" ,.-:")
            candidate = self._clean_name_candidate(candidate)
            if candidate:
                return candidate.title()

        fallback = self._match(
            [
                r"\b([A-Z][A-Z ,.'-]{6,})\b",
            ],
            text_upper,
        )
        fallback = self._clean_name_candidate(fallback)
        return fallback.title() if fallback else ""

    def _extract_market_certificate_number(self, text: str) -> str:
        return self._match(
            [
                r"\b(\d{2}-\d{4,})\b",
                r"(?:certificate(?:\s*no\.?)?|stall\s*number|award\s*no\.?)[:#\s-]*([A-Z0-9-]{4,})",
            ],
            text,
        )

    def _extract_market_purpose_of_renewal(self, text: str) -> str:
        normalized_text = self._normalize_market_ocr_text(text)
        compact_text = re.sub(r"\s+", " ", normalized_text).strip()
        return self._match(
            [
                r"(?:purpose\s+of\s+renewal|for\s+the\s+purpose\s+of)\s*[:#\s-]*([A-Za-z0-9 ,.'&/\-]+?)(?:\s*,?\s*valid\s+until\b|$)",
                r"for\s+the\s+purpose\s+of\s+([A-Za-z0-9 ,.'&/\-]+?)(?:\s*,?\s*valid\s+until\b|$)",
            ],
            compact_text,
        )

    def _extract_market_valid_until(self, text: str) -> str:
        normalized_text = self._normalize_market_ocr_text(text)
        compact_text = re.sub(r"\s+", " ", normalized_text).strip()
        return self._match(
            [
                r"(?:valid\s+until)\s*[:#\s-]*([A-Za-z0-9 ,.'&/\-]+?)(?:[.\n]|$)",
                r"valid\s+until\s+([A-Za-z0-9 ,.'&/\-]+?)(?:[.\n]|$)",
            ],
            compact_text,
        )

    def _extract_market_issue_date(self, text: str) -> str:
        normalized_text = self._normalize_market_ocr_text(text)
        compact_text = re.sub(r"\s+", " ", normalized_text).strip()
        match = re.search(
            r"(?:date\s+of\s+issue|issued\s+(?:this|on))\s*[:#\s-]*(?:(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]+)\s*,?\s*(\d{4})|([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}))",
            compact_text,
            re.IGNORECASE,
        )
        if match:
            if match.group(1) and match.group(2) and match.group(3):
                month = match.group(2).title()
                day = int(match.group(1))
                year = match.group(3)
                return self._normalize_transaction_date(f"{month} {day}, {year}")
            if match.group(4) and match.group(5) and match.group(6):
                month = match.group(4).title()
                day = int(match.group(5))
                year = match.group(6)
                return self._normalize_transaction_date(f"{month} {day}, {year}")

        return self._match(
            [
                r"(?:date\s+of\s+issue|issued\s+(?:this|on))\s*[:#\s-]*([A-Za-z]+\s+\d{1,2},\s*\d{4})",
                r"(?:date\s+of\s+issue|issued\s+(?:this|on))\s*[:#\s-]*(\d{1,2}/\d{1,2}/\d{4})",
            ],
            compact_text,
        )

    def _extract_transaction_date(self, text: str) -> str:
        return self._match(
            [
                r"\b((?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+\d{1,2},\s+\d{4})\b",
                r"\b((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\.?\s+\d{1,2},\s+\d{4})\b",
                r"\b(\d{1,2}/\d{1,2}/\d{4})\b",
                r"\b(\d{1,2}/\d{1,2}/\d{2})\b",
                r"\b(\d{1,2}\.\d{1,2}\.\d{2,4})\b",
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

    def _extract_taxpayer_name_candidate(self, line: str, category: str) -> str:
        candidate = (line or "").strip()
        if not candidate:
            return ""
        if any(fragment in candidate.upper() for fragment in ("BILL NUMBER", "MACHINE VALIDATION", "NATURE OF COLLECTION", "TOTAL", "AMOUNT")):
            return ""

        if category in {"BUSINESS", "MISC"}:
            permit_prefixed = re.match(r"^\d{2}-\d{6}\s+(.+)$", candidate)
            if permit_prefixed:
                candidate = permit_prefixed.group(1).strip()

        if re.fullmatch(r"[A-Z][A-Z\s,.'-]{3,}", candidate):
            cleaned = self._clean_name_candidate(candidate)
            if cleaned:
                return cleaned

        if re.fullmatch(r"[A-Z][a-z]+(?:\s+[A-Z][A-Za-z.'-]+)+", candidate):
            cleaned = self._clean_name_candidate(candidate)
            if cleaned:
                return cleaned

        return ""

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

        normalized = value.strip()
        for pattern in ("%B %d, %Y", "%b %d, %Y", "%b. %d, %Y"):
            try:
                parsed = datetime.strptime(normalized, pattern)
                return parsed.strftime("%m/%d/%Y")
            except ValueError:
                continue

        separator = "/" if "/" in value else "-" if "-" in value else "." if "." in value else None
        if separator is None:
            return value
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
