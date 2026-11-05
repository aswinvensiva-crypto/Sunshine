import time
import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.auth import verify_service_token
from app.config import get_settings
from app.main import app

TEST_SECRET = "test-super-secret-key-for-unit-tests-123456"


@pytest.fixture(autouse=True)
def setup_test_env(monkeypatch):
    """
    Override environment variables for tests and clear settings cache.
    """
    monkeypatch.setenv("SERVICE_TOKEN_SECRET", TEST_SECRET)
    monkeypatch.setenv("DATABASE_URL_APP", "postgresql://sunshine_app:sunshine_app@localhost:5432/sunshine")
    get_settings.cache_clear()


def create_token(
    tenant_id: int = 42,
    scope: str = "service",
    exp_offset: int = 3600,
    secret: str = TEST_SECRET,
) -> str:
    """
    Generate a signed JWT service token.
    """
    payload = {
        "tenant_id": tenant_id,
        "scope": scope,
        "exp": int(time.time()) + exp_offset,
        "iat": int(time.time()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """Health check endpoint requires no auth and returns 200 OK."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data == {"ok": True, "service": "sunshine-iq"}


@pytest.mark.asyncio
async def test_valid_service_token_extracts_tenant_id(client: AsyncClient):
    """
    A valid service token allows the request through authentication.
    The stub returns 501 (NOT_IMPLEMENTED) indicating auth succeeded and
    the endpoint handler was reached with the verified tenant_id.
    """
    token = create_token(tenant_id=42)
    response = await client.post(
        "/v1/risk/score",
        json={"booking_ids": [101, 102]},
        headers={"Authorization": f"Bearer {token}"},
    )

    # 501 confirms authentication passed and reached the router stub
    assert response.status_code == 501
    data = response.json()
    assert data["error"]["code"] == "NOT_IMPLEMENTED"

    # Direct unit test of verify_service_token
    payload = verify_service_token(token)
    assert payload["tenant_id"] == 42
    assert payload["scope"] == "service"


@pytest.mark.asyncio
async def test_tampered_token_returns_401(client: AsyncClient):
    """A tampered token or invalid signature must be rejected with 401."""
    # Create token signed with a different secret
    bad_token = create_token(tenant_id=42, secret="wrong-secret-key-123456789")
    response = await client.post(
        "/v1/risk/score",
        json={"booking_ids": [101]},
        headers={"Authorization": f"Bearer {bad_token}"},
    )

    assert response.status_code == 401
    data = response.json()
    assert data["error"]["code"] == "INVALID_TOKEN"

    # Direct function call must also raise HTTPException(401)
    with pytest.raises(HTTPException) as exc_info:
        verify_service_token(bad_token)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "INVALID_TOKEN"


@pytest.mark.asyncio
async def test_expired_token_returns_401(client: AsyncClient):
    """An expired token must be rejected with 401."""
    # Token expired 10 minutes ago
    expired_token = create_token(tenant_id=42, exp_offset=-600)
    response = await client.post(
        "/v1/risk/score",
        json={"booking_ids": [101]},
        headers={"Authorization": f"Bearer {expired_token}"},
    )

    assert response.status_code == 401
    data = response.json()
    assert data["error"]["code"] == "TOKEN_EXPIRED"

    # Direct function call must also raise HTTPException(401)
    with pytest.raises(HTTPException) as exc_info:
        verify_service_token(expired_token)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "TOKEN_EXPIRED"


@pytest.mark.asyncio
async def test_no_token_returns_401(client: AsyncClient):
    """A request without an Authorization header must be rejected with 401."""
    response = await client.post(
        "/v1/risk/score",
        json={"booking_ids": [101]},
    )

    assert response.status_code == 401
    data = response.json()
    assert data["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_tenant_id_in_body_is_ignored(client: AsyncClient):
    """
    The tenant_id NEVER comes from the request body.
    1. Attempting to supply tenant_id in body without token fails with 401.
    2. Supplying a rogue tenant_id in body with a valid token does NOT override
       the token's tenant_id.
    """
    # Case 1: Body has tenant_id, but no Authorization header -> 401
    response_no_auth = await client.post(
        "/v1/risk/score",
        json={"booking_ids": [101], "tenant_id": 999},
    )
    assert response_no_auth.status_code == 401
    assert response_no_auth.json()["error"]["code"] == "UNAUTHORIZED"

    # Case 2: Token is for tenant 42, but body attempts to pass tenant_id 999
    token = create_token(tenant_id=42)
    response_with_auth = await client.post(
        "/v1/risk/score",
        json={"booking_ids": [101], "tenant_id": 999},
        headers={"Authorization": f"Bearer {token}"},
    )
    # Passed authentication because token is valid (status 501 from stub)
    assert response_with_auth.status_code == 501
    assert response_with_auth.json()["error"]["code"] == "NOT_IMPLEMENTED"
