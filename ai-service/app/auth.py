from fastapi import HTTPException, Request, status
from jose import ExpiredSignatureError, JWTError, jwt

from app.config import get_settings


def verify_service_token(token: str) -> dict:
    """
    Decodes and verifies a JWT signed with SERVICE_TOKEN_SECRET.
    Returns the decoded payload containing tenant_id and scope.
    Rejects expired or tampered tokens with HTTP 401.
    """
    settings = get_settings()
    secret = settings.service_token_secret
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "CONFIG_ERROR", "message": "SERVICE_TOKEN_SECRET is not configured"},
        )

    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_EXPIRED", "message": "Service token has expired"},
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Invalid service token"},
        )

    tenant_id = payload.get("tenant_id")
    if tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Token payload missing tenant_id"},
        )

    try:
        payload["tenant_id"] = int(tenant_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Invalid tenant_id in token payload"},
        )

    if "scope" not in payload:
        payload["scope"] = "service"

    return payload


def get_tenant_id(request: Request) -> int:
    """
    FastAPI dependency that extracts the service token from the Authorization header,
    verifies it, and returns the verified tenant_id as an integer.
    The tenant_id NEVER comes from the request body or query params.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Missing Authorization header"},
        )

    parts = auth_header.strip().split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        token = parts[1]
    elif len(parts) == 1:
        token = parts[0]
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Invalid Authorization header format"},
        )

    payload = verify_service_token(token)
    return int(payload["tenant_id"])
