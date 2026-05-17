# Product Priorities

This project optimizes for trusted bookkeeping outcomes, not feature count.

## Product North Star

Help admins and outlet managers close each day and month with confidence, speed, and clear accountability.

## Core Principles

- Trust beats novelty: a wrong number is worse than a missing feature.
- Outcome over output: measure value by completion and confidence, not screens added.
- Role-first UX: admin and outlet-manager paths should be distinct and minimal.
- Reduce carry cost: every setting/workflow added must justify support and maintenance impact.

## Primary Users

- Admin: cross-outlet control, liabilities, settlements, reports, compliance visibility.
- Outlet Manager: fast POS and daily operations with minimal accounting complexity.

## Weekly Product Scorecard

Track weekly and review in planning.

| KPI | Definition | Target |
|---|---|---|
| Data trust parity | % sampled periods where Dashboard, Accounting, Reports, and Exports agree on key totals | >= 99% |
| Post-action freshness | Time from write to visible update in active section | <= 2s P95 |
| Settlement reliability | Successful settlements / attempts, and formula mismatch rate | >= 99% success, <= 1% mismatch |
| Role leakage | Outlet manager access attempts to admin-only actions | 0 |
| Task completion time | P50/P95 for Add Sale, Record Liability Payment, Generate Close Report | -15% quarter-over-quarter |
| Runtime + write errors | JS runtime errors + failed Firestore writes per 100 sessions | <= 1 / 100 |
| Support friction | Reports of stale/wrong numbers or blocked flows | Downward trend weekly |
| Workflow abandonment | Started but not completed key workflows | <= 5% |
| Release safety | Releases introducing data/accounting regressions | 0 |

## Keep / Simplify / Postpone

### Keep (core value)

- POS checkout and sales capture
- Inventory + stock movement
- Expenses + liabilities + payments
- Outlet management + settlements
- Reports/exports
- Role-based access controls

### Simplify (next)

- Dashboard controls and duplicated metric views
- Accounting labels and category clarity (Operating vs Financing)
- Frequent modal-heavy flows
- Outlet context clarity (Main vs Outlet vs Consolidated)
- Report menu complexity

### Postpone (until trust targets hold)

- New AI automations beyond proven pain points
- Extra approval workflows
- Advanced forecasting variants
- Deep customization that increases support burden

## 4-Week Execution Focus

### Week 1: Trust baseline

- Enforce canonical accounting classification rules in one shared path.
- Add parity checks for key totals across dashboard/accounting/reports/exports.

### Week 2: Freshness + reliability

- Ensure all data-backed sections refresh after writes/snapshots.
- Add write-time guardrails for undefined/misclassified fields.

### Week 3: Workflow speed

- Reduce friction in POS checkout, liability payment, and settlement generation.
- Measure completion times and abandonment.

### Week 4: Role clarity

- Tighten role-specific navigation and actions.
- Remove low-use controls from frontline views.

## Feature Decision Gate (Must pass all)

Before adding any feature, require:

1. User clarity: which role benefits most?
2. Problem clarity: what pain is removed?
3. Outcome metric: which scorecard KPI improves?
4. Carry-cost check: support/QA/data complexity impact is acceptable.
5. Simpler alternative reviewed: can we simplify an existing flow instead?

If any item is unclear, defer.

## Acceptance Criteria Template

Use this template in PRs and planning:

- User/role:
- Problem:
- Expected behavior change:
- KPI impacted:
- Baseline metric:
- Target metric:
- Rollout risk:
- Rollback plan:
- What we are explicitly not building:

## KPI Measurement Map

Use this map to make each KPI observable with existing project data.

| KPI | Primary Firestore sources | UI surfaces to reconcile | Event/log source |
|---|---|---|---|
| Data trust parity | `sales`, `users/{uid}/outlets/{outletId}/outlet_sales`, `expenses`, `outlets/{outletId}/outlet_expenses`, `liabilities`, `payment_transactions` | Dashboard, Accounting, Reports, Export/PDF outputs | Add a weekly parity-check job or admin action log |
| Post-action freshness | Same write target used by action (sales/expenses/liabilities/payments/transfers) | Active section after write (Sales, Inventory, Expenses, Liabilities, Dashboard, Outlets) | Client timestamps: write start vs first visible render |
| Settlement reliability | `users/{uid}/outlets/{outletId}/settlements`, `.../consignments`, `.../outlet_sales`, `.../outlet_inventory` | Settlements list + settlement details modal | Settlement generation success/failure counter |
| Role leakage | N/A (authorization behavior) | Restricted nav/actions for outlet manager | Toast/log events for blocked access attempts |
| Task completion time | Action-specific collections (e.g., sales, payment_transactions, settlements) | Add Sale, Record Liability Payment, Generate Settlement/Report flows | Client timing spans from modal open to success toast |
| Runtime + write errors | Any target collection, plus service worker/network logs | All sections | Global error handler + write exception logging |
| Support friction | N/A direct | User-reported screens (dashboard, POS, accounting, settlements) | Ticket tags or in-app feedback labels |
| Workflow abandonment | N/A direct | Key modal flows: checkout, payment, settlement, export | Start event without success event within timeout window |
| Release safety | All high-risk accounting and sync paths | Regression-prone sections (Dashboard/Accounting/Outlets/POS) | Release checklist + post-release incident count |

## Instrumentation Notes

- Use one correlation id per user action (open modal -> submit -> write -> UI refresh).
- Prefer server timestamps for write success events; client timestamps for UX latency.
- Track role and outlet context on every event (`userRole`, `selectedOutletFilter`, `assignedOutlet`).
- Store finance classification as explicit fields (`expenseType`, `type`) to avoid string-only inference.
- Keep a small weekly sample audit (for example 10 periods/outlets) for metric parity.

