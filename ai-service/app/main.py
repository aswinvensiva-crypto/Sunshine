import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog

from app.config import get_settings
from app.db import close_pool
from app.routers import concierge, forecast, health, pricing, risk, training

# ---------------------------------------------------------------------------
# Structured JSON Logging Configuration
# ---------------------------------------------------------------------------
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.dev.set_exc_info,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# Application Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup event: log service start with tenant isolation note
    logger.info(
        "service_started",
        service="Sunshine IQ — AI Service",
        tenant_isolation="defense-in-depth: app-layer + PostgreSQL RLS via app.current_tenant_id",
        port=8001,
    )
    yield
    # Shutdown event: cleanup resources
    close_pool()
    logger.info("service_shutdown", service="Sunshine IQ — AI Service")


# ---------------------------------------------------------------------------
# FastAPI App Definition
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Sunshine IQ — AI Service",
    description="Multi-tenant AI subsystem for Sunshine Resort Management Platform",
    version="1.0.0",
    lifespan=lifespan,
)

settings = get_settings()

# ---------------------------------------------------------------------------
# CORS Middleware (configurable via env, default: http://localhost:5000)
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global Exception Handlers — strictly returning {"error": {"code": str, "message": str}}
# ---------------------------------------------------------------------------
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    code = "HTTP_ERROR"
    message = str(exc.detail)

    if isinstance(exc.detail, dict):
        code = exc.detail.get("code", code)
        message = exc.detail.get("message", message)
    elif exc.status_code == status.HTTP_400_BAD_REQUEST:
        code = "BAD_REQUEST"
    elif exc.status_code == status.HTTP_401_UNAUTHORIZED:
        code = "UNAUTHORIZED"
    elif exc.status_code == status.HTTP_403_FORBIDDEN:
        code = "FORBIDDEN"
    elif exc.status_code == status.HTTP_404_NOT_FOUND:
        code = "NOT_FOUND"
    elif exc.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
        code = "VALIDATION_ERROR"
    elif exc.status_code == status.HTTP_501_NOT_IMPLEMENTED:
        code = "NOT_IMPLEMENTED"

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": message}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    # Build clean human-readable message from validation errors
    if errors:
        msg_parts = []
        for err in errors:
            loc = " -> ".join(str(l) for l in err.get("loc", []))
            msg_parts.append(f"{loc}: {err.get('msg', 'invalid')}")
        message = "; ".join(msg_parts)
    else:
        message = "Validation error"

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": {"code": "VALIDATION_ERROR", "message": message}},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error("unhandled_exception", error=str(exc), exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An internal server error occurred.",
            }
        },
    )


# ---------------------------------------------------------------------------
# Router Inclusions
# ---------------------------------------------------------------------------
app.include_router(health.router)
app.include_router(risk.router)
app.include_router(forecast.router)
app.include_router(pricing.router)
app.include_router(concierge.router)
app.include_router(training.router)
