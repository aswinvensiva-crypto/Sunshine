"""
rag/evaluation.py — 30-question RAG evaluation harness.
Uses the eval set from synthetic/policy_docs.py.
Measures hit-rate@5 and mean latency.
"""
import time
from typing import List, Dict
from rag.embeddings import retrieve_similar
from evaluation.metrics import hit_rate_at_k


def run_rag_evaluation(tenant_id: int, conn) -> Dict:
    """
    Run the 30-question evaluation harness.
    Returns metrics dict suitable for reporter.write_report().
    """
    from synthetic.policy_docs import EVAL_QUESTIONS
    
    hits_at_5 = []
    latencies = []
    
    for question, expected_topic, expected_keyword in EVAL_QUESTIONS:
        start = time.time()
        chunks = retrieve_similar(tenant_id, question, top_k=5, conn=conn)
        latency = (time.time() - start) * 1000
        latencies.append(latency)
        
        # Hit = any retrieved chunk contains the expected_keyword
        hit = any(
            expected_keyword.lower() in c['content_text'].lower()
            for c in chunks
        )
        hits_at_5.append(1.0 if hit else 0.0)
    
    return {
        'hit_rate_at_5': sum(hits_at_5) / len(hits_at_5) if hits_at_5 else 0.0,
        'mean_latency_ms': sum(latencies) / len(latencies) if latencies else 0.0,
        'p95_latency_ms': sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 0.0,
        'n_questions': len(EVAL_QUESTIONS),
        'n_hits': int(sum(hits_at_5)),
    }
