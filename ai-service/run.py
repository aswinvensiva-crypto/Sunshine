#!/usr/bin/env python
"""
run.py — Start the Sunshine IQ FastAPI AI service.

Usage:
    cd ai-service
    python run.py              # production (port 8001)
    python run.py --reload     # development with hot reload
    python run.py --port 8002  # custom port

Environment variables (copy .env.example to .env and fill in):
    DATABASE_URL_APP        PostgreSQL URL for sunshine_app role
    SERVICE_TOKEN_SECRET    Shared secret with Express backend (must match)
    LLM_API_KEY             Google Gemini API key (optional; fallback used if empty)
    ARTIFACT_ROOT           Where model artifacts are stored (default: artifacts/models)
    EMBEDDING_MODEL         HuggingFace model name (default: paraphrase-multilingual-mpnet-base-v2)
"""
import os
import sys
import argparse

def main():
    parser = argparse.ArgumentParser(description='Sunshine IQ AI Service')
    parser.add_argument('--host', default='0.0.0.0', help='Bind host (default: 0.0.0.0)')
    parser.add_argument('--port', type=int, default=8001, help='Port (default: 8001)')
    parser.add_argument('--reload', action='store_true', help='Enable hot reload (dev only)')
    parser.add_argument('--workers', type=int, default=1, help='Number of workers (default: 1)')
    args = parser.parse_args()

    # Load .env if present
    try:
        from dotenv import load_dotenv
        env_path = os.path.join(os.path.dirname(__file__), '.env')
        if os.path.exists(env_path):
            load_dotenv(env_path)
            print(f'  Loaded .env from {env_path}')
        else:
            print(f'  [WARN] No .env found at {env_path} — using environment variables only')
    except ImportError:
        print('  [WARN] python-dotenv not installed — using environment variables only')

    # Check required env vars
    missing = []
    if not os.getenv('DATABASE_URL_APP'):
        missing.append('DATABASE_URL_APP')
    if not os.getenv('SERVICE_TOKEN_SECRET'):
        print('  [WARN] SERVICE_TOKEN_SECRET not set — using dev default (not safe for production)')
    if missing:
        print(f'  [ERROR] Missing required environment variables: {missing}')
        print('  Copy ai-service/.env.example to ai-service/.env and fill in values.')
        sys.exit(1)

    print(f'\n  Sunshine IQ — AI Service')
    print(f'  Starting on http://{args.host}:{args.port}')
    print(f'  Docs: http://localhost:{args.port}/docs')
    print(f'  Health: http://localhost:{args.port}/health\n')

    import uvicorn
    uvicorn.run(
        'app.main:app',
        host=args.host,
        port=args.port,
        reload=args.reload,
        workers=args.workers if not args.reload else 1,
        log_level='info',
    )

if __name__ == '__main__':
    main()
