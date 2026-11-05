import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from fastapi import APIRouter, Depends, HTTPException, Request
from app.auth import get_tenant_id
from app.schemas import ConciergeAskRequest, IngestRequest
from rag.embeddings import ingest_documents, retrieve_similar
from rag.answer import generate_answer
import psycopg2

router = APIRouter()


@router.post('/v1/concierge/ask')
async def ask_concierge(req: ConciergeAskRequest, tenant_id: int = Depends(get_tenant_id)):
    """Answer a guest question using RAG."""
    conn = None
    try:
        conn = psycopg2.connect(os.getenv('DATABASE_URL_APP', 'postgresql://sunshine_app:sunshine_app@localhost:5432/sunshine'))
        cur = conn.cursor()
        cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", [str(tenant_id)])
        
        # Get or create conversation
        conv_id = req.conversation_id
        if not conv_id:
            cur.execute(
                'INSERT INTO concierge_conversations (tenant_id, channel) VALUES (%s, %s) RETURNING id',
                [tenant_id, req.channel]
            )
            conv_id = cur.fetchone()[0]
        else:
            # Verify conversation belongs to this tenant
            cur.execute(
                'SELECT id FROM concierge_conversations WHERE id = %s AND tenant_id = %s',
                [conv_id, tenant_id]
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail={'code': 'NOT_FOUND', 'message': 'Conversation not found'})
        
        # Retrieve resort name
        cur.execute('SELECT name FROM tenants WHERE id = %s', [tenant_id])
        row = cur.fetchone()
        resort_name = row[0] if row else 'this resort'
        
        # Retrieve relevant chunks
        chunks = retrieve_similar(tenant_id, req.message, top_k=5, conn=conn)
        sources = [
            {
                'chunk_id': c['id'],
                'label': c['metadata'].get('source_label', c['content_type']),
                'score': round(c['score'], 4)
            }
            for c in chunks
        ]
        
        # Generate answer
        llm_api_key = os.getenv('LLM_API_KEY', '')
        model_version = os.getenv('LLM_MODEL', 'gemini-1.5-flash')
        result = generate_answer(req.message, chunks, resort_name, llm_api_key, model_version)
        
        # Save message
        cur.execute(
            '''INSERT INTO concierge_messages
               (tenant_id, conversation_id, role, content, sources, confidence, handoff, model_version)
               VALUES (%s, %s, 'assistant', %s, %s, %s, %s, %s) RETURNING id''',
            [tenant_id, conv_id, result['answer'],
             json.dumps(sources), result['confidence'], result['handoff'], result['model_version']]
        )
        msg_id = cur.fetchone()[0]
        
        # Update conversation status if handoff
        if result['handoff']:
            cur.execute(
                "UPDATE concierge_conversations SET status = 'handoff', updated_at = now() WHERE id = %s",
                [conv_id]
            )
        else:
            cur.execute(
                "UPDATE concierge_conversations SET updated_at = now() WHERE id = %s",
                [conv_id]
            )
        
        conn.commit()
        
        return {
            'answer': result['answer'],
            'sources': sources,
            'confidence': result['confidence'],
            'handoff': result['handoff'],
            'conversation_id': conv_id,
            'message_id': msg_id,
            'model_version': result['model_version'],
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={'code': 'CONCIERGE_ERROR', 'message': str(e)})
    finally:
        if conn: conn.close()


@router.post('/v1/concierge/ingest')
async def ingest_knowledge(req: IngestRequest, tenant_id: int = Depends(get_tenant_id)):
    """Ingest policy/FAQ documents into the vector store."""
    conn = None
    try:
        conn = psycopg2.connect(os.getenv('DATABASE_URL_APP', 'postgresql://sunshine_app:sunshine_app@localhost:5432/sunshine'))
        cur = conn.cursor()
        cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", [str(tenant_id)])
        
        docs = [
            {
                'content_type': d.content_type,
                'content_text': d.content_text,
                'source_label': d.source_label,
                'source_version': d.source_version,
            }
            for d in req.documents
        ]
        
        stats = ingest_documents(tenant_id, docs, conn)
        return {'status': 'ok', **stats}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail={'code': 'INGEST_ERROR', 'message': str(e)})
    finally:
        if conn: conn.close()
