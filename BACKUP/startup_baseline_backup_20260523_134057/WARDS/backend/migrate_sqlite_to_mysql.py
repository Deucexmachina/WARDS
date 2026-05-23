from dotenv import load_dotenv
from sqlalchemy import MetaData, Table, create_engine, select
from sqlalchemy.exc import SQLAlchemyError

from database.models import BASE_DIR, Base, build_database_url


load_dotenv(BASE_DIR / ".env")

SQLITE_URL = f"sqlite:///{(BASE_DIR / 'wards.db').as_posix()}"
MYSQL_URL = build_database_url()


def make_engine(database_url: str):
    engine_kwargs = {}
    if database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    else:
        engine_kwargs["pool_pre_ping"] = True
    return create_engine(database_url, **engine_kwargs)


def migrate():
    if not MYSQL_URL.startswith("mysql+pymysql://"):
        raise RuntimeError("DATABASE_URL must point to MySQL before running this migration.")

    sqlite_db_path = BASE_DIR / "wards.db"
    if not sqlite_db_path.exists():
        raise RuntimeError(f"SQLite source database not found: {sqlite_db_path}")

    source_engine = make_engine(SQLITE_URL)
    target_engine = make_engine(MYSQL_URL)

    source_metadata = MetaData()
    source_metadata.reflect(bind=source_engine)

    Base.metadata.drop_all(bind=target_engine)
    Base.metadata.create_all(bind=target_engine)

    table_names = [table.name for table in Base.metadata.sorted_tables if table.name in source_metadata.tables]

    with source_engine.connect() as source_conn, target_engine.begin() as target_conn:
        target_conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")

        try:
            for table_name in table_names:
                source_table = Table(table_name, source_metadata, autoload_with=source_engine)
                target_table = Base.metadata.tables[table_name]

                rows = [dict(row._mapping) for row in source_conn.execute(select(source_table)).fetchall()]

                target_conn.execute(target_table.delete())
                if rows:
                    target_conn.execute(target_table.insert(), rows)

                print(f"Migrated {table_name}: {len(rows)} rows")
        finally:
            target_conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")

    source_engine.dispose()
    target_engine.dispose()
    print("SQLite to MySQL migration complete.")


if __name__ == "__main__":
    try:
        migrate()
    except SQLAlchemyError as exc:
        raise SystemExit(f"Migration failed: {exc}") from exc
    except Exception as exc:
        raise SystemExit(str(exc)) from exc
