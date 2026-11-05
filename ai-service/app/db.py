from contextlib import contextmanager
from typing import Generator, Optional
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from fastapi import Depends
import structlog

from app.config import get_settings
from app.auth import get_tenant_id

logger = structlog.get_logger()

_pool: Optional[ThreadedConnectionPool] = None


def get_pool() -> ThreadedConnectionPool:
    """
    Lazily initialize and return the thread-safe connection pool.
    """
    global _pool
    if _pool is None or _pool.closed:
        settings = get_settings()
        logger.info(
            "initializing_db_pool",
            dsn_masked=settings.database_url.split("@")[-1] if "@" in settings.database_url else "configured",
        )
        _pool = ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=settings.database_url,
        )
    return _pool


def close_pool() -> None:
    """
    Close all connections in the pool upon shutdown.
    """
    global _pool
    if _pool is not None and not _pool.closed:
        _pool.closeall()
        _pool = None
        logger.info("db_pool_closed")


def get_db(tenant_id: int = Depends(get_tenant_id)) -> Generator[psycopg2.extensions.connection, None, None]:
    """
    FastAPI dependency that:
    1. Connects using DATABASE_URL_APP
    2. Calls SELECT set_config('app.current_tenant_id', str(tenant_id), true) inside a transaction
    3. Yields the connection
    4. Commits (or rollbacks on error), resets the setting before returning to pool
    This ensures all DB queries from AI service are tenant-scoped with RLS.
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant_id', %s, true);", (str(tenant_id),))
        yield conn
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error("db_transaction_error", tenant_id=tenant_id, error=str(exc))
        raise
    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("RESET app.current_tenant_id;")
            conn.commit()
        except Exception:
            pass
        pool.putconn(conn)


@contextmanager
def tenant_db_context(tenant_id: int) -> Generator[psycopg2.extensions.connection, None, None]:
    """
    Context manager for background workers and offline pipelines to obtain
    a tenant-scoped connection with RLS enforcement.
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant_id', %s, true);", (str(tenant_id),))
        yield conn
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error("tenant_db_context_error", tenant_id=tenant_id, error=str(exc))
        raise
    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("RESET app.current_tenant_id;")
            conn.commit()
        except Exception:
            pass
        pool.putconn(conn)
