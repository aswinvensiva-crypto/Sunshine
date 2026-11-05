/**
 * migrate-ai.js — adds AI/IQ tables to an already-migrated Sunshine database.
 * Run with: node db/migrate-ai.js
 * Must run AFTER db/migrate.js (multi-tenant migration must be complete).
 *
 * NOTE (2026-10): The `forecasts` table stores output from whichever forecast
 * model is configured via the FORECAST_MODEL env var in ai-service/.env:
 *   "timesfm"  — Google TimesFM (GPU, higher accuracy, default)
 *   "chronos"  — Amazon Chronos-T5-Small (CPU-only fallback)
 *   "naive"    — Seasonal-naive deterministic baseline
 * The model_version column records which engine produced each row.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'sunshine',
});

const AI_TENANT_TABLES = [
  'ai_models',
  'vector_embeddings',
  'forecasts',
  'price_suggestions',
  'risk_scores',
  'concierge_conversations',
  'concierge_messages',
  'feedback_items',
  'tenant_channels',
  'ai_audit_log',
];

const TENANT_DEFAULT_SQL = `NULLIF(current_setting('app.current_tenant_id', true), '')::integer`;

function quoteIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

function quoteLiteral(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const DDL_STEPS = [
  {
    name: 'ai_models table',
    sql: `CREATE TABLE IF NOT EXISTS ai_models (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  model_type VARCHAR(50) NOT NULL CHECK (model_type IN ('forecast','pricing','risk','rag')),
  version VARCHAR(50) NOT NULL,
  performance_metrics JSONB,
  artifact_path TEXT,
  artifact_checksum TEXT,
  data_source VARCHAR(20) NOT NULL DEFAULT 'synthetic' CHECK (data_source IN ('real','synthetic','mixed')),
  trained_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);`,
  },
  {
    name: 'uq_ai_models_active index',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_models_active ON ai_models (tenant_id, model_type) WHERE is_active = true;`,
  },
  {
    name: 'vector extension',
    sql: `CREATE EXTENSION IF NOT EXISTS vector;`,
  },
  {
    name: 'vector_embeddings table',
    sql: `CREATE TABLE IF NOT EXISTS vector_embeddings (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('policy','faq','review')),
  content_text TEXT NOT NULL,
  embedding VECTOR(768),
  metadata JSONB NOT NULL DEFAULT '{}',
  source_version TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);`,
  },
  {
    name: 'idx_vector_embeddings_tenant index',
    sql: `CREATE INDEX IF NOT EXISTS idx_vector_embeddings_tenant ON vector_embeddings (tenant_id);`,
  },
  {
    name: 'idx_vector_embeddings_hnsw index',
    sql: `CREATE INDEX IF NOT EXISTS idx_vector_embeddings_hnsw ON vector_embeddings USING hnsw (embedding vector_cosine_ops);`,
  },
  {
    name: 'forecasts table',
    sql: `CREATE TABLE IF NOT EXISTS forecasts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  forecast_date DATE NOT NULL,
  p10 NUMERIC(5,2),
  p50 NUMERIC(5,2),
  p90 NUMERIC(5,2),
  model_version VARCHAR(50),
  data_source VARCHAR(20) NOT NULL DEFAULT 'synthetic',
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, room_type_id, forecast_date)
);`,
  },
  {
    name: 'idx_forecasts_tenant index',
    sql: `CREATE INDEX IF NOT EXISTS idx_forecasts_tenant ON forecasts (tenant_id, room_type_id, forecast_date);`,
  },
  {
    name: 'price_suggestions table',
    sql: `CREATE TABLE IF NOT EXISTS price_suggestions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  suggestion_date DATE NOT NULL,
  suggested_rate NUMERIC(10,2) NOT NULL,
  factors JSONB NOT NULL DEFAULT '[]',
  clamped BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','edited')),
  decided_rate NUMERIC(10,2),
  decided_by INTEGER REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  model_version VARCHAR(50),
  data_source VARCHAR(20) NOT NULL DEFAULT 'synthetic',
  created_at TIMESTAMPTZ DEFAULT now()
);`,
  },
  {
    name: 'idx_price_suggestions_tenant index',
    sql: `CREATE INDEX IF NOT EXISTS idx_price_suggestions_tenant ON price_suggestions (tenant_id, status, suggestion_date);`,
  },
  {
    name: 'risk_scores table',
    sql: `CREATE TABLE IF NOT EXISTS risk_scores (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  cancel_prob NUMERIC(5,4),
  noshow_prob NUMERIC(5,4),
  band VARCHAR(20) NOT NULL DEFAULT 'unscored' CHECK (band IN ('low','medium','high','unscored')),
  factors JSONB NOT NULL DEFAULT '[]',
  recommended_advance NUMERIC(10,2),
  model_version VARCHAR(50),
  data_source VARCHAR(20) NOT NULL DEFAULT 'synthetic',
  status VARCHAR(20) NOT NULL DEFAULT 'scored' CHECK (status IN ('scored','unscored','error')),
  scored_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, booking_id)
);`,
  },
  {
    name: 'idx_risk_scores_tenant index',
    sql: `CREATE INDEX IF NOT EXISTS idx_risk_scores_tenant ON risk_scores (tenant_id, booking_id);`,
  },
  {
    name: 'concierge_conversations table',
    sql: `CREATE TABLE IF NOT EXISTS concierge_conversations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  channel VARCHAR(20) NOT NULL DEFAULT 'web' CHECK (channel IN ('web','whatsapp')),
  external_id TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','handoff')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);`,
  },
  {
    name: 'idx_concierge_conv_tenant index',
    sql: `CREATE INDEX IF NOT EXISTS idx_concierge_conv_tenant ON concierge_conversations (tenant_id, status);`,
  },
  {
    name: 'concierge_messages table',
    sql: `CREATE TABLE IF NOT EXISTS concierge_messages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  conversation_id INTEGER NOT NULL REFERENCES concierge_conversations(id),
  role VARCHAR(20) NOT NULL CHECK (role IN ('guest','assistant','system')),
  content TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]',
  confidence NUMERIC(5,4),
  handoff BOOLEAN NOT NULL DEFAULT false,
  staff_rating INTEGER CHECK (staff_rating BETWEEN 1 AND 5),
  model_version VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now()
);`,
  },
  {
    name: 'idx_concierge_msgs_conv index',
    sql: `CREATE INDEX IF NOT EXISTS idx_concierge_msgs_conv ON concierge_messages (tenant_id, conversation_id);`,
  },
  {
    name: 'feedback_items table',
    sql: `CREATE TABLE IF NOT EXISTS feedback_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  source VARCHAR(50) NOT NULL DEFAULT 'guest_feedback',
  content_text TEXT NOT NULL,
  language VARCHAR(20),
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive','neutral','negative','unclassified')),
  sentiment_confidence NUMERIC(5,4),
  is_synthetic BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);`,
  },
  {
    name: 'idx_feedback_items_tenant index',
    sql: `CREATE INDEX IF NOT EXISTS idx_feedback_items_tenant ON feedback_items (tenant_id, created_at);`,
  },
  {
    name: 'tenant_channels table',
    sql: `CREATE TABLE IF NOT EXISTS tenant_channels (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
  channel_id TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (channel, channel_id)
);`,
  },
  {
    name: 'idx_tenant_channels_tenant index',
    sql: `CREATE INDEX IF NOT EXISTS idx_tenant_channels_tenant ON tenant_channels (tenant_id);`,
  },
  {
    name: 'ai_audit_log table',
    sql: `CREATE TABLE IF NOT EXISTS ai_audit_log (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  module VARCHAR(50) NOT NULL,
  request_id TEXT,
  latency_ms INTEGER,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('ok','degraded','error','unscored')),
  model_version VARCHAR(50),
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);`,
  },
  {
    name: 'idx_ai_audit_tenant index',
    sql: `CREATE INDEX IF NOT EXISTS idx_ai_audit_tenant ON ai_audit_log (tenant_id, module, created_at);`,
  },
];

async function run() {
  console.log('[migrate-ai] Starting Sunshine AI / IQ schema migration...');
  const client = await pool.connect();
  let hasError = false;

  try {
    // 1. Create tables and indexes
    console.log('\n[migrate-ai] 1. Creating AI tables & indexes...');
    for (const step of DDL_STEPS) {
      try {
        await client.query(step.sql);
        console.log(`  [OK] ${step.name}`);
      } catch (err) {
        console.error(`  [FAIL] ${step.name}:`, err.message);
        hasError = true;
      }
    }

    // 2. Apply Row-Level Security and isolation policy to all AI tenant tables
    console.log('\n[migrate-ai] 2. Applying Row-Level Security (RLS)...');
    for (const table of AI_TENANT_TABLES) {
      try {
        const tableCheck = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
          [table]
        );
        if (!tableCheck.rows.length) {
          console.warn(`  [SKIP] Table ${table} does not exist, skipping RLS`);
          continue;
        }

        await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        await client.query(`DROP POLICY IF EXISTS tenant_isolation ON ${table}`);
        await client.query(`
          CREATE POLICY tenant_isolation ON ${table}
            USING (tenant_id = ${TENANT_DEFAULT_SQL})
            WITH CHECK (tenant_id = ${TENANT_DEFAULT_SQL})
        `);
        await client.query(
          `ALTER TABLE ${table} ALTER COLUMN tenant_id SET DEFAULT ${TENANT_DEFAULT_SQL}`
        );
        console.log(`  [OK] RLS enabled and policy applied on ${table}`);
      } catch (err) {
        console.error(`  [FAIL] RLS on ${table}:`, err.message);
        hasError = true;
      }
    }

    // 3. Grant permissions to application role
    console.log('\n[migrate-ai] 3. Granting permissions to app role...');
    try {
      const appUser = process.env.DB_APP_USER || 'sunshine_app';
      const appPassword = process.env.DB_APP_PASSWORD || 'sunshine_app';

      const roleCheck = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
      if (!roleCheck.rows[0]) {
        await client.query(
          `CREATE ROLE ${quoteIdent(appUser)} LOGIN PASSWORD ${quoteLiteral(appPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE`
        );
        console.log(`  [OK] Created app role '${appUser}'`);
      }

      await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(appUser)}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdent(appUser)}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(appUser)}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdent(appUser)}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quoteIdent(appUser)}`);
      console.log(`  [OK] Granted permissions on public tables and sequences to '${appUser}'`);
    } catch (err) {
      console.error('  [FAIL] Granting permissions:', err.message);
      hasError = true;
    }

    if (hasError) {
      console.error('\n[migrate-ai] Migration completed WITH ERRORS.');
      process.exitCode = 1;
    } else {
      console.log('\n[migrate-ai] All AI migration steps completed successfully.');
    }
  } catch (err) {
    console.error('\n[migrate-ai] Unexpected migration failure:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  run();
}

module.exports = { run, AI_TENANT_TABLES };
