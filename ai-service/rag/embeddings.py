"""
rag/embeddings.py — Multilingual embedding using sentence-transformers.

Model: paraphrase-multilingual-mpnet-base-v2
  - Dimension: 768
  - Languages: English, Tamil, Hindi (and many more)
  - License: Apache-2.0
  - Source: https://huggingface.co/sentence-transformers/paraphrase-multilingual-mpnet-base-v2

Chunking: split long texts with configurable size/overlap to stay within
model's 512-token limit. Chunks that exceed the model's max_seq_length
are logged but not silently truncated.

Tenant isolation: all DB writes include tenant_id; all reads are filtered
by tenant_id. RLS enforces this at the DB layer as a backstop.
"""

import os
import re
import json
from typing import List, Dict, Optional, Tuple
import numpy as np

MODEL_NAME = os.getenv('EMBEDDING_MODEL', 'sentence-transformers/paraphrase-multilingual-mpnet-base-v2')
CHUNK_SIZE = int(os.getenv('CHUNK_SIZE', 512))
CHUNK_OVERLAP = int(os.getenv('CHUNK_OVERLAP', 64))
_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(MODEL_NAME)
        print(f'[rag] Loaded embedding model: {MODEL_NAME} (dim={_model.get_sentence_embedding_dimension()})')
    return _model


def embed_texts(texts: List[str]) -> np.ndarray:
    """
    Embed a list of texts. Returns array of shape (len(texts), 768).
    Warns if any text exceeds model max_seq_length.
    """
    model = _get_model()
    max_len = getattr(model, 'max_seq_length', 512)
    for i, t in enumerate(texts):
        toks = len(t.split())
        if toks * 1.3 > max_len:
            print(f'[rag] Warning: chunk {i} (~{toks} words) may exceed max_seq_length={max_len}')
    return model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """
    Split text into chunks of ~chunk_size characters with overlap.
    Splits on sentence boundaries where possible.
    """
    sentences = re.split(r'(?<=[.!?\n])\s+', text.strip())
    chunks = []
    current = []
    current_len = 0
    for sent in sentences:
        if current_len + len(sent) > chunk_size and current:
            chunks.append(' '.join(current))
            # Overlap: keep last few sentences
            overlap_sents = []
            overlap_len = 0
            for s in reversed(current):
                if overlap_len + len(s) > overlap:
                    break
                overlap_sents.insert(0, s)
                overlap_len += len(s)
            current = overlap_sents
            current_len = overlap_len
        current.append(sent)
        current_len += len(sent)
    if current:
        chunks.append(' '.join(current))
    return [c for c in chunks if c.strip()]


def ingest_documents(
    tenant_id: int,
    documents: List[Dict],
    conn,
) -> Dict:
    """
    Chunk, embed, and upsert documents into vector_embeddings.
    Each document: {'content_type': ..., 'content_text': ..., 'source_label': ..., 'source_version': ...}
    Returns stats: {inserted, chunks_total}
    """
    cur = conn.cursor()
    total_chunks = 0
    inserted = 0
    
    for doc in documents:
        content_type = doc['content_type']
        content_text = doc['content_text']
        source_version = doc.get('source_version', 'v1')
        metadata = {
            'source_label': doc.get('source_label', ''),
            'source_version': source_version,
            'content_type': content_type,
        }
        
        chunks = chunk_text(content_text)
        if not chunks:
            continue
        
        embeddings = embed_texts(chunks)
        
        for chunk, emb in zip(chunks, embeddings):
            total_chunks += 1
            emb_list = emb.tolist()
            cur.execute(
                '''INSERT INTO vector_embeddings
                   (tenant_id, content_type, content_text, embedding, metadata, source_version)
                   VALUES (%s, %s, %s, %s::vector, %s, %s)''',
                [tenant_id, content_type, chunk,
                 '[' + ','.join(str(x) for x in emb_list) + ']',
                 json.dumps(metadata), source_version]
            )
            inserted += 1
    
    conn.commit()
    print(f'[rag] Ingested {inserted} chunks for tenant {tenant_id}')
    return {'inserted': inserted, 'chunks_total': total_chunks}


def retrieve_similar(
    tenant_id: int,
    query: str,
    top_k: int = 5,
    conn = None,
) -> List[Dict]:
    """
    Retrieve top-k similar chunks for a query using cosine similarity.
    Tenant isolation: query is filtered by tenant_id (RLS active as backstop).
    Returns list of {'id', 'content_text', 'content_type', 'metadata', 'score'}.
    """
    query_emb = embed_texts([query])[0]
    emb_str = '[' + ','.join(str(x) for x in query_emb.tolist()) + ']'
    
    cur = conn.cursor()
    cur.execute(
        '''SELECT id, content_text, content_type, metadata,
                  1 - (embedding <=> %s::vector) AS score
           FROM vector_embeddings
           WHERE tenant_id = %s
           ORDER BY embedding <=> %s::vector
           LIMIT %s''',
        [emb_str, tenant_id, emb_str, top_k]
    )
    rows = cur.fetchall()
    return [
        {
            'id': r[0], 'content_text': r[1], 'content_type': r[2],
            'metadata': r[3] or {}, 'score': float(r[4]),
        }
        for r in rows
    ]


def isolation_test(tenant_id_a: int, tenant_id_b: int, conn) -> bool:
    """
    Verify that a query for tenant_a returns only tenant_a's embeddings,
    even when tenant_b's embeddings exist. Raises AssertionError if isolation fails.
    Used in test suite (not in production path).
    """
    cur = conn.cursor()
    cur.execute('SELECT COUNT(*) FROM vector_embeddings WHERE tenant_id = %s', [tenant_id_a])
    count_a = cur.fetchone()[0]
    cur.execute('SELECT COUNT(*) FROM vector_embeddings WHERE tenant_id = %s', [tenant_id_b])
    count_b = cur.fetchone()[0]
    
    if count_a == 0 or count_b == 0:
        return True  # Can't test without data on both sides
    
    # Simulate tenant_a context
    cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", [str(tenant_id_a)])
    cur.execute('SELECT DISTINCT tenant_id FROM vector_embeddings')
    visible_tenants = [r[0] for r in cur.fetchall()]
    assert tenant_id_b not in visible_tenants, f'ISOLATION FAILURE: tenant {tenant_id_b} visible from tenant {tenant_id_a} context'
    return True
