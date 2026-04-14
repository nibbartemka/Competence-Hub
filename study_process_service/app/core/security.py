import hashlib
import os
import secrets


PBKDF2_ITERATIONS = 100_000


def hash_password(password: str, salt: bytes | None = None) -> str:
    actual_salt = salt or os.urandom(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        actual_salt,
        PBKDF2_ITERATIONS,
    )
    return f"{actual_salt.hex()}:{password_hash.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, expected_hash = stored_hash.split(":", maxsplit=1)
    except ValueError:
        return False

    candidate_hash = hash_password(password, bytes.fromhex(salt_hex)).split(":", maxsplit=1)[1]
    return secrets.compare_digest(candidate_hash, expected_hash)


def generate_token() -> str:
    return secrets.token_urlsafe(32)
