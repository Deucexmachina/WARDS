"""Regression tests for IDOR fixes in the payments module."""

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from database import models as database_models
from database.models import Base, Branch, CitizenUser, Payment
from routes import payments


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
        tables=[Branch.__table__, CitizenUser.__table__, Payment.__table__],
    )
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return temp_dir, engine, Session(), original_database_url


def test_get_payments_for_citizen_filters_by_email():
    temp_dir, engine, db, original_database_url = make_session()
    try:
        branch = Branch(name="Test Branch", location="QC", contact="123", counters=3, status="Active")
        db.add(branch)
        db.flush()

        citizen = CitizenUser(
            full_name="Jane Doe",
            email="jane@example.com",
            tin="123-456-789-000",
            status="Active",
        )
        db.add(citizen)
        db.flush()

        p1 = Payment(
            ref_number="REF-001",
            txn_id="TXN-001",
            taxpayer_name="Jane Doe",
            tin="123-456-789-000",
            email="jane@example.com",
            tax_type="RPT",
            amount=100.0,
            payment_method="gcash",
            branch_id=branch.id,
            status="Pending",
        )
        p2 = Payment(
            ref_number="REF-002",
            txn_id="TXN-002",
            taxpayer_name="John Smith",
            tin="987-654-321-000",
            email="john@example.com",
            tax_type="RPT",
            amount=200.0,
            payment_method="gcash",
            branch_id=branch.id,
            status="Pending",
        )
        db.add_all([p1, p2])
        db.commit()

        query = payments.get_payments_for_citizen(db, citizen)
        results = query.all()
        assert len(results) == 1
        assert results[0].ref_number == "REF-001"
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        db.close()
        engine.dispose()
        temp_dir.cleanup()


def test_get_payments_for_citizen_filters_by_name_and_tin_when_no_email():
    temp_dir, engine, db, original_database_url = make_session()
    try:
        branch = Branch(name="Test Branch", location="QC", contact="123", counters=3, status="Active")
        db.add(branch)
        db.flush()

        citizen = CitizenUser(
            full_name="Jane Doe",
            email="",
            tin="123-456-789-000",
            status="Active",
        )
        db.add(citizen)
        db.flush()

        p1 = Payment(
            ref_number="REF-001",
            txn_id="TXN-001",
            taxpayer_name="Jane Doe",
            tin="123-456-789-000",
            email="",
            tax_type="RPT",
            amount=100.0,
            payment_method="gcash",
            branch_id=branch.id,
            status="Pending",
        )
        p2 = Payment(
            ref_number="REF-002",
            txn_id="TXN-002",
            taxpayer_name="John Smith",
            tin="987-654-321-000",
            email="",
            tax_type="RPT",
            amount=200.0,
            payment_method="gcash",
            branch_id=branch.id,
            status="Pending",
        )
        db.add_all([p1, p2])
        db.commit()

        query = payments.get_payments_for_citizen(db, citizen)
        results = query.all()
        assert len(results) == 1
        assert results[0].ref_number == "REF-001"
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        db.close()
        engine.dispose()
        temp_dir.cleanup()


def test_verify_payment_ownership_raises_for_other_user():
    temp_dir, engine, db, original_database_url = make_session()
    try:
        citizen = CitizenUser(
            full_name="Jane Doe",
            email="jane@example.com",
            tin="123-456-789-000",
            status="Active",
        )
        db.add(citizen)
        db.flush()

        other = CitizenUser(
            full_name="John Smith",
            email="john@example.com",
            tin="987-654-321-000",
            status="Active",
        )
        db.add(other)
        db.flush()

        payment = Payment(
            ref_number="REF-001",
            txn_id="TXN-001",
            taxpayer_name="John Smith",
            tin="987-654-321-000",
            email="john@example.com",
            tax_type="RPT",
            amount=100.0,
            payment_method="gcash",
            status="Pending",
        )
        db.add(payment)
        db.commit()

        payments.verify_payment_ownership(payment, other)  # owner should pass

        try:
            payments.verify_payment_ownership(payment, citizen)  # non-owner should fail
        except Exception as exc:
            assert exc.status_code == 403
        else:
            raise AssertionError("Expected 403 for non-owner access")
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        db.close()
        engine.dispose()
        temp_dir.cleanup()
