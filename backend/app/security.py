"""Password hashing, session tokens and FastAPI auth dependencies.

Uses only the standard library: scrypt for passwords, random bearer tokens
for sessions (stored as SHA-256 hashes so a leaked database can't be replayed).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import AuthSession, User

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    encode = lambda raw: base64.b64encode(raw).decode()  # noqa: E731
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${encode(salt)}${encode(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest_b64)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aware(value: datetime) -> datetime:
    # SQLite hands back naive datetimes; everything here is stored in UTC.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def create_session(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=get_settings().auth_session_days)
    db.add(AuthSession(user_id=user.id, token_hash=_token_hash(token), expires_at=expires))
    return token


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _session_for(db: Session, token: str | None) -> AuthSession | None:
    if not token:
        return None
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
    if session is None:
        return None
    now = datetime.now(timezone.utc)
    expires = _aware(session.expires_at)
    if expires <= now:
        db.delete(session)
        db.commit()
        return None
    # Sliding expiry: keep active users signed in, refreshing at most once a day.
    lifetime = timedelta(days=get_settings().auth_session_days)
    if expires - now < lifetime - timedelta(days=1):
        session.expires_at = now + lifetime
        db.commit()
    return session


def get_optional_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    session = _session_for(db, _bearer_token(authorization))
    return session.user if session else None


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def _login_gate(configured: bool, user: User | None, detail: str) -> User | None:
    if configured and get_settings().ai_requires_login and user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_ai_access(request: Request, user: User | None = Depends(get_optional_user)) -> User | None:
    """Gate for endpoints that call the chat/vision model.

    When AI isn't configured the endpoint itself reports that (503), so the
    login check only applies once there is a provider to use.
    """
    from app.providers import effective_settings

    return _login_gate(effective_settings(request).ai_configured, user, "请先登录后再使用 AI 功能")


def require_stt_access(request: Request, user: User | None = Depends(get_optional_user)) -> User | None:
    from app.providers import stt_config

    return _login_gate(stt_config(request).configured, user, "请先登录后再使用语音识别")


def revoke_session(db: Session, authorization: str | None) -> None:
    session = _session_for(db, _bearer_token(authorization))
    if session is not None:
        db.delete(session)
        db.commit()
