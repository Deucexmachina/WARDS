from __future__ import annotations


PUBLIC_DPA_VERSION = "WARDS-DPA-2026.06"
PUBLIC_DPA_TITLE = "WARDS Data Privacy Agreement"
PUBLIC_DPA_EFFECTIVE_DATE = "2026-06-05"
PUBLIC_DPA_CATEGORY = "Data Privacy Agreement"

PUBLIC_DPA_CONTENT = """
WARDS DATA PRIVACY AGREEMENT

Effective Date: June 5, 2026
Version: WARDS-DPA-2026.06

1. Purpose of Collection
The WARDS system collects personal information to create and manage your citizen account, verify your identity, support queueing and service transactions, send notifications, secure your access, respond to lawful requests, and improve public service delivery.

2. Information Collected
The personal information that may be collected includes your full name, email address, mobile or contact number, address, taxpayer details when applicable, login credentials, verification records, and system-generated security or audit metadata connected with your use of the platform.

3. Legal Basis
Your personal information is processed in accordance with Republic Act No. 10173, also known as the Philippine Data Privacy Act of 2012, its Implementing Rules and Regulations, and other applicable government rules on records management, security, and lawful disclosure.

4. Processing and Use
Your information may be used for registration, authentication, email verification, fraud prevention, account recovery, queue and transaction processing, receipt or tax-related requests, customer support, audit review, and compliance with legal or regulatory obligations.

5. Storage and Retention
WARDS stores personal information using system security controls designed to protect confidentiality, integrity, and availability. Records are retained only for as long as necessary for service delivery, audit, compliance, dispute handling, or other lawful government purposes, after which they may be archived, anonymized, or securely disposed of according to applicable policy.

6. Security Measures
The system uses validation controls, access restrictions, activity logging, rate limiting, and other technical and organizational safeguards to protect personal information against unauthorized access, disclosure, alteration, misuse, or destruction.

7. Sharing and Disclosure
Your personal information will only be shared with authorized personnel, government offices, service providers, or lawful authorities when necessary for official service delivery, system operation, legal compliance, security investigation, or other purposes allowed by law.

8. Your Rights
Subject to the limits provided by law, you may request access to your personal information, ask for correction of inaccurate or outdated data, inquire about how your data is processed, and raise privacy concerns through official WARDS or City Treasurer's Office support channels.

9. Consent
By agreeing to this Data Privacy Agreement, you acknowledge that you have read and understood its contents and voluntarily consent to the collection, use, storage, processing, retention, and lawful disclosure of your personal information for the purposes stated above.

10. Updates to this Agreement
WARDS may update this Data Privacy Agreement to reflect legal, operational, security, or service changes. The current published version made available in the system shall govern future collection and processing activities from the effective date of the update.
""".strip()


def get_public_privacy_agreement() -> dict:
    return {
        "title": PUBLIC_DPA_TITLE,
        "category": PUBLIC_DPA_CATEGORY,
        "version": PUBLIC_DPA_VERSION,
        "effective_date": PUBLIC_DPA_EFFECTIVE_DATE,
        "content": PUBLIC_DPA_CONTENT,
    }
