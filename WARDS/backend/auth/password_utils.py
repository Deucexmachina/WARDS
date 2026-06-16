from fastapi import HTTPException, status
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def verify_account_password(plain_password: str | None, hashed_password: str, detail: str = "Incorrect password.") -> None:
    if not plain_password or not verify_password(plain_password, hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def validate_password_strength(password: str):
    message = (
        "Password must be more than 12 characters long and include at least one uppercase letter, "
        "one lowercase letter, and at least one number or special character."
    )
    if len(password) <= 12:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password is too long for secure processing. Please use 72 bytes or fewer.",
        )
    if not any(char.isupper() for char in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    if not any(char.islower() for char in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    if not any(char.isdigit() or not char.isalnum() for char in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
