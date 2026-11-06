from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import security
from ..deps import admin, csrf_token, require_csrf

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Login(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: Login, request: Request):
    ip = request.client.host if request.client else "?"
    if security.rate_limited(ip):
        raise HTTPException(429, "Thử sai quá nhiều lần. Vui lòng chờ vài phút.")
    if not security.check_credentials(body.username.strip(), body.password):
        security.record_failure(ip)
        raise HTTPException(401, "Sai tên đăng nhập hoặc mật khẩu.")
    request.session.clear()
    request.session["user"] = body.username.strip()
    return {"user": request.session["user"], "csrf": csrf_token(request), "defaultPassword": security.using_default_password()}


@router.post("/logout", dependencies=[Depends(require_csrf)])
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/me")
def me(request: Request, user: str = Depends(admin)):
    return {"user": user, "csrf": csrf_token(request), "defaultPassword": security.using_default_password()}
