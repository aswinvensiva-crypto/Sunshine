from typing import List, Literal, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Explainability and Provenance Models
# ---------------------------------------------------------------------------

class Factor(BaseModel):
    name: str
    direction: Literal["up", "down"]
    magnitude: float
    human_text: str


class Source(BaseModel):
    chunk_id: int
    label: str
    score: float


# ---------------------------------------------------------------------------
# Response Models (§B.4 Contract)
# ---------------------------------------------------------------------------

class RiskScore(BaseModel):
    booking_id: int
    cancel_prob: float
    noshow_prob: float
    band: Literal["low", "medium", "high", "unscored"]
    factors: List[Factor]
    recommended_advance: Optional[float] = None
    model_version: str
    data_source: Literal["real", "synthetic", "mixed"]


class ForecastPoint(BaseModel):
    date: str  # ISO date
    p10: float
    p50: float
    p90: float


class ForecastSeries(BaseModel):
    room_type_id: int
    points: List[ForecastPoint]
    model_version: str
    data_source: Literal["real", "synthetic", "mixed"]
    status: Literal["ok", "insufficient_data"]


class PriceSuggestion(BaseModel):
    room_type_id: int
    date: str
    suggested_rate: float
    factors: List[Factor]
    clamped: bool
    model_version: str


class ConciergeAnswer(BaseModel):
    answer: str
    sources: List[Source]
    confidence: float
    handoff: bool
    conversation_id: int
    model_version: str


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class RiskScoreRequest(BaseModel):
    booking_ids: List[int]


class ForecastRequest(BaseModel):
    room_type_ids: Optional[List[int]] = None


class PricingRequest(BaseModel):
    room_type_id: int
    from_date: str
    to_date: str


class ConciergeAskRequest(BaseModel):
    message: str
    channel: Literal["web", "whatsapp"] = "web"
    conversation_id: Optional[int] = None


class IngestDocument(BaseModel):
    content_type: Literal["policy", "faq", "review"]
    content_text: str
    source_label: str
    source_version: str = "v1"


class IngestRequest(BaseModel):
    documents: List[IngestDocument]


class TrainingTriggerRequest(BaseModel):
    force_synthetic: bool = False
    seed: Optional[int] = 42
    data_source: Optional[Literal["real", "synthetic", "mixed"]] = "synthetic"
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Error Envelope
# ---------------------------------------------------------------------------

class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
