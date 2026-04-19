# Metrics Event Schema

This document defines a minimal, consistent event contract for measuring KPI outcomes in `PRODUCT_PRIORITIES.md`.

## Event Envelope (all events)

```json
{
  "event_name": "string",
  "event_version": 1,
  "event_id": "uuid",
  "correlation_id": "uuid",
  "timestamp_client": "ISO-8601",
  "timestamp_server": "ISO-8601|null",
  "actor": {
    "user_id": "string",
    "user_role": "admin|outlet_manager|unknown",
    "assigned_outlet": "string|null"
  },
  "context": {
    "selected_outlet_filter": "main|all|outlet_id|null",
    "section": "dashboard|sales|inventory|expenses|customers|analytics|accounting|liabilities|outlets|settlements|pos|reports|settings|other",
    "platform": "web|ios|android|unknown",
    "app_version": "string|null",
    "release_sha": "string|null"
  },
  "payload": {}
}
```

## Required Conventions

- Use one `correlation_id` per user action flow:
  - open/trigger -> submit -> write -> refresh -> outcome.
- Emit both client and server timestamps where available.
- Never include PII beyond stable IDs and role context.
- Use lowercase snake_case for event names and payload fields.

## Canonical Events

## 1) Workflow Timing + Abandonment

### `flow_started`
Payload:
- `flow_name`: `add_sale|record_liability_payment|generate_settlement|export_report|checkout`
- `entry_point`: `button|nav|modal|shortcut|other`

### `flow_step`
Payload:
- `flow_name`
- `step_name`
- `step_index`

### `flow_completed`
Payload:
- `flow_name`
- `duration_ms`
- `result`: `success|cancelled|blocked`

### `flow_abandoned`
Payload:
- `flow_name`
- `last_step_name`
- `duration_ms`

## 2) Write Reliability

### `write_attempted`
Payload:
- `entity`: `sale|expense|liability|liability_payment|settlement|transfer|consignment|customer|product|settings`
- `target_collection`: Firestore path string

### `write_succeeded`
Payload:
- `entity`
- `target_collection`
- `document_id`
- `duration_ms`

### `write_failed`
Payload:
- `entity`
- `target_collection`
- `duration_ms`
- `error_code`
- `error_message`

## 3) Freshness (write -> visible refresh)

### `section_refresh_started`
Payload:
- `section`
- `reason`: `snapshot|manual_reload|post_write|filter_change|auth_switch`

### `section_refresh_completed`
Payload:
- `section`
- `reason`
- `duration_ms`
- `visible_record_count`: number

### `post_action_freshness`
Payload:
- `entity`
- `section`
- `freshness_ms`

## 4) Data Trust / Parity

### `parity_check_executed`
Payload:
- `period`: `YYYY-MM|YYYY|custom`
- `scope`: `main|all|outlet_id`
- `metrics_checked`: array of `revenue|operating_expenses|debt_payments|net_profit|cogs`

### `parity_check_failed`
Payload:
- `period`
- `scope`
- `metric_name`
- `source_a`: `dashboard|accounting|reports|export_pdf|export_csv`
- `source_b`
- `delta_amount`

### `parity_check_passed`
Payload:
- `period`
- `scope`
- `checked_count`

## 5) Settlement Reliability

### `settlement_generation_attempted`
Payload:
- `outlet_id`
- `period`

### `settlement_generation_succeeded`
Payload:
- `outlet_id`
- `period`
- `settlement_id`
- `duration_ms`

### `settlement_generation_failed`
Payload:
- `outlet_id`
- `period`
- `duration_ms`
- `error_code`
- `error_message`

### `settlement_formula_mismatch`
Payload:
- `outlet_id`
- `period`
- `computed_amount_payable`
- `stored_amount_payable`
- `delta_amount`

## 6) Role Leakage / Access Control

### `access_denied`
Payload:
- `resource`: `section|action|export|modal`
- `resource_name`
- `required_role`
- `actor_role`

## 7) Runtime Errors

### `runtime_error`
Payload:
- `surface`: `frontend|service_worker|backend`
- `section`
- `error_name`
- `error_message`
- `stack_hash`

## KPI Mapping (quick)

- Data trust parity: `parity_check_*`
- Post-action freshness: `write_*`, `section_refresh_*`, `post_action_freshness`
- Settlement reliability: `settlement_generation_*`, `settlement_formula_mismatch`
- Role leakage: `access_denied`
- Task completion time: `flow_started`, `flow_completed`
- Runtime + write errors: `runtime_error`, `write_failed`
- Workflow abandonment: `flow_abandoned`
- Release safety: aggregate `parity_check_failed`, `write_failed`, `runtime_error` by `release_sha`

## Minimal Implementation Plan

1. Frontend emits `flow_*`, `write_*`, `section_refresh_*`, `access_denied`, `runtime_error`.
2. Backend attaches `timestamp_server` and persists events.
3. Weekly job computes KPI rollups and writes summary docs.
4. Planning review reads KPI rollups before feature commitments.

