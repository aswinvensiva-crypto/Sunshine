#!/usr/bin/env python
"""CLI wrapper: python -m synthetic.run_synthetic [generate|cleanup] [tenant_id...]"""
from dotenv import load_dotenv
load_dotenv()
from synthetic.generator import SyntheticGenerator
import sys

if __name__ == '__main__':
    action = sys.argv[1] if len(sys.argv) > 1 else 'generate'
    tenant_ids = [int(x) for x in sys.argv[2:]] if len(sys.argv) > 2 else [1]
    gen = SyntheticGenerator(seed=42)
    for tid in tenant_ids:
        if action == 'generate':
            gen.generate_for_tenant(tid, years=1.5)
        elif action == 'cleanup':
            gen.cleanup_synthetic(tid)
