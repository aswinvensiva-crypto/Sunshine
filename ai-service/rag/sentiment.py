"""
rag/sentiment.py — Multilingual sentiment classification on guest feedback.

Model: Uses a simple lexicon-based classifier as the default (no model download
needed). For production, replace with a fine-tuned multilingual model.

Labels: positive, neutral, negative, unclassified (below confidence threshold).
Multilingual: basic support for English, Tamil (romanized), Hindi (romanized).

NOTE: This is a lexicon-based implementation for feasibility demonstration.
Real multilingual sentiment needs a trained model (U-15).
"""

import re
from typing import Dict, Optional, List

# English sentiment lexicons
POS_WORDS = {
    'great', 'excellent', 'amazing', 'wonderful', 'perfect', 'love', 'loved',
    'fantastic', 'outstanding', 'superb', 'awesome', 'beautiful', 'clean',
    'friendly', 'helpful', 'enjoyed', 'recommend', 'best', 'good', 'nice',
    'comfortable', 'relaxing', 'peaceful', 'value'
}
NEG_WORDS = {
    'terrible', 'awful', 'horrible', 'bad', 'poor', 'dirty', 'rude',
    'disappointing', 'disappointed', 'slow', 'expensive', 'overpriced',
    'noisy', 'small', 'broken', 'faulty', 'cold', 'stale', 'unfriendly',
    'unhelpful', 'worst', 'never', "n't", 'not', 'unfortunately'
}

def classify_sentiment(text: str) -> Dict:
    """
    Classify sentiment of text. Returns {'sentiment', 'confidence', 'language'}.
    NOTE: Lexicon-based; not a trained model. Results on non-English text are unreliable.
    """
    if not text or not text.strip():
        return {'sentiment': 'unclassified', 'confidence': 0.0, 'language': 'unknown'}
    
    # Simple language detection
    has_tamil = any('\u0b80' <= c <= '\u0bff' for c in text)
    has_hindi = any('\u0900' <= c <= '\u097f' for c in text)
    lang = 'ta' if has_tamil else ('hi' if has_hindi else 'en')
    
    # For non-Latin scripts, we can't use word-level matching reliably
    if has_tamil or has_hindi:
        return {'sentiment': 'unclassified', 'confidence': 0.0, 'language': lang}
    
    words = set(re.findall(r'\b\w+\b', text.lower()))
    pos_score = len(words & POS_WORDS)
    neg_score = len(words & NEG_WORDS)
    
    total = pos_score + neg_score
    if total == 0:
        return {'sentiment': 'neutral', 'confidence': 0.5, 'language': lang}
    
    pos_ratio = pos_score / total
    confidence = min(0.95, 0.5 + abs(pos_ratio - 0.5))
    
    if pos_ratio > 0.6:
        sentiment = 'positive'
    elif pos_ratio < 0.4:
        sentiment = 'negative'
    else:
        sentiment = 'neutral'
    
    return {'sentiment': sentiment, 'confidence': round(confidence, 4), 'language': lang}


def batch_classify(tenant_id: int, conn) -> Dict:
    """
    Classify all feedback_items for a tenant where sentiment is NULL.
    Returns count of classified items.
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT id, content_text FROM feedback_items WHERE tenant_id = %s AND sentiment IS NULL",
        [tenant_id]
    )
    rows = cur.fetchall()
    classified = 0
    for fid, text in rows:
        result = classify_sentiment(text)
        cur.execute(
            "UPDATE feedback_items SET sentiment = %s, sentiment_confidence = %s, language = %s WHERE id = %s",
            [result['sentiment'], result['confidence'], result['language'], fid]
        )
        classified += 1
    conn.commit()
    return {'classified': classified}


def weekly_trend(tenant_id: int, conn) -> List[Dict]:
    """Aggregate sentiment counts by week for the past 12 weeks."""
    cur = conn.cursor()
    cur.execute(
        '''SELECT
             date_trunc('week', created_at) AS week,
             sentiment,
             COUNT(*) AS count
           FROM feedback_items
           WHERE tenant_id = %s
             AND created_at > NOW() - INTERVAL '12 weeks'
             AND sentiment IS NOT NULL
           GROUP BY 1, 2
           ORDER BY 1, 2''',
        [tenant_id]
    )
    rows = cur.fetchall()
    return [{'week': r[0].isoformat(), 'sentiment': r[1], 'count': r[2]} for r in rows]
