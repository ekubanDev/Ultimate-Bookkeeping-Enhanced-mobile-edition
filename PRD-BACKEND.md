# Backend PRD — Ultimate Bookkeeping Enhanced
*Last updated: 2026-04-14*

---

## 1. Purpose & Scope

This document defines the product requirements for the backend of Ultimate Bookkeeping Enhanced. The backend is a **Python FastAPI** application deployed on **Google Cloud Run** (`us-central1`). It provides AI inference, report computation, email dispatch, metrics ingestion, and an MCP server for AI tool integrations.

The backend does **not** own primary data — all business records (sales, expenses, inventory, etc.) live in **Firebase Firestore** and are read directly by the frontend via the Firebase SDK. The backend is called only for operations that require server-side computation, LLM access, external APIs, or authorisation enforcement.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Language | Python 3.11 |
| Framework | FastAPI 0.110.1 |
| ASGI server | Uvicorn 0.25.0 |
| Data validation | Pydantic v2 |
| Database (metrics/status) | MongoDB via Motor 3.3.1 (async) |
| LLM — primary | emergentintegrations (GPT-5.2 via `EMERGENT_LLM_KEY`) |
| LLM — fallback | OpenAI SDK (`gpt-4o`) |
| Auth | Firebase Admin SDK 6.x (ID token verification) |
| Email | aiosmtplib (Gmail SMTP) |
| Scheduling | APScheduler 3.10+ |
| MCP server | Custom `mcp_server.py` |
| Containerisation | Docker (python:3.11-slim) |
| Deployment | Google Cloud Run — `bookkeeping-api`, `us-central1` |
| CI build | `gcloud builds submit` → GCR |

---

## 3. Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `EMERGENT_LLM_KEY` | Yes (AI features) | API key for emergentintegrations LLM (GPT-5.2) |
| `MONGO_URL` | Yes (metrics/status) | MongoDB connection string |
| `GMAIL_USER` | Yes (email) | Gmail address for SMTP send |
| `GMAIL_APP_PASSWORD` | Yes (email) | Gmail app password |
| `CORS_ORIGINS` | No | Comma-separated allowed origins (default `*`) |
| `AI_CHAT_REQUIRE_AUTH` | No | `true`/`false` — force Firebase auth on AI endpoints. Default: on when `K_SERVICE` is set (Cloud Run) |
| `K_SERVICE` | Auto (Cloud Run) | Signals production environment |

---

## 4. Authentication & Authorisation

### 4.1 Firebase ID Token Verification (`firebase_auth.py`)
- `verify_bearer_id_token(authorization_header)` — decodes and verifies the Firebase JWT from `Authorization: Bearer <token>`
- `ensure_firebase_admin_app()` — lazy-init Firebase Admin SDK using Application Default Credentials
- `ai_chat_auth_enforced()` — returns `True` when `K_SERVICE` is set or `AI_CHAT_REQUIRE_AUTH=true`

### 4.2 Rate limiting
- `check_ai_chat_rate_limit(uid)` — per-UID in-memory rate limiter for AI endpoints
- Returns `PermissionError` if limit exceeded (→ HTTP 429)

### 4.3 Auth gate pattern
Applied to all AI endpoints (`/ai/chat`, `/ai/po-suggest`, `/ai/insights`, `/ai/forecast/*`):
```
if ai_chat_auth_enforced():
    claims = verify_bearer_id_token(authorization)
    uid = claims.get("uid") or claims.get("sub")
    check_ai_chat_rate_limit(uid)
```
Non-AI endpoints (email, reports, metrics) do not enforce Firebase auth — they rely on the frontend's own Firebase session.

---

## 5. LLM Abstraction (`call_llm`)

```python
async def call_llm(api_key, system_message, prompt) -> str
```

- If `emergentintegrations` is installed: routes to `LlmChat` with GPT-5.2, new session UUID per call
- Otherwise: falls back to `AsyncOpenAI` with `gpt-4o`, temperature 0.7, max 1000 tokens
- All AI endpoints use this single abstraction — swapping the LLM provider requires changing one function

---

## 6. API Endpoints

Base path: `/api` (rewritten from Firebase Hosting → Cloud Run)

### 6.1 Health & Status

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | None | Service info |
| `GET` | `/health` | None | Liveness check |
| `POST` | `/status` | None | Create status check (MongoDB) |
| `GET` | `/status` | None | List status checks |

---

### 6.2 AI — Insights

**`POST /ai/insights`**

**Auth:** Firebase token (when enforced)

**Request:**
```json
{
  "sales_data": [...],
  "expenses_data": [...],
  "products_data": [...],
  "period": "month",
  "analysis_type": "general"
}
```

**Processing:**
- Computes revenue, COGS, gross profit, top products, top expenses, inventory value server-side
- Revenue calculated with discount + tax alignment (`_insights_sale_line_revenue`)
- COGS computed from product cost × quantity sold
- Builds a structured business context for the LLM prompt
- Returns AI-generated insights, recommendations, and alerts

**Response:**
```json
{
  "insights": "string",
  "recommendations": ["..."],
  "alerts": ["..."],
  "forecast": {}
}
```

---

### 6.3 AI — Forecast (basic)

**`POST /ai/forecast`**

**Auth:** Firebase token (when enforced)

**Request:**
```json
{
  "historical_sales": [...],
  "forecast_days": 30
}
```

**Processing:** Simple moving average on historical revenue.

**Response:** `{ "forecast": [...], "trend": "up|down|stable" }`

---

### 6.4 AI — Advanced Forecast

**`POST /ai/forecast/advanced`**

**Auth:** Firebase token (when enforced)

**Request:**
```json
{
  "historical_sales": [...],
  "products_data": [...],
  "forecast_days": 30,
  "include_product_forecast": false
}
```

**Processing:**
1. **Linear regression** on daily revenue over the historical window
2. **Day-of-week seasonality** — 7-bucket multipliers from historical averages
3. **Confidence intervals** — ±1 standard deviation of residuals
4. **Product demand forecasting** (when `include_product_forecast: true`):
   - Per-product daily velocity
   - Stockout date estimate: `current_stock / avg_daily_sales`
   - Reorder quantity: velocity × target days
5. Optional **AI narrative summary** via `call_llm`

**Response:**
```json
{
  "forecast_points": [{ "date", "predicted", "lower", "upper" }],
  "weekly_pattern": { "Mon": 1.1, "Tue": 0.9, ... },
  "monthly_history": [...],
  "product_forecasts": [...],
  "summary": "AI narrative (optional)",
  "kpis": { "projected_revenue", "projected_profit", "avg_daily", "trend" }
}
```

---

### 6.5 AI — General Chat

**`POST /ai/chat`**

**Auth:** Firebase token (when enforced) + per-UID rate limit

**Request:**
```json
{
  "question": "string",
  "context": {},
  "datasets": { "products": [...], "sales": [...], "purchase_orders": [...] },
  "history": [{ "role": "user|assistant", "content": "string" }]
}
```

**Processing:**
1. `_sanitize_chat_datasets()` — caps dataset sizes to prevent token overflow
2. `compute_business_snapshot(datasets)` → structured metrics object
3. `snapshot_json_for_prompt()` → compact JSON string for LLM context
4. System prompt: business advisor, Ghana Cedi (₵), snapshot as source of truth
5. Routes to `call_llm` (emergentintegrations) or `_ai_chat_with_openai_tools` (OpenAI tool-calling fallback)

**Response:**
```json
{
  "response": "string",
  "agent_mode": "snapshot_prompt|openai_tools",
  "snapshot_meta": "ISO timestamp"
}
```

**Important:** This endpoint always responds conversationally due to the business-advisor system prompt. Do not use it for structured JSON output. Use `/ai/po-suggest` for machine-readable responses.

---

### 6.6 AI — PO Quantity Suggestions

**`POST /ai/po-suggest`**

**Auth:** Firebase token (when enforced) + per-UID rate limit

**Request:**
```json
{
  "products": [
    {
      "name": "string",
      "currentStock": 0,
      "minStock": 10,
      "unitsSoldLast90Days": 180,
      "avgDailySales": 2.0
    }
  ]
}
```

**Processing:**
1. If `EMERGENT_LLM_KEY` is missing: returns rule-based quantities immediately (no LLM call)
2. Otherwise: calls `call_llm` with a tight system prompt demanding a raw JSON array only
3. Parses response with two fallback strategies:
   - Strategy A: `json.loads(stripped_response)`
   - Strategy B: slice from first `[` to last `]`
4. If parsing fails: falls back to rule-based computation server-side
5. Rule-based formula: `max(minStock, ceil(avgDailySales × 45) − currentStock)`
6. Validates and sanitises every suggestion: enforces positive integer `qty`

**Response:**
```json
{
  "suggestions": [
    { "name": "string", "qty": 144, "reason": "string" }
  ],
  "mode": "ai | rule_based | rule_based_fallback"
}
```

**Design principle:** This endpoint never errors due to LLM failure — it always returns useful quantities via the rule-based fallback. The `mode` field tells the frontend which path was taken.

---

### 6.7 Reports

**`POST /reports/generate`**

**Auth:** None (frontend Firebase session assumed)

**Request:**
```json
{
  "report_type": "tax_summary | ar_aging | period_comparison",
  "sales_data": [...],
  "expenses_data": [...],
  "products_data": [...],
  "customers_data": [...],
  "liabilities_data": [...],
  "date_start": "YYYY-MM-DD",
  "date_end": "YYYY-MM-DD",
  "business_name": "string",
  "include_ai_summary": false
}
```

**Report types:**

| Type | Computation |
|---|---|
| `tax_summary` | Output tax (sales × tax rate), input tax (expenses × tax rate), net payable, breakdown by tax rate bucket |
| `ar_aging` | Outstanding balances per customer bucketed by age: current, 30d, 60d, 90d+ |
| `period_comparison` | Revenue, expenses, profit, transaction count for selected period vs. equivalent prior period, with % change |

**Response:**
```json
{
  "report_type": "string",
  "data": { ... },
  "ai_summary": "string (if requested)",
  "generated_at": "ISO timestamp"
}
```

---

### 6.8 Email

| Method | Path | Description |
|---|---|---|
| `POST` | `/email/stock-alert` | Email admin when products are low/out of stock |
| `POST` | `/email/send-report` | Email daily or weekly summary report |
| `POST` | `/email/test` | Send test email to verify configuration |
| `POST` | `/email/settings` | Update email notification schedule (daily/weekly toggle) |

**Email service:** `aiosmtplib` SMTP over Gmail. Requires `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
**Scheduler:** `APScheduler` — `report_scheduler` starts on app startup; stops on shutdown. Schedule updated via `/email/settings`.

If email is not configured (missing credentials): all email endpoints return HTTP 503.

---

### 6.9 Metrics

**`POST /metrics/events`**

**Auth:** None (best-effort ingestion)

**Request:** `MetricsEventRequest` — `event_name`, `event_version`, `event_id`, `correlation_id`, `timestamp_client`, `actor`, `context`, `payload` (extra fields allowed)

**Processing:**
- Inserts into MongoDB `metrics_events` collection
- If MongoDB is unavailable: accepts event and logs it, does not error
- Server-side timestamp stamped as `timestamp_server`
- Intentionally resilient — never fails frontend UX

**`GET /metrics/events/health`**

Returns ingestion counts for last 1h and 24h from MongoDB.

---

### 6.10 MCP Server (`mcp_server.py`)

**Protocol:** Model Context Protocol (MCP)

Exposes business data as LLM-callable tools:
- `get_sales_summary` — aggregated revenue and transaction counts
- `get_inventory_status` — product stock levels and valuations
- `get_expense_breakdown` — categorised expense totals
- `get_customer_insights` — top customers, repeat rate, outstanding balances
- `get_purchase_orders` — PO list and statuses

Used by agentic AI workflows and coworker integrations. The MCP server runs as a separate process alongside the FastAPI app.

---

### 6.11 CORS

All routes prefixed with `/api`. A catch-all `OPTIONS /{full_path:path}` handler returns HTTP 204 to ensure Cloud Run never returns 404 for preflight requests. `CORSMiddleware` applied with `allow_origins` from `CORS_ORIGINS` env var (default `*`).

---

## 7. Business Snapshot (`ai_chat_tools.py`)

`compute_business_snapshot(datasets)` is the shared computation used by both `/ai/chat` and `/ai/insights`. It produces:

| Field | Computation |
|---|---|
| `total_revenue` | Sum of `getSaleTotal`-equivalent per sale |
| `total_expenses` | Sum of expense amounts |
| `gross_profit` | Revenue − COGS |
| `net_profit` | Gross profit − operating expenses |
| `top_products` | Top 5 by revenue contribution |
| `top_expense_categories` | Top 5 categories by spend |
| `inventory_value` | Sum of `cost × quantity` per product |
| `low_stock_count` | Products below `minStock` |
| `out_of_stock_count` | Products with `quantity ≤ 0` |
| `computed_at` | ISO timestamp |

`snapshot_json_for_prompt()` serialises this to a compact JSON string for injection into LLM prompts.

---

## 8. Data Models

### Primary (defined in `server.py`)

| Model | Fields |
|---|---|
| `StatusCheck` | `id`, `client_name`, `timestamp` |
| `AIInsightsRequest` | `sales_data`, `expenses_data`, `products_data`, `period`, `analysis_type` |
| `AIInsightsResponse` | `insights`, `recommendations`, `alerts`, `forecast` |
| `ForecastRequest` | `historical_sales`, `forecast_days` |
| `AdvancedForecastRequest` | `historical_sales`, `products_data`, `forecast_days`, `include_product_forecast` |
| `ReportRequest` | `report_type`, `sales_data`, `expenses_data`, `products_data`, `customers_data`, `liabilities_data`, `date_start`, `date_end`, `business_name`, `include_ai_summary` |
| `StockAlertEmailRequest` | `products`, `recipient`, `business_name` |
| `SendReportRequest` | `report_type`, `data`, `recipient`, `business_name` |
| `MetricsEventRequest` | `event_name`, `event_version`, `event_id`, `correlation_id`, `timestamp_client`, `actor`, `context`, `payload` + extra fields allowed |

### MongoDB collections

| Collection | Purpose |
|---|---|
| `status_checks` | Health check records |
| `metrics_events` | Frontend product metrics; indexed on `received_at_dt DESC` |

---

## 9. Deployment

| Concern | Detail |
|---|---|
| Container | `python:3.11-slim`; built via `gcloud builds submit backend/ --tag gcr.io/bookkeeping-211e6/bookkeeping-api` |
| Service | Cloud Run `bookkeeping-api`, region `us-central1` |
| Traffic | 100% to latest revision after `gcloud run services update-traffic --to-latest` |
| URL | `https://bookkeeping-api-pa2mgu6f2q-uc.a.run.app` |
| Routing | Firebase Hosting rewrites `/api/**` → Cloud Run service |
| Scaling | Cloud Run auto-scales; cold start mitigated by keeping min instances ≥ 1 (recommended) |

---

## 10. Performance & Reliability Requirements

| Metric | Target |
|---|---|
| AI endpoint P95 latency | ≤ 4s (LLM calls are the bottleneck) |
| `/ai/po-suggest` with rule-based fallback | ≤ 200ms |
| `/reports/generate` | ≤ 2s for datasets up to 10k rows |
| `/metrics/events` | ≤ 100ms (best-effort; never blocks UI) |
| Email dispatch | Best-effort async; failures logged, not surfaced to user |
| Availability | ≥ 99.5% (Cloud Run SLA) |

---

## 11. Security Requirements

| Requirement | Implementation |
|---|---|
| AI endpoints auth-gated in production | `ai_chat_auth_enforced()` + Firebase ID token |
| Per-user AI rate limiting | `check_ai_chat_rate_limit(uid)` — in-memory |
| No business data stored server-side | All Firestore reads done client-side; backend receives only what the frontend sends in the request body |
| LLM key never exposed to client | `EMERGENT_LLM_KEY` only on server |
| CORS scoped | `CORS_ORIGINS` env var; default `*` (tighten in production) |
| Input validation | All request bodies validated by Pydantic v2 |
| LLM response sanitisation | `/ai/po-suggest` validates and clamps every suggestion item before returning |

---

## 12. Known Gaps / Open Items

| Item | Priority | Notes |
|---|---|---|
| Tighten CORS origins in production | High | Currently `*`; should be locked to `bookkeeping-211e6.web.app` |
| Persist AI rate limit state across instances | Medium | Currently in-memory; resets on pod restart / scale-out |
| `/ai/chat` response format contract | Medium | Conversational by design; callers must not expect JSON |
| MCP server production deployment | Medium | `mcp_server.py` exists but deployment process not documented |
| MongoDB connection pooling config | Low | Motor defaults; review for high-concurrency |
| Structured logging | Low | Currently `logger.info/warning/error`; add JSON structured format for Cloud Logging |
| `/ai/forecast` basic endpoint deprecation | Low | Superseded by `/ai/forecast/advanced`; can be removed |
| Report types: `stock_movement` | Low | Listed in `ReportRequest` model but not yet implemented |

---

## 13. File Reference

```
backend/
├── server.py           # All FastAPI routes, Pydantic models, computation helpers
├── ai_chat_tools.py    # compute_business_snapshot(), snapshot_json_for_prompt()
├── firebase_auth.py    # Firebase Admin init, token verification, rate limiting
├── mcp_server.py       # MCP server exposing business data as LLM tools
├── requirements.txt    # Production dependencies
├── requirements-mcp.txt# MCP-specific dependencies
└── Dockerfile          # python:3.11-slim, uvicorn entrypoint
```
