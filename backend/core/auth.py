from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import RefreshTokenModel, UserModel, UserWatchlistModel, WalletModel
from core.paper_wallets import DEFAULT_WALLETS


def _load_jwt_secret() -> str:
    env_secret = os.environ.get("JWT_SECRET", "").strip()
    is_prod = (
        os.environ.get("APP_ENV", "").strip().lower() == "production"
        or os.environ.get("ENV", "").strip().lower() == "production"
        or os.environ.get("RENDER", "").strip().lower() in ("1", "true")
        or os.environ.get("DATABASE_URL", "").strip().startswith("postgres")
    )
    if env_secret:
        if is_prod and len(env_secret) < 32:
            raise RuntimeError("JWT_SECRET must be at least 32 characters in production.")
        return env_secret
    if is_prod:
        raise RuntimeError("JWT_SECRET environment variable must be set in production.")
    # Local development only: persist a random per-machine secret in a gitignored file.
    secret_path = Path(__file__).resolve().parent.parent / ".agam_jwt_secret"
    try:
        if secret_path.exists():
            stored = secret_path.read_text(encoding="utf-8").strip()
            if len(stored) >= 32:
                return stored
        generated = secrets.token_urlsafe(48)
        secret_path.write_text(generated, encoding="utf-8")
        return generated
    except OSError:
        return secrets.token_urlsafe(48)


JWT_SECRET = _load_jwt_secret()
ACCESS_COOKIE_NAME = "agam_access"
REFRESH_COOKIE_NAME = "agam_refresh"
ACCESS_TTL_SEC = 60 * 60 * 6  # 6 hours
REFRESH_TTL_DAYS = 14

DEFAULT_SEEDED_WATCHLIST = ["RELIANCE.NS", "TCS.NS", "AAPL", "NVDA", "SHOP.TO", "600519.SS", "SAP.DE"]


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(raw: str) -> bytes:
    pad = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + pad)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    now = int(time.time())
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode("utf-8"))
    payload = _b64url_encode(
        json.dumps(
            {"sub": user_id, "email": email, "role": role, "iat": now, "exp": now + ACCESS_TTL_SEC},
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signing_input = f"{header}.{payload}".encode("ascii")
    sig = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64url_encode(sig)}"


def decode_access_token(token: str) -> Optional[dict]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        signing_input = f"{parts[0]}.{parts[1]}".encode("ascii")
        expected_sig = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
        actual_sig = _b64url_decode(parts[2])
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def seed_user_workspace(db: Session, user_id: str) -> None:
    existing_wallets = db.scalars(select(WalletModel.currency).where(WalletModel.user_id == user_id)).all()
    existing_set = set(existing_wallets)
    for currency, amount in DEFAULT_WALLETS.items():
        if currency not in existing_set:
            db.add(
                WalletModel(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    currency=currency,
                    balance=float(amount),
                    equity=float(amount),
                    margin_used=0.0,
                )
            )
    existing_wl = db.scalar(select(UserWatchlistModel).where(UserWatchlistModel.user_id == user_id))
    if not existing_wl:
        db.add(
            UserWatchlistModel(
                id=str(uuid.uuid4()),
                user_id=user_id,
                name="Primary",
                symbols_json=json.dumps(DEFAULT_SEEDED_WATCHLIST),
            )
        )
    db.commit()


def create_user_account(
    db: Session,
    email: str,
    password: str,
    base_currency: str = "USD",
    theme_preference: str = "light",
    is_guest: bool = False,
) -> UserModel:
    user = UserModel(
        id=str(uuid.uuid4()),
        email=email.strip().lower(),
        hashed_password=hash_password(password),
        role="user",
        base_currency=base_currency,
        theme_preference=theme_preference,
        is_guest=is_guest,
    )
    db.add(user)
    db.flush()
    seed_user_workspace(db, user.id)
    return user


def issue_session_tokens(db: Session, user: UserModel, request: Request, response: Response) -> dict:
    access_jwt = create_access_token(user.id, user.email, user.role)
    raw_refresh = secrets.token_urlsafe(48)
    db.add(
        RefreshTokenModel(
            id=str(uuid.uuid4()),
            user_id=user.id,
            token_hash=_token_hash(raw_refresh),
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TTL_DAYS),
            revoked=False,
        )
    )
    db.commit()

    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "") == "https" or bool(os.environ.get("RENDER"))
    samesite_mode = "none" if is_https else "lax"

    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=access_jwt,
        httponly=True,
        secure=is_https,
        samesite=samesite_mode,
        max_age=ACCESS_TTL_SEC,
        path="/",
    )
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_refresh,
        httponly=True,
        secure=is_https,
        samesite=samesite_mode,
        max_age=REFRESH_TTL_DAYS * 86400,
        path="/",
    )
    return {"access_token": access_jwt}


def clear_session_cookies(request: Request, response: Response) -> None:
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "") == "https" or bool(os.environ.get("RENDER"))
    samesite_mode = "none" if is_https else "lax"
    response.delete_cookie(ACCESS_COOKIE_NAME, path="/", samesite=samesite_mode, secure=is_https)
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/", samesite=samesite_mode, secure=is_https)


def rotate_refresh_token(db: Session, raw_refresh: str, request: Request, response: Response) -> Optional[tuple[UserModel, str]]:
    row = db.scalar(select(RefreshTokenModel).where(RefreshTokenModel.token_hash == _token_hash(raw_refresh)))
    if not row or row.revoked:
        return None
    exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        return None
    row.revoked = True
    user = db.get(UserModel, row.user_id)
    if not user:
        db.commit()
        return None
    tokens = issue_session_tokens(db, user, request, response)
    return user, tokens["access_token"]


def _extract_token(request: Request) -> Optional[str]:
    auth_hdr = request.headers.get("Authorization", "")
    if auth_hdr.startswith("Bearer "):
        return auth_hdr[7:].strip()
    return request.cookies.get(ACCESS_COOKIE_NAME)


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> Optional[UserModel]:
    tok = _extract_token(request)
    if not tok:
        return None
    payload = decode_access_token(tok)
    if not payload:
        return None
    return db.get(UserModel, payload.get("sub"))


def get_or_provision_workspace_user(request: Request, response: Response, db: Session = Depends(get_db)) -> UserModel:
    """
    Returns authenticated UserModel if JWT cookie/header is valid.
    Otherwise provisions an isolated guest tenant workspace with HttpOnly JWT cookies
    so anonymous visitors still have strict user_id data isolation and zero 401 noise.
    """
    existing = get_optional_user(request, db)
    if existing:
        return existing

    guest_email = f"guest-{uuid.uuid4().hex[:10]}@agam.local"
    guest = create_user_account(db, email=guest_email, password=secrets.token_hex(16), is_guest=True)
    issue_session_tokens(db, guest, request, response)
    return guest


def require_authenticated_user(user: Optional[UserModel] = Depends(get_optional_user)) -> UserModel:
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user
