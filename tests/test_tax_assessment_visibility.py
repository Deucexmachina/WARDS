"""Regression tests for tax assessment visibility on the citizen side."""

from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from database import models as database_models
from database.models import Base, Branch, CitizenUser, Payment, TaxAssessmentRecord
from routes import tax_assessment as tax_routes


def make_session():
    temp_dir = TemporaryDirectory()
    db_path = Path(temp_dir.name) / "test.db"
    original_database_url = database_models.SQLALCHEMY_DATABASE_URL
    database_models.SQLALCHEMY_DATABASE_URL = "sqlite://"
    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False}
    )
    sqlite_engine = getattr(engine, "sync_engine", engine)

    @event.listens_for(sqlite_engine, "connect")
    def register_sqlite_collations(dbapi_connection, _connection_record):
        dbapi_connection.create_collation(
            "utf8mb4_bin", lambda left, right: (left > right) - (left < right)
        )

    Base.metadata.create_all(
        engine,
        tables=[
            Branch.__table__,
            CitizenUser.__table__,
            Payment.__table__,
            TaxAssessmentRecord.__table__,
        ],
    )
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return temp_dir, engine, Session(), original_database_url


def _make_citizen(db, email="jane@example.com"):
    citizen = CitizenUser(
        full_name="Jane Doe",
        email=email,
        tin="123-456-789-000",
        status="Active",
    )
    db.add(citizen)
    db.flush()
    return citizen


def _make_payment(db, **kwargs):
    defaults = {
        "ref_number": "REF-001",
        "txn_id": "TXN-001",
        "taxpayer_name": "Jane Doe",
        "tin": "123-456-789-000",
        "email": "jane@example.com",
        "tax_type": "RPT",
        "amount": 100.0,
        "payment_method": "gcash",
        "status": "PAYMENT_VERIFIED",
        "source_module": "rpt_online_payment",
        "verified_at": datetime(2026, 1, 1),
    }
    defaults.update(kwargs)
    payment = Payment(**defaults)
    db.add(payment)
    db.flush()
    return payment


def _make_assessment(db, citizen, **kwargs):
    defaults = {
        "citizen_user_id": citizen.id,
        "tax_type": "RPT",
        "assessment_status": "Active",
        "verification_status": "Verified",
        "taxpayer_name": "Jane Doe",
        "taxpayer_type": "Individual",
        "visible_to_taxpayer": True,
        "tdn": "A-123-45678",
        "fair_market_value": 100000.0,
        "assessment_level": 0.5,
        "months_late": 0,
        "discount_rate": 0.0,
        "assessed_value": 50000.0,
        "basic_tax_due": 1000.0,
        "sef_tax": 500.0,
        "penalties": 0.0,
        "discounts": 0.0,
        "final_total_amount_due": 1500.0,
        "amount_due": 1500.0,
    }
    defaults.update(kwargs)
    record = TaxAssessmentRecord(**defaults)
    db.add(record)
    db.flush()
    return record


def test_filter_unsettled_returns_assessment_when_no_payments():
    """A brand-new assessment with no matching payments should remain visible."""
    temp_dir, engine, db, original_database_url = make_session()
    try:
        citizen = _make_citizen(db)
        db.commit()

        assessment = _make_assessment(db, citizen)
        db.commit()

        result = tax_routes.filter_unsettled_public_assessments(db, citizen, [assessment])
        assert len(result) == 1
        assert result[0].id == assessment.id
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        db.close()
        engine.dispose()
        temp_dir.cleanup()


def test_bt_assessment_not_hidden_by_amount_match_for_different_business():
    """BT assessment for Business B must NOT be hidden by a payment for Business A
    just because both happen to have the same amount."""
    temp_dir, engine, db, original_database_url = make_session()
    try:
        citizen = _make_citizen(db)
        db.commit()

        # Payment for Business A (mayor permit MP-001)
        _make_payment(
            db,
            source_module="business_tax_online_payment",
            property_ref_number="MP-001",
            amount=5000.0,
            tax_type="Business Tax",
            status="PAYMENT_VERIFIED",
        )

        # Assessment for Business B (mayor permit MP-002) with same amount
        assessment = _make_assessment(
            db,
            citizen,
            tax_type="BT",
            tdn=None,
            mayor_permit_number="MP-002",
            sec_dti_cda_number="SEC-002",
            business_name="Biz B",
            amount_due=5000.0,
            final_total_amount_due=0.0,
            annual_gross_sales=50000.0,
            business_tax_rate=0.1,
        )
        db.commit()

        result = tax_routes.filter_unsettled_public_assessments(db, citizen, [assessment])
        assert len(result) == 1, "BT assessment for a different business should NOT be hidden by amount matching"
        assert result[0].id == assessment.id
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        db.close()
        engine.dispose()
        temp_dir.cleanup()


def test_filter_unsettled_returns_all_when_citizen_email_is_missing():
    """When citizen email cannot be resolved, assessments must not be hidden."""
    temp_dir, engine, db, original_database_url = make_session()
    try:
        # Citizen with empty email so citizen_email() returns None
        citizen = _make_citizen(db, email="")
        db.commit()

        # Another citizen's payment exists in the system
        other = CitizenUser(
            full_name="Other",
            email="other@example.com",
            tin="999-999-999-000",
            status="Active",
        )
        db.add(other)
        db.flush()

        _make_payment(
            db,
            email="other@example.com",
            taxpayer_name="Other",
            tin="999-999-999-000",
            property_ref_number="A-999-99999",
            amount=1500.0,
        )

        assessment = _make_assessment(db, citizen)
        db.commit()

        result = tax_routes.filter_unsettled_public_assessments(db, citizen, [assessment])
        assert len(result) == 1, "Assessment should remain visible when citizen email is missing"
        assert result[0].id == assessment.id
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        db.close()
        engine.dispose()
        temp_dir.cleanup()


def test_rpt_assessment_hidden_when_tdn_paid():
    """An RPT assessment whose TDN has been paid should be filtered out."""
    temp_dir, engine, db, original_database_url = make_session()
    try:
        citizen = _make_citizen(db)
        db.commit()

        _make_payment(
            db,
            property_ref_number="A-123-45678",
            amount=1500.0,
            status="PAYMENT_VERIFIED",
        )

        assessment = _make_assessment(db, citizen, tdn="A-123-45678")
        db.commit()

        result = tax_routes.filter_unsettled_public_assessments(db, citizen, [assessment])
        assert len(result) == 0, "Settled RPT assessment should be hidden"
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        db.close()
        engine.dispose()
        temp_dir.cleanup()


def test_bt_assessment_hidden_when_permit_paid():
    """A BT assessment whose mayor permit has been paid should be filtered out."""
    temp_dir, engine, db, original_database_url = make_session()
    try:
        citizen = _make_citizen(db)
        db.commit()

        _make_payment(
            db,
            source_module="business_tax_online_payment",
            property_ref_number="MP-001",
            amount=5000.0,
            tax_type="Business Tax",
            status="PAYMENT_VERIFIED",
        )

        assessment = _make_assessment(
            db,
            citizen,
            tax_type="BT",
            tdn=None,
            mayor_permit_number="MP-001",
            sec_dti_cda_number="SEC-001",
            business_name="Biz A",
            amount_due=5000.0,
            final_total_amount_due=0.0,
            annual_gross_sales=50000.0,
            business_tax_rate=0.1,
        )
        db.commit()

        result = tax_routes.filter_unsettled_public_assessments(db, citizen, [assessment])
        assert len(result) == 0, "Settled BT assessment should be hidden when mayor permit matches"
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        db.close()
        engine.dispose()
        temp_dir.cleanup()
