# Sunshine Platform: Comprehensive Project Vision Report

## Executive Summary

**Sunshine** is evolving from a single-resort booking system into a **multi-tenant, AI-powered resort management platform**. This transformation addresses two critical market needs: affordable multi-property management for small/mid-sized resorts, and intelligent decision-making capabilities previously only available in enterprise solutions.

## 1. Current State Assessment

### 1.1 Existing Platform (Single-Tenant)
- **Technology Stack**: Express.js + PostgreSQL backend, React/Vite frontend
- **Core Features**: Room inventory management, booking system, basic admin dashboard
- **Limitations**: Single-resort only, no tenant isolation, manual pricing decisions, reactive operations

### 1.2 Market Opportunity
Small and mid-sized resorts currently face:
- **Revenue Loss**: Suboptimal pricing, last-minute cancellations
- **Operational Inefficiency**: Repetitive guest inquiries, manual processes  
- **Data Underutilization**: Unstructured feedback ignored, no predictive analytics
- **Enterprise Barrier**: Tools like OTA Insight and IDeaS are cost-prohibitive

## 2. Phase 1: Multi-Tenant Foundation

### 2.1 Core Architecture Shift
**Goal**: Convert admin side into multi-tenant system with complete data isolation

#### **Key Decisions**:
1. **Isolation Model**: Shared database with `tenant_id` on every table (not schema-per-tenant)
2. **Tenant Resolution**: Subdomain-based (`<slug>.sunshine.app`) with fallback header
3. **Security Model**: Defense-in-depth approach with both application-layer filtering AND PostgreSQL Row-Level Security (RLS)

#### **Implementation Components**:

**Schema Migration**:
- New `tenants` table with tenant metadata
- Add `tenant_id INTEGER NOT NULL` to all 21 existing tables
- Implement RLS policies on every tenant-scoped table
- Create migration scripts for existing data

**Backend Security Pipeline**:
- `resolveTenant` middleware for subdomain/header resolution
- Enhanced `requireAuth` with tenant validation in JWT
- New `super_admin` role for platform management
- Query helper utilities for automatic tenant filtering

**Frontend Integration**:
- Tenant-aware API client deriving slug from hostname
- Admin context with tenant branding
- Platform admin UI for tenant creation/management

**Critical Security Measures**:
1. App-layer: Every query includes `WHERE tenant_id = $1`
2. Database-layer: RLS policies using `app.current_tenant_id` session variable
3. JWT validation: Token tenant ID must match resolved tenant
4. File uploads: Namespaced under `uploads/<tenant_id>/`

## 3. Phase 2: Sunshine IQ AI Layer

### 3.1 The AI Vision
**Sunshine IQ** brings enterprise-grade AI capabilities into an affordable, tenant-isolated system with four intelligent modules:

### **3.2 The Four AI Modules**

#### **Module 1: Demand Forecast Engine**
- **Technology**: Pretrained time-series transformer (Chronos/TimesFM)
- **Input**: Historical `inventory` data per room type
- **Output**: 60-day occupancy forecasts with uncertainty bands (p10, p50, p90)
- **Visualization**: Forecast charts in Pricing Hub dashboard

#### **Module 2: Smart Pricing Advisor**
- **Technology**: XGBoost regression model
- **Input**: Forecast data + `competitor_rates` + lead time + seasonality
- **Output**: Optimal rate suggestions with explanations
- **Feedback Loop**: Manager accept/reject tracked in `suppressed_yield_log`

#### **Module 3: Booking Risk Scorer**
- **Technology**: XGBoost classifier
- **Input**: Lead time, source, advance paid, payment method, party size, guest history
- **Output**: Cancellation/no-show probability scores
- **Action**: High-risk bookings flagged with advance payment recommendations

#### **Module 4: Resort Concierge (RAG)**
- **Technology**: pgvector + LLM API
- **Input**: Guest questions via website/WhatsApp
- **Process**: Vector retrieval from policies/FAQs, LLM answer generation
- **Features**: Source citations, staff review/rating, sentiment analysis on feedback

### 3.3 Technical Innovation

1. **Tenant-Isolated AI**: Models and vectors respect same RLS boundaries as transactional data
2. **Vector Search Inside RDBMS**: pgvector with HNSW index enables hybrid queries
3. **Closed Feedback Loop**: Prediction outcomes feed retraining pipelines
4. **Explainable AI**: Every prediction includes contributing factors
5. **Multilingual Support**: Embeddings handle Tamil/Hindi guest communications

### 3.4 AI Schema Extension
```sql
-- Tenant-scoped AI tables
CREATE TABLE ai_models (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    model_type VARCHAR(50),  -- 'forecast', 'pricing', 'risk', 'rag'
    version VARCHAR(20),
    performance_metrics JSONB,
    trained_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE vector_embeddings (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    content_type VARCHAR(50),  -- 'policy', 'faq', 'review'
    content_text TEXT,
    embedding VECTOR(768),
    metadata JSONB
);
```

## 4. Integration Architecture

### 4.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Sunshine Platform                        │
├──────────────┬────────────────┬─────────────────────────────┤
│  Multi-Tenant│   AI Services  │      Core Business          │
│  Foundation  │                │      Logic                  │
├──────────────┼────────────────┼─────────────────────────────┤
│ • Tenant RLS │ • Forecast     │ • Booking Management        │
│ • Auth/Admin │ • Pricing      │ • Inventory Control         │
│ • Isolation  │ • Risk Scoring │ • Payment Processing        │
│              │ • RAG Concierge│ • Guest Services            │
└──────────────┴────────────────┴─────────────────────────────┘
                          │
                    ┌─────┴─────┐
                    │ PostgreSQL│
                    │ +pgvector │
                    └───────────┘
```

### 4.2 Deployment Strategy
- **Backend**: Express.js (5000) + FastAPI AI Service (8001)
- **Database**: PostgreSQL with pgvector extension
- **Frontend**: React/Vite SPA (5173)
- **Communication**: Internal APIs between services

### 4.3 Data Flow Examples
```
Booking Creation:
Guest → Booking Form → Risk Scorer → Risk Flag → Booking Confirmation

Pricing Decision:
Historical Data → Forecast Engine → Pricing Advisor → Rate Suggestion → Manager Review

Guest Inquiry:
Question → RAG Retrieval → LLM Answer → WhatsApp/Web Response → Feedback Collection
```

## 5. Business Value Proposition

### 5.1 For Resort Owners
- **Revenue Optimization**: 10%+ estimated lift from dynamic pricing
- **Risk Reduction**: 15%+ reduction in cancellation losses
- **Efficiency**: 50%+ reduction in repetitive guest inquiries
- **Insights**: Data-driven decisions vs gut feelings

### 5.2 For Platform Operators
- **Scalable Revenue**: Multiple resorts on single deployment
- **Competitive Moats**: AI capabilities as differentiator
- **Data Network Effects**: More resorts → better models → better performance

### 5.3 For Guests
- **Better Experience**: Instant answers to common questions
- **Fair Pricing**: Market-responsive rates
- **Personalized Service**: Recognition of past preferences

## 6. Implementation Roadmap

### Phase 0: Foundation (Current)
- Complete multi-tenant migration
- Establish RLS security framework
- Deploy tenant management UI

### Phase 1: AI Infrastructure (Weeks 1-2)
- Synthetic data generation (1-2 years of realistic bookings)
- pgvector installation and configuration
- FastAPI service skeleton
- Model evaluation framework

### Phase 2: Quick Wins (Weeks 3-4)
- Booking Risk Scorer implementation
- Risk flags in booking management UI
- Initial model training pipeline

### Phase 3: Core Value (Weeks 5-8)
- Demand Forecast Engine
- Smart Pricing Advisor
- Integration with existing calendar/pricing interfaces

### Phase 4: Experience Enhancement (Weeks 9-10)
- RAG Concierge implementation
- WhatsApp integration for guest questions
- Sentiment analysis on feedback

### Phase 5: Optimization & Evaluation (Week 11)
- Performance metrics collection
- Model retraining automation
- Academic evaluation documentation

## 7. Technical Evaluation Metrics

### 7.1 AI Performance
- **Forecast Accuracy**: MAPE/sMAPE against naive baseline
- **Risk Prediction**: Precision, recall, AUC, feature importance
- **RAG Quality**: Retrieval hit-rate@5 on 30 test questions
- **Response Time**: <100ms for vector searches with HNSW index

### 7.2 System Performance
- **Tenant Isolation**: Zero cross-tenant data leakage
- **Query Latency**: <200ms for critical paths
- **Scalability**: Support for 100+ concurrent resorts
- **Uptime**: 99.9% service availability

### 7.3 Business Impact
- **Revenue Metrics**: ADR, RevPAR, occupancy rate improvements
- **Operational Efficiency**: Staff time saved on repetitive tasks
- **Guest Satisfaction**: NPS scores, review ratings

## 8. Risk Mitigation

### 8.1 Technical Risks
- **Data Quality**: Initial synthetic data training clearly documented
- **Model Bias**: Regular retraining with real data
- **Performance**: Gradual feature rollout with monitoring
- **Security**: Defense-in-depth with RLS + app-layer validation

### 8.2 Business Risks
- **Adoption**: Opt-in model for AI features
- **Pricing Sensitivity**: Human-in-the-loop for pricing decisions
- **Regulatory**: Clear data ownership and privacy policies

### 8.3 Development Risks
- **Scope Creep**: Phased delivery with clear milestones
- **Integration Complexity**: Well-defined APIs between components
- **Team Skills**: Focus on proven technologies (XGBoost, pgvector)

## 9. Success Criteria

### Short-term (3 months)
- Multi-tenant platform operational with 3+ pilot resorts
- Booking Risk Scorer active for all pilot resorts
- Initial forecast models trained and providing recommendations

### Medium-term (6 months)
- All four AI modules operational
- Demonstrated revenue lift for pilot resorts
- Automated model retraining pipeline
- 10+ resorts onboarded

### Long-term (12 months)
- Platform serving 50+ resorts
- Advanced AI features (personalized offers, dynamic packages)
- Marketplace for third-party integrations
- White-label options for larger resort groups

## 10. Unique Value Proposition

### What Makes Sunshine Different:

1. **Tenant-Isolated Intelligence**: AI that respects data boundaries - each resort's models see only its data
2. **Affordable Enterprise Capabilities**: OTA Insight/IDeaS functionality at small-resort prices
3. **Integrated Experience**: From booking to concierge in one platform
4. **Explainable Decisions**: Not just predictions, but understandable recommendations
5. **Local Market Fit**: Multilingual support for Indian resort market

## 11. Academic Contribution

For academic evaluation, the project demonstrates:
- Practical implementation of RLS for multi-tenant AI
- Real-world application of time series forecasting in hospitality
- Vector search integration within traditional RDBMS
- Closed-loop machine learning with human feedback
- Comparative analysis of model performance on synthetic vs real data

## 12. Conclusion

**Sunshine** represents a comprehensive evolution from basic booking software to intelligent resort management platform. By combining robust multi-tenant architecture with practical AI capabilities, it addresses real pain points for small/mid-sized resorts while providing a scalable business model for platform operators.

The phased approach ensures manageable complexity, with each phase delivering tangible value. The foundation of tenant isolation enables secure, scalable deployment of increasingly sophisticated AI features, creating a platform that grows in capability alongside its users' needs.

This vision positions Sunshine not just as another booking system, but as the intelligent operating system for modern resorts - combining transactional efficiency with predictive intelligence in a secure, affordable package.