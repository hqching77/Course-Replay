from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.ratelimit import client_address, failed_logins_by_ip, failed_logins_by_user, registrations_by_ip, too_many
from app.schemas import AuthResponse, LoginRequest, RegisterRequest, UserRead, UserUpdate
from app.security import create_session, get_current_user, hash_password, revoke_session, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_read(user: User) -> UserRead:
    return UserRead(id=user.id, username=user.username, display_name=user.display_name, created_at=user.created_at, preferences=user.preferences or {})


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    if not get_settings().allow_registration:
        raise HTTPException(status_code=403, detail="当前服务器未开放注册")
    address = client_address(request)
    if registrations_by_ip.blocked(address):
        raise too_many("注册太频繁，请稍后再试")
    registrations_by_ip.add(address)
    username = payload.username.strip().lower()
    if db.scalar(select(User).where(User.username == username)):
        raise HTTPException(status_code=409, detail="用户名已被使用")
    user = User(
        username=username,
        display_name=(payload.display_name.strip() or payload.username.strip())[:32],
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:  # concurrent registration with the same name
        db.rollback()
        raise HTTPException(status_code=409, detail="用户名已被使用") from exc
    token = create_session(db, user)
    db.commit()
    return AuthResponse(token=token, user=_user_read(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    username = payload.username.strip().lower()
    address = client_address(request)
    if failed_logins_by_user.blocked(username) or failed_logins_by_ip.blocked(address):
        raise too_many()
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not verify_password(payload.password, user.password_hash):
        failed_logins_by_user.add(username)
        failed_logins_by_ip.add(address)
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_session(db, user)
    db.commit()
    return AuthResponse(token=token, user=_user_read(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> None:
    revoke_session(db, authorization)


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)) -> UserRead:
    return _user_read(user)


@router.patch("/me", response_model=UserRead)
def update_me(payload: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserRead:
    if payload.display_name is not None:
        name = payload.display_name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="昵称不能为空")
        user.display_name = name
    if payload.preferences is not None:
        # Only the keys sent are changed; a key sent as null is removed.
        sent = payload.preferences.model_dump(exclude_unset=True)
        merged = {**(user.preferences or {}), **sent}
        user.preferences = {key: value for key, value in merged.items() if value is not None}
    db.commit()
    return _user_read(user)
