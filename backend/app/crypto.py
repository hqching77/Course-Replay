"""Encryption of users' study content in the database.

Notes, transcripts, questions, chat and titles are encrypted with AES-256-GCM
before they are written, using DATA_ENCRYPTION_KEY from the server's
environment. Someone who gets the database (a leaked DATABASE_URL, a backup,
the database host itself) sees only ciphertext. The key never goes into the
database or the git repo — keep a copy somewhere safe: without it the data
cannot be read back.

What this does not protect against: whoever controls the running backend has
the key. The AI features need the plain text, so true end-to-end encryption
isn't possible for this app.

Generate a key:  python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
"""

from __future__ import annotations

import base64
import binascii
import json
import os
from functools import lru_cache
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import JSON, Text
from sqlalchemy.types import TypeDecorator

from app.config import get_settings

PREFIX = "enc:v1:"
_AAD = b"course-replay:v1"


class EncryptionKeyError(RuntimeError):
    pass


def parse_key(raw: str) -> bytes:
    try:
        key = base64.urlsafe_b64decode(raw.strip() + "=" * (-len(raw.strip()) % 4))
    except (binascii.Error, ValueError) as exc:
        raise EncryptionKeyError("DATA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded") from exc
    if len(key) != 32:
        raise EncryptionKeyError("DATA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded")
    return key


@lru_cache
def _cipher(raw_key: str) -> AESGCM:
    return AESGCM(parse_key(raw_key))


def _current_cipher() -> AESGCM | None:
    raw = get_settings().data_encryption_key
    return _cipher(raw) if raw else None


def encrypt_text(value: str) -> str:
    cipher = _current_cipher()
    if cipher is None:
        return value
    nonce = os.urandom(12)
    sealed = cipher.encrypt(nonce, value.encode("utf-8"), _AAD)
    return PREFIX + base64.urlsafe_b64encode(nonce + sealed).decode("ascii")


def decrypt_text(value: str) -> str:
    """Plain values (written before encryption was turned on) are returned unchanged."""
    if not value.startswith(PREFIX):
        return value
    cipher = _current_cipher()
    if cipher is None:
        raise EncryptionKeyError("The database contains encrypted data but DATA_ENCRYPTION_KEY is not set")
    blob = base64.urlsafe_b64decode(value[len(PREFIX):])
    try:
        return cipher.decrypt(blob[:12], blob[12:], _AAD).decode("utf-8")
    except InvalidTag as exc:
        raise EncryptionKeyError("Cannot decrypt stored data: DATA_ENCRYPTION_KEY is not the key it was written with") from exc


class EncryptedText(TypeDecorator):
    """A Text column stored encrypted."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Any) -> str | None:
        return None if value is None else encrypt_text(value)

    def process_result_value(self, value: str | None, dialect: Any) -> str | None:
        return None if value is None else decrypt_text(value)


class EncryptedJSON(TypeDecorator):
    """A JSON column whose value is stored as one encrypted JSON string.

    The column stays JSON in the database, so tables created before
    encryption need no migration; old plain values are still readable.
    """

    impl = JSON
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        if value is None or _current_cipher() is None:
            return value
        return encrypt_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))

    def process_result_value(self, value: Any, dialect: Any) -> Any:
        if isinstance(value, str) and value.startswith(PREFIX):
            return json.loads(decrypt_text(value))
        return value
