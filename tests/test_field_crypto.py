from utils.field_crypto import (
    decrypt_optional_value,
    encrypt_optional_value,
    hash_optional_value,
    set_encrypted_hash_companions,
)


class DummyRecord:
    email = None
    email_enc = None
    email_hash = None


def test_encrypt_decrypt_round_trip():
    encrypted = encrypt_optional_value("treasurermain@gmail.com")
    assert encrypted
    assert decrypt_optional_value(encrypted) == "treasurermain@gmail.com"


def test_hash_is_stable_for_same_value():
    assert hash_optional_value("WARDS") == hash_optional_value("WARDS")


def test_set_encrypted_hash_companions_populates_fields():
    record = DummyRecord()
    record.email = "treasurersuper@gmail.com"
    set_encrypted_hash_companions(record, "email")
    assert record.email_enc
    assert record.email_hash
    assert decrypt_optional_value(record.email_enc) == "treasurersuper@gmail.com"
