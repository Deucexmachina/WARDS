from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from database import models as database_models
from database.models import Base, Branch, CollectionAccount, Payment, Remittance, RemittanceItem
from routes import branch_portal, payments


def make_session():
    temp_dir = TemporaryDirectory()
    db_path = Path(temp_dir.name) / "test.db"
    original_database_url = database_models.SQLALCHEMY_DATABASE_URL
    database_models.SQLALCHEMY_DATABASE_URL = "sqlite://"
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False})
    sqlite_engine = getattr(engine, "sync_engine", engine)

    @event.listens_for(sqlite_engine, "connect")
    def register_sqlite_collations(dbapi_connection, _connection_record):
        dbapi_connection.create_collation("utf8mb4_bin", lambda left, right: (left > right) - (left < right))

    Base.metadata.create_all(
        engine,
        tables=[
            Branch.__table__,
            Payment.__table__,
            CollectionAccount.__table__,
            Remittance.__table__,
            RemittanceItem.__table__,
        ],
    )
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return temp_dir, engine, Session(), original_database_url


def test_get_or_create_main_collection_account_creates_single_account():
    temp_dir, engine, db, original_database_url = make_session()
    try:
        first = payments.get_or_create_main_collection_account(db)
        db.commit()
        second = payments.get_or_create_main_collection_account(db)
        assert first.id == second.id
        assert second.owner_type == "main"
        assert second.branch_id is None
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        db.close()
        engine.dispose()
        temp_dir.cleanup()


def test_create_branch_remittance_record_creates_remittance_and_updates_collection_account():
    temp_dir, engine, db, original_database_url = make_session()
    original_log = branch_portal.log_branch_action
    original_get_payments = branch_portal.get_branch_payments
    original_is_locked = branch_portal.is_payment_locked_for_remittance
    try:
        branch = Branch(name="Galas Branch", location="QC", contact="123", counters=3, status="Active")
        db.add(branch)
        db.commit()
        db.refresh(branch)

        payment = Payment(
            ref_number="REF-001",
            txn_id="TXN-001",
            taxpayer_name="Juan Dela Cruz",
            tin="123-456-789-000",
            tax_type="RPT",
            amount=1500.0,
            payment_method="gcash",
            branch="Galas Branch",
            branch_id=branch.id,
            status="Verified",
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        staff = SimpleNamespace(branch_id=branch.id, username="branchadmin")

        branch_portal.log_branch_action = lambda *_args, **_kwargs: None
        branch_portal.get_branch_payments = lambda *_args, **_kwargs: [payment]
        branch_portal.is_payment_locked_for_remittance = lambda *_args, **_kwargs: False

        remittance = branch_portal.create_branch_remittance_record(
            db,
            staff,
            branch,
            [payment.id],
            remarks="Daily remittance",
            remittance_number="REM-TEST-001",
        )
        db.commit()
        db.refresh(remittance)

        account = db.query(CollectionAccount).filter(CollectionAccount.branch_id == branch.id).first()
        items = db.query(RemittanceItem).filter(RemittanceItem.remittance_id == remittance.id).all()

        assert remittance.remittance_number == "REM-TEST-001"
        assert remittance.payment_count == 1
        assert float(remittance.total_amount or 0) == 1500.0
        assert account is not None
        assert float(account.total_remitted or 0) == 1500.0
        assert len(items) == 1
        assert items[0].payment_id == payment.id
    finally:
        database_models.SQLALCHEMY_DATABASE_URL = original_database_url
        branch_portal.log_branch_action = original_log
        branch_portal.get_branch_payments = original_get_payments
        branch_portal.is_payment_locked_for_remittance = original_is_locked
        db.close()
        engine.dispose()
        temp_dir.cleanup()
