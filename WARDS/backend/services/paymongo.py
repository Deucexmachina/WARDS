import os
import base64
import json
import requests
from typing import Dict, Optional
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()


class PayMongoService:
    def __init__(self):
        self.secret_key = os.getenv("PAYMONGO_SECRET_KEY")
        self.public_key = os.getenv("PAYMONGO_PUBLIC_KEY")
        self.base_url = "https://api.paymongo.com/v1"
        self.auth_header = None

    def _require_key(self):
        if not self.secret_key:
            raise ValueError("PAYMONGO_SECRET_KEY not found in environment variables")
        if self.auth_header is None:
            self.auth_header = self._create_auth_header()
    
    def _create_auth_header(self) -> str:
        credentials = f"{self.secret_key}:"
        encoded = base64.b64encode(credentials.encode()).decode()
        return f"Basic {encoded}"
    
    def _get_headers(self) -> Dict[str, str]:
        self._require_key()
        return {
            "Authorization": self.auth_header,
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

    def _get_public_headers(self) -> Dict[str, str]:
        self._require_key()
        if not self.public_key:
            return self._get_headers()
        credentials = f"{self.public_key}:"
        encoded = base64.b64encode(credentials.encode()).decode()
        return {
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

    def _sanitize_metadata(self, metadata: Optional[Dict]) -> Dict:
        """
        PayMongo metadata values must be flat/scalar. Convert nested values to
        compact strings so WARDS can keep context without PayMongo rejecting it.
        """
        sanitized = {}
        for key, value in (metadata or {}).items():
            if value is None:
                sanitized[str(key)] = ""
            elif isinstance(value, (str, int, float, bool)):
                sanitized[str(key)] = str(value)
            else:
                sanitized[str(key)] = json.dumps(value, separators=(",", ":"), default=str)
        return sanitized
    
    def create_payment_intent(
        self,
        amount: float,
        description: str,
        statement_descriptor: str = "WARDS Tax Payment",
        metadata: Optional[Dict] = None,
        payment_method_allowed: Optional[list[str]] = None
    ) -> Dict:
        """
        Create a PayMongo Payment Intent
        
        Args:
            amount: Amount in PHP (will be converted to centavos)
            description: Payment description
            statement_descriptor: Text shown on customer's statement
            metadata: Additional data to store with the payment
        
        Returns:
            Payment Intent data from PayMongo
        """
        url = f"{self.base_url}/payment_intents"
        
        amount_centavos = int(amount * 100)
        
        safe_metadata = self._sanitize_metadata(metadata)
        payload = {
            "data": {
                "attributes": {
                    "amount": amount_centavos,
                    "payment_method_allowed": payment_method_allowed or [
                        "gcash",
                        "paymaya",
                        "card",
                        "grab_pay"
                    ],
                    "payment_method_options": {
                        "card": {
                            "request_three_d_secure": "any"
                        }
                    },
                    "currency": "PHP",
                    "description": description,
                    "statement_descriptor": statement_descriptor[:22],
                    "metadata": safe_metadata
                }
            }
        }
        
        response = requests.post(url, json=payload, headers=self._get_headers())
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise requests.HTTPError(f"{exc}; response={response.text}", response=response) from exc
        return response.json()
    
    def create_payment_method(
        self,
        payment_type: str,
        details: Optional[Dict] = None,
        billing: Optional[Dict] = None
    ) -> Dict:
        """
        Create a PayMongo Payment Method
        
        Args:
            payment_type: Type of payment (gcash, paymaya, card, grab_pay)
            details: Payment method specific details
        
        Returns:
            Payment Method data from PayMongo
        """
        url = f"{self.base_url}/payment_methods"
        
        payload = {
            "data": {
                "attributes": {
                    "type": payment_type,
                    "details": details or {}
                }
            }
        }
        if billing:
            payload["data"]["attributes"]["billing"] = billing
        
        response = requests.post(url, json=payload, headers=self._get_public_headers())
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise requests.HTTPError(f"{exc}; response={response.text}", response=response) from exc
        return response.json()
    
    def attach_payment_intent(
        self,
        payment_intent_id: str,
        payment_method_id: str,
        client_key: str,
        return_url: Optional[str] = None
    ) -> Dict:
        """
        Attach a payment method to a payment intent
        
        Args:
            payment_intent_id: ID of the payment intent
            payment_method_id: ID of the payment method
            client_key: Client key from payment intent
            return_url: URL to redirect after payment
        
        Returns:
            Updated Payment Intent data
        """
        url = f"{self.base_url}/payment_intents/{payment_intent_id}/attach"
        
        payload = {
            "data": {
                "attributes": {
                    "payment_method": payment_method_id,
                    "client_key": client_key
                }
            }
        }
        
        if return_url:
            payload["data"]["attributes"]["return_url"] = return_url
        
        response = requests.post(url, json=payload, headers=self._get_public_headers())
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise requests.HTTPError(f"{exc}; response={response.text}", response=response) from exc
        return response.json()
    
    def retrieve_payment_intent(self, payment_intent_id: str) -> Dict:
        """
        Retrieve a payment intent by ID
        
        Args:
            payment_intent_id: ID of the payment intent
        
        Returns:
            Payment Intent data
        """
        url = f"{self.base_url}/payment_intents/{payment_intent_id}"
        
        response = requests.get(url, headers=self._get_headers())
        response.raise_for_status()
        return response.json()
    
    def create_source(
        self,
        source_type: str,
        amount: float,
        redirect_success: str,
        redirect_failed: str,
        description: str = "WARDS Tax Payment",
        statement_descriptor: str = "WARDS",
        metadata: Optional[Dict] = None
    ) -> Dict:
        """
        Create a PayMongo Source (for e-wallets like GCash, Maya)
        
        Args:
            source_type: Type of source (gcash, grab_pay, paymaya)
            amount: Amount in PHP
            redirect_success: URL to redirect on success
            redirect_failed: URL to redirect on failure
            description: Payment description
            statement_descriptor: Text shown on customer's statement
            metadata: Additional data
        
        Returns:
            Source data from PayMongo
        """
        url = f"{self.base_url}/sources"
        
        amount_centavos = int(amount * 100)
        safe_metadata = self._sanitize_metadata(metadata)
        
        payload = {
            "data": {
                "attributes": {
                    "type": source_type,
                    "amount": amount_centavos,
                    "currency": "PHP",
                    "redirect": {
                        "success": redirect_success,
                        "failed": redirect_failed
                    },
                    "billing": {
                        "name": safe_metadata.get("taxpayer_name") or "Taxpayer",
                        "email": safe_metadata.get("email") or "taxpayer@example.com"
                    },
                    "description": description,
                    "statement_descriptor": statement_descriptor[:22],
                    "metadata": safe_metadata
                }
            }
        }
        
        response = requests.post(url, json=payload, headers=self._get_headers())
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise requests.HTTPError(f"{exc}; response={response.text}", response=response) from exc
        return response.json()

    def create_checkout_session(
        self,
        amount: float,
        item_name: str,
        reference_number: str,
        payment_method_types: list[str],
        success_url: str,
        cancel_url: Optional[str] = None,
        description: str = "WARDS Tax Payment",
        billing: Optional[Dict] = None,
        metadata: Optional[Dict] = None,
        send_email_receipt: bool = False
    ) -> Dict:
        """
        Create a PayMongo Checkout Session
        """
        url = f"{self.base_url}/checkout_sessions"
        amount_centavos = int(amount * 100)

        payload = {
            "data": {
                "attributes": {
                    "billing": billing or {},
                    "send_email_receipt": send_email_receipt,
                    "show_line_items": True,
                    "show_description": True,
                    "description": description,
                    "line_items": [
                        {
                            "currency": "PHP",
                            "amount": amount_centavos,
                            "name": item_name,
                            "quantity": 1,
                            "description": f"Reference {reference_number}",
                        }
                    ],
                    "payment_method_types": payment_method_types,
                    "success_url": success_url,
                    "reference_number": reference_number,
                    "metadata": metadata or {},
                }
            }
        }

        if cancel_url:
            payload["data"]["attributes"]["cancel_url"] = cancel_url

        response = requests.post(url, json=payload, headers=self._get_headers())
        response.raise_for_status()
        return response.json()

    def retrieve_checkout_session(self, checkout_session_id: str) -> Dict:
        """
        Retrieve a checkout session by ID
        """
        url = f"{self.base_url}/checkout_sessions/{checkout_session_id}"
        response = requests.get(url, headers=self._get_headers())
        response.raise_for_status()
        return response.json()

    def retrieve_merchant_payment_methods(self) -> list[str]:
        """
        Retrieve the list of payment methods currently enabled for the merchant account.
        """
        url = f"{self.base_url}/merchants/capabilities/payment_methods"
        response = requests.get(url, headers=self._get_headers())
        response.raise_for_status()

        payload = response.json()
        if isinstance(payload, list):
            return [str(method).strip().lower() for method in payload if str(method).strip()]

        if isinstance(payload, dict):
            data = payload.get("data", payload)
            if isinstance(data, list):
                return [str(method).strip().lower() for method in data if str(method).strip()]

        return []
    
    def retrieve_source(self, source_id: str) -> Dict:
        """
        Retrieve a source by ID
        
        Args:
            source_id: ID of the source
        
        Returns:
            Source data
        """
        url = f"{self.base_url}/sources/{source_id}"
        
        response = requests.get(url, headers=self._get_headers())
        response.raise_for_status()
        return response.json()
    
    def create_payment(self, source_id: str, amount: float, description: str = "WARDS Tax Payment") -> Dict:
        """
        Create a payment from a source
        
        Args:
            source_id: ID of the source
            amount: Amount in PHP
            description: Payment description
        
        Returns:
            Payment data
        """
        url = f"{self.base_url}/payments"

        amount_centavos = int(amount * 100)
        
        payload = {
            "data": {
                "attributes": {
                    "amount": amount_centavos,
                    "source": {
                        "id": source_id,
                        "type": "source"
                    },
                    "description": description,
                    "currency": "PHP"
                }
            }
        }
        
        response = requests.post(url, json=payload, headers=self._get_headers())
        response.raise_for_status()
        return response.json()
    
    def retrieve_payment(self, payment_id: str) -> Dict:
        """
        Retrieve a payment by ID
        
        Args:
            payment_id: ID of the payment
        
        Returns:
            Payment data
        """
        url = f"{self.base_url}/payments/{payment_id}"
        
        response = requests.get(url, headers=self._get_headers())
        response.raise_for_status()
        return response.json()
    
    def get_payment_status(self, payment_intent_id: str) -> str:
        """
        Get the current status of a payment
        
        Args:
            payment_intent_id: ID of the payment intent
        
        Returns:
            Status string (awaiting_payment_method, awaiting_next_action, processing, succeeded, failed)
        """
        try:
            payment_intent = self.retrieve_payment_intent(payment_intent_id)
            return payment_intent.get("data", {}).get("attributes", {}).get("status", "unknown")
        except Exception:
            return "unknown"
    
    def normalize_payment_method(self, paymongo_method: str) -> str:
        """
        Normalize PayMongo payment method names to internal format
        
        Args:
            paymongo_method: PayMongo payment method type
        
        Returns:
            Normalized payment method name
        """
        method_map = {
            "gcash": "gcash",
            "paymaya": "maya",
            "grab_pay": "grabpay",
            "card": "card"
        }
        return method_map.get(paymongo_method.lower(), paymongo_method)
    
    def map_status_to_internal(self, paymongo_status: str) -> str:
        """
        Map PayMongo status to internal payment status
        
        Args:
            paymongo_status: PayMongo payment status
        
        Returns:
            Internal status (Pending, Verified, Failed, Expired)
        """
        status_map = {
            "awaiting_payment_method": "Pending",
            "awaiting_next_action": "Pending",
            "processing": "Processing",
            "succeeded": "Verified",
            "failed": "Failed",
            "cancelled": "Failed",
            "expired": "Expired"
        }
        return status_map.get(paymongo_status.lower(), "Pending")


paymongo_service = PayMongoService()
