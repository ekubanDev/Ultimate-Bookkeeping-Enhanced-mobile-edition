# Project Change Log — Ultimate Bookkeeping Enhanced

*Full history from first commit to present. Organised chronologically by session/commit.*

---

## Origin — UI/UX Pro Max Skill (GitHub)

**Repo:** `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git`

The project originated from a UI/UX skill repository. Core design patterns, component structures, and the initial visual language were established here before the bookkeeping application was built on top of it.

---

## Phase 1 — Foundation (2026-03-12)

### `0:0 firest commit to main`
Initial scaffolding of the full-stack application.

**Frontend:**
- React app bootstrapped with Tailwind CSS
- Firebase SDK integration (`frontend/src/lib/firebase.js`)
- UI component library set up: toaster, toggle group, tooltip hooks
- `use-toast.js` hook
- `memory/PRD.md` — initial product requirements document

**Backend:**
- FastAPI `server.py` skeleton
- MongoDB via Motor async client
- StatusCheck endpoint

**Infrastructure:**
- `.firebaserc`, `.emergent/emergent.yml`, CI workflow (`.github/workflows/ci.yml`)
- Test scaffolding: `tests/`, `test_reports/`

---

### `feat: add installable mobile app support (PWA + Capacitor)` (2026-03-12)

**Mobile / PWA:**
- `frontend/public/bookkeeping/sw.js` — full service worker with cache-first strategy, offline fallback, cache version v1
- `frontend/public/manifest.json` — PWA manifest with all icon sizes, display mode, theme colour
- `frontend/capacitor.config.ts` — Capacitor config for iOS/Android native packaging
- Full icon set added: 48×48 through 512×512px, apple-touch-icon

**Frontend:**
- `index.html` / `pos.html` — added `<link rel="manifest">` and meta tags for PWA installability
- `frontend/src/App.js` — app shell updates for Capacitor

---

### `feat: advanced AI forecasting with day-by-day predictions and product demand` (2026-03-12)

**Backend (`server.py`):**
- New `POST /api/ai/forecast/advanced` endpoint
  - Linear regression on historical revenue
  - Day-of-week seasonal pattern detection
  - Confidence interval calculation
  - Product-level demand forecasting: velocity, stockout date estimates, reorder quantities
  - Optional AI natural-language summary via LLM

**Frontend:**
- Rebuilt Forecasting section with 4 KPI cards, period selector
- Forecast chart with confidence bands
- Weekly pattern bar chart
- Monthly revenue history
- Product demand table with stockout alerts
- Dashboard forecast card now calls the advanced endpoint
- Mobile-responsive grid for forecast section
- Service worker cache bumped to v2

---

### `feat: unified Report Center with 6 new report types and backend analytics` (2026-03-12)

**Backend (`server.py`):**
- New `POST /api/reports/generate` endpoint
  - Tax/VAT summary report
  - AR aging report
  - Period-over-period comparison
  - Optional AI executive summaries

**Frontend:**
- Dedicated Reports section with categorised report cards
- Universal date-range filter shared across all reports
- Multi-format exports: PDF, CSV, Excel
- New PDF reports: Expenses, Cash Flow, Tax/VAT Summary, AR Aging, Customer Statement, Stock Valuation
- Removed 100-row sales PDF cap
- PDF headers now use business name from settings

**CSS (`responsive.css`):**
- Report card grid layout
- Report filter bar styling

---

### `feat: UI/UX overhaul — design system, mobile bottom nav, form/table/toast improvements` (2026-03-12)

**CSS (`styles.css`, `responsive.css`):**
- Unified CSS design system with consistent tokens: colours, radii, shadows, transitions
- Mobile bottom navigation bar with 5 quick-access tabs
- Sidebar reorganised into 7 grouped categories
- Forms: focus rings, custom selects, button variants (primary/secondary/danger)
- Tables: zebra striping, sticky headers
- Toasts: dismiss buttons, progress bars, stacking limits
- Skeleton loader and empty state components
- Section transitions: smooth fade-in
- Header: compacted with frosted-glass search bar
- Swipe gestures enabled for sidebar

**Frontend:**
- `mobile-navigation.js` — swipe gesture implementation
- `utils.js` — updated toast system

---

### `perf: lazy section rendering, deferred heavy init, customers pagination` (2026-03-12)

**Frontend (`app-controller.js`, `app.js`):**
- Lazy section rendering: Sales, Inventory, Dashboard, etc. only rendered on first visit or when data is marked dirty
- Realtime Firestore listeners mark sections dirty and refresh only the visible section
- Enhanced Dashboard, AI Chat, and barcode scanner init deferred until after first paint via `requestIdleCallback`/timeout
- Customers list: paginated at 50 per page with "Load more"; page resets on search change
- `index.html`: preconnect hints for Google Fonts
- Service worker cache bumped to v5

---

### `docs: add comprehensive README` (2026-03-12)
- `README.md` — full setup instructions, scripts reference, architecture overview

---

## Phase 2 — Bespoke Features (2026-03-19 to 2026-03-26)

### `0:0 Initial commit` (2026-03-19)
Second repository initialisation (Implement branch). Brought in:

**Frontend:**
- `ai-chat.css` — floating AI chat window styles
- `mobile-dialogs.css` — mobile-optimised modal overrides
- `styles.css` — updated base styles
- `index.html` — restructured app shell
- `ai-chat.js` — floating AI chat service
- `enhanced-dashboard.js` — dashboard analytics widget
- `financial-reports-modal.js` — financial report modal utility
- Icon assets regenerated and optimised

---

### `0:1 Implement` (2026-03-24)

**Frontend — POS system:**
- `pos-cart.js` — cart state, quantity management, discount application
- `pos-data.js` — product data layer for POS
- `pos-invoice.js` — invoice generation from POS session
- `pos-main.js` — POS entry point and session lifecycle
- `pos-products.js` — product search and selection grid
- `pos-scanner.js` — barcode scanner integration for POS
- `pos-ui.js` — POS layout and UI rendering
- `pos.html` — POS standalone page with embedded CSS
- `pos-embedded.css` — POS-specific styles

**Frontend — Core services:**
- `app-controller.js` — major expansion: outlet management, role-based access, purchase orders, liabilities
- `ai-chat.js` — expanded chat context and business data injection
- `data-loader.js` — multi-collection parallel data loading
- `export-service.js` — extended export formats
- `firebase-service.js` — additional Firestore helpers
- `pdf-export.js` — full PDF template system for all document types
- `profit-analysis.js` — gross/net profit calculation service
- `financial-reports-modal.js` — refactored report modal
- `native-pdf-save.js` — Capacitor native file save for PDFs
- `utils.js` — shared utility expansions
- `ai-chat.css` — chat window UI polish

---

### `0:2 admin outlet view` (2026-03-25)

**Frontend:**
- `data-loader.js` — admin can now load and view data across all outlets
- `enhanced-dashboard.js` — outlet-aware KPI cards; admin sees aggregate + per-outlet breakdown

---

### `0:3 bespoke` (2026-03-26)

**Frontend:**
- `enhanced-dashboard.css` — dashboard widget layout, KPI card styles, chart containers
- `index.html` — section visibility and layout adjustments
- `app-controller.js` — bespoke business logic: outlet transfers, consignment handling, settlement workflows
- `export-service.js` — additional export templates
- `sales-returns.js` — sales return/refund processing service
- `state.js` — extended app state shape
- `sw.js` — service worker cache update

---

## Phase 3 — Mobile Essential Mode & Data Fixes (2026-04-07)

### `before mobile Essential mode` (2026-04-07)

**Frontend:**
- `index.html` — mobile essential mode UI additions
- `app-controller.js` — role-based section guards strengthened; mobile-specific rendering paths
- `data-loader.js` — data loading fixes for outlet managers; conditional collection reads based on role

---

## Phase 4 — Metrics, Agentic AI & MCP Server (2026-04-10)

### `before agentic ai and Coworker Implementation` (2026-04-10)

**Backend (`server.py`):**
- Business analytics aggregation endpoints
- Groundwork for agentic AI tool-calling pattern

**Frontend:**
- `metrics-service.js` — new client-side metrics emission service; tracks runtime errors, section views, feature usage
- `metrics-events.md` — full metrics event schema documentation
- `app.js` — global error handlers wired to `metricsService`; unhandled promise rejection tracking
- `app-controller.js` — metrics events fired on key user actions
- `ai-chat.js` — chat context enriched with more business data
- `enhanced-dashboard.js` — dashboard metrics hooks
- `data-loader.js` — loading state and timing improvements
- `state.js` — metrics-related state additions
- `PRODUCT_PRIORITIES.md` — product priorities and 4-week execution plan documented

---

### `before adding mcp_server` (2026-04-10)

**Backend:**
- `ai_chat_tools.py` — business snapshot computation: revenue, expenses, top products, inventory summary for LLM context
- `firebase_auth.py` — Firebase Admin SDK integration; ID token verification; per-UID AI chat rate limiting; `ai_chat_auth_enforced()` flag
- `mcp_server.py` — MCP (Model Context Protocol) server exposing business data as tools
- `requirements-mcp.txt` — MCP dependencies
- `server.py` — `/api/ai/chat` endpoint: Firebase auth gate, rate limiting, business snapshot injection, tool-calling via OpenAI or emergentintegrations LLM

**Frontend:**
- `index.html` — AI chat launcher button in header
- `app-controller.js` — AI chat integration wiring
- `ai-chat.js` — full floating chat window: message history, typing indicator, `getBusinessContext()`, `getAgentDatasets()`, backend fetch
- `enhanced-dashboard.js` — dashboard AI widget
- `package.json` — MCP package added

---

## Phase 5 — Claude Code Session (2026-04-11)

### `cluade code` (2026-04-11)

**Frontend — Accounting utilities:**
- `accounting.js` — new utility: `isDebtPayment()`, `getSaleTotal()` — canonical sale total computation used across the app

**Frontend — POS fixes:**
- `pos-cart.js` — cart total calculation fixes
- `pos-checkout.js` — checkout flow: payment split, change calculation, receipt generation
- `pos-main.js` — POS session init fixes

**Frontend — Core:**
- `app-controller.js` — sales table total fix using `getSaleTotal`; outlet manager edit/delete guards; role-based UI cleanup
- `ai-chat.js` — chat window pointer-event and FAB fixes
- `data-loader.js` — parallel Firestore reads (initial pass)
- `enhanced-dashboard.js` — dashboard refresh guard
- `export-service.js` — export improvements
- `pdf-export.js` — PDF template fixes

---

## Phase 6 — Interactive Claude Code Session (2026-04-13 to 2026-04-14)

*All changes below were made interactively and deployed to `https://bookkeeping-211e6.web.app`.*

---

### Fix 1 — I-beam cursor over table action buttons

**`redesign.css`:** `td.actions { cursor: pointer }` — was `cursor: default` which resolves to a text cursor inside a table context on most browsers.

---

### Fix 2 — AI chat window blocking clicks in the bottom-right corner

**Root cause:** The invisible closed AI chat window (420×600px) had `pointer-events: auto` globally. `transform: scale(0.5)` shrinks the visual but not the pointer-event hit box.

**`ai-chat.css`:** Scoped `pointer-events: auto` to `.ai-chat-window.open` only. Closed window reverts to `pointer-events: none`.

---

### Fix 3 — Header content overflow on tablet portrait and landscape

**`redesign.css`:**
- `flex-wrap: nowrap !important; overflow: hidden; min-width: 0` on `.header-content` and `#auth-controls`
- `#auth-controls { flex-shrink: 1 }` (was `flex-shrink: 0`)
- Tablet portrait (768–899px): sidebar 200px, secondary header items hidden, search bar 160px, logout button icon-only
- Tablet landscape (900–1024px): lighter compression

---

### Fix 4 — Analytics dashboard UX reverted

Structural HTML changes and ~214 lines of new CSS were added to the analytics section then rolled back at the user's request. `redesign.css` restored to 1214 lines; `buildAnalyticsSection()` HTML restored to original.

---

### Fix 5 — Removed "Don't have an account? Register" from login dialog

**`index.html`:** Removed the `<p>` block containing the `#show-register` anchor.

**`app-controller.js`:** Changed `.addEventListener` on the now-removed element to use optional chaining: `document.getElementById('show-register')?.addEventListener(...)` — prevents `TypeError` on init.

---

### Fix 6 — Removed AI Assistant button from header; FAB-only

**`ai-chat.js`:**
- `ensureLauncherButtons()` no longer injects a button into `#auth-controls`
- FAB injected exclusively into `#ai-chat-root`
- `bindLauncherButtons()` updated to target `#ai-chat-fab` only

**`redesign.css`:** `#ai-chat-launcher-header { display: none !important }` as a safety net.

---

### Fix 7 — Data loading performance: parallelised Firestore reads

| # | File | Change |
|---|------|--------|
| 1 | `data-loader.js` | `Promise.all([getDocs(oiRef), getDocs(legRef)])` — inventory reads parallelised |
| 2 | `data-loader.js` | All outlet expense queries fanned out and awaited together |
| 3 | `data-loader.js` | `Promise.all(outletSalesFetches)` then `.flat()` — outlet sales parallelised |
| 4 | `app-controller.js` | `await Promise.all([dataLoader.loadAll(), this.loadSettings()])` then `setupRealtimeListeners()` — listeners set up after data is loaded, not during |
| 5 | `app.js` | Enhanced Dashboard refresh guarded: only fires if `state.authInitialized && state.currentUser` |

---

### Feature — Auto-generate PO from low/out-of-stock products

**`app-controller.js` — `promptCreatePOWithStockSuggestion()`:**
- Fires when "Create Purchase Order" button is clicked
- If low/out-of-stock products exist: shows an inline choice modal — "Auto-fill" or "Start blank"
- "Auto-fill" calls `setupCreatePOModal(ids)` with all flagged product IDs pre-populated

---

### Fix — PO modal: items from stock alert could not be removed

**`app-controller.js`:**
- `addPOItemRow()` always renders the remove button — removed `rowIndex > 0` condition
- `removePOItemRow()` guards against removing the last row: `if (container.children.length <= 1) return`

---

### Fix — "Add Item" button repositioned below item rows

**`index.html`:** `#add-po-item-btn` moved to appear after `#po-items-list` in the DOM.

---

### Fix — PO validation error with valid data

**Root cause:** `renumberPOItems()` updated `data-row-index` on row containers but not the IDs on the input elements inside. After a row was deleted, validation looked up `#po-cost-0` which no longer existed → `parseFloat(null?.value) || 0 = 0` → false cost validation failure.

**`app-controller.js`:** `renumberPOItems()` now re-stamps all 7 input/div IDs per row:
```
po-product-search, po-product-dropdown, po-product-id,
po-product-is-new, po-quantity, po-cost, po-total
```

Added `focusField()` helper: scrolls to and highlights the offending field with a red border + box-shadow when validation fails; clears on next input.

---

### Feature — Export PO as PDF from modal

**`index.html`:** "Save as PDF" button added to PO modal footer alongside the Save button.

**`app-controller.js` — `exportCurrentPOAsPDF()`:**
- Reads supplier, date, notes, subtotal, tax, shipping, grand total from the open modal
- Collects item rows: product name + qty only (no unit cost, no total columns)
- Builds HTML document and passes to `html2pdf` for client-side PDF download
- PDF table: `#`, `Product`, `Qty` columns only

---

### Feature — Delete Purchase Orders with confirmation

**`app-controller.js` — `deletePurchaseOrder(poId, poNumber)`:**
- Red trash icon button added to every PO row
- `window.confirm` dialog with PO number and "cannot be undone" warning
- On confirm: `deleteDoc(doc(db, 'purchase_orders', poId))`
- Removes from `state.allPurchaseOrders` immediately (no reload)
- Re-renders table and refreshes stock alert widget
- Logs deletion via `ActivityLogger`

---

### Feature — Stock alert "On Order" status tracking

**`stock-alerts.js` — new methods:**

**`getProductsOnOrder()`**
- Derives `Map<productId, {poNumber, poId, pendingQty}>` from `state.allPurchaseOrders` (pending only) at render time
- No Firestore reads — purely derived from in-memory state
- Status reverts automatically when a PO is deleted, received, or cancelled

**`suggestOrderQuantity(product)`**
- Scans last 90 days of `state.allSales` for daily velocity
- Targets 45 days of forward stock minus current on-hand
- Falls back to `minStock` when no sales history
- Returns `{ qty, avgDailySales, basedOnDays }`

**`refreshAlertWidget()`**
- Re-renders `#stock-alerts-widget` in-place
- Called after every PO lifecycle event: create, receive, delete

**Updated `showProductListModal()`:**
- "On Order" blue badge with pending quantity and PO number shown per product instead of the Order button
- "Suggested Qty" column with daily velocity in small text beneath
- Bulk "Create PO" action excludes already-on-order products
- "All items are on order" banner when all flagged products have pending POs

**Updated startup alert modal:**
- "On Order" badge per row
- "Suggest Qty" column added
- Create PO button count and unit total exclude already-on-order products

**`addPOItemRow()`:** Pre-fill quantity now calls `stockAlerts.suggestOrderQuantity()` instead of using `minStock` directly.

---

### Feature — AI order quantity optimisation

**`app-controller.js` — `_injectAIOptimizeButton(prefillProductIds)`:**
- Purple "AI Optimize Quantities" button injected above the item list
- Only appears when PO modal is opened from a stock alert (pre-filled products)
- Removed on each `setupCreatePOModal` call to prevent duplicates

**`app-controller.js` — `_requestAIOrderQuantities(prefillProductIds)`:**
- Builds per-product sales summary (90-day window): current stock, min stock, units sold, daily avg
- Calls `POST /api/ai/po-suggest` with product summaries
- Reads `data.suggestions` directly — no client-side JSON parsing
- Applies quantities to matching PO form rows
- Shows visible inline hint `<div class="po-ai-hint">` below each quantity field:
  - **Purple** — AI-sourced: `🤖 <reason from AI>`
  - **Orange** — rule-based fallback: `📈 45-day sales-velocity estimate`
- Hint and border styling clear automatically when user manually edits the field

---

### Backend — Dedicated `/api/ai/po-suggest` endpoint

**Root cause of prior failures:** `/api/ai/chat` injects a conversational business-advisor system prompt on every request. The model always replies in natural language — reliable JSON extraction was impossible from the frontend.

**`backend/server.py` — `POST /api/ai/po-suggest`:**

**Request:**
```json
{
  "products": [
    { "name", "currentStock", "minStock", "unitsSoldLast90Days", "avgDailySales" }
  ]
}
```

**Response:**
```json
{ "suggestions": [{ "name", "qty", "reason" }], "mode": "ai|rule_based|rule_based_fallback" }
```

**Behaviour:**
- Tight system prompt: *"Return ONLY a raw JSON array, no markdown, no explanation, no code fences"*
- Server-side JSON parsing with two fallback strategies
- If LLM key is missing or response cannot be parsed: rule-based 45-day velocity fallback built into the endpoint — never errors
- Validates and sanitises every suggestion item (enforces positive integer qty)
- Shares the same Firebase auth gate and rate limiting as `/api/ai/chat`

**Deployed:** Backend rebuilt via `gcloud builds submit` and deployed to Cloud Run (`bookkeeping-api`, `us-central1`). Frontend deployed via `firebase deploy --only hosting`.

---

## Files Modified — Full Reference

| File | Phases |
|------|--------|
| `backend/server.py` | 1, 4, 6 |
| `backend/ai_chat_tools.py` | 4 |
| `backend/firebase_auth.py` | 4 |
| `backend/mcp_server.py` | 4 |
| `frontend/public/bookkeeping/css/styles.css` | 1, 2 |
| `frontend/public/bookkeeping/css/responsive.css` | 1 |
| `frontend/public/bookkeeping/css/redesign.css` | 6 |
| `frontend/public/bookkeeping/css/ai-chat.css` | 2, 6 |
| `frontend/public/bookkeeping/css/mobile-dialogs.css` | 2 |
| `frontend/public/bookkeeping/css/enhanced-dashboard.css` | 2 |
| `frontend/public/bookkeeping/css/pos-embedded.css` | 2 |
| `frontend/public/bookkeeping/index.html` | 2, 3, 4, 6 |
| `frontend/public/bookkeeping/pos.html` | 2 |
| `frontend/public/bookkeeping/js/app.js` | 3, 4, 6 |
| `frontend/public/bookkeeping/js/controllers/app-controller.js` | 2, 3, 4, 5, 6 |
| `frontend/public/bookkeeping/js/services/ai-chat.js` | 2, 4, 5, 6 |
| `frontend/public/bookkeeping/js/services/data-loader.js` | 2, 3, 5, 6 |
| `frontend/public/bookkeeping/js/services/enhanced-dashboard.js` | 2, 4, 5 |
| `frontend/public/bookkeeping/js/services/export-service.js` | 2, 5 |
| `frontend/public/bookkeeping/js/services/firebase-service.js` | 2 |
| `frontend/public/bookkeeping/js/services/metrics-service.js` | 4 |
| `frontend/public/bookkeeping/js/services/pdf-export.js` | 2, 5 |
| `frontend/public/bookkeeping/js/services/profit-analysis.js` | 2 |
| `frontend/public/bookkeeping/js/services/sales-returns.js` | 2 |
| `frontend/public/bookkeeping/js/services/stock-alerts.js` | 6 |
| `frontend/public/bookkeeping/js/utils/accounting.js` | 5 |
| `frontend/public/bookkeeping/js/utils/financial-reports-modal.js` | 2 |
| `frontend/public/bookkeeping/js/utils/mobile-navigation.js` | 1 |
| `frontend/public/bookkeeping/js/utils/native-pdf-save.js` | 2 |
| `frontend/public/bookkeeping/js/utils/state.js` | 2, 4 |
| `frontend/public/bookkeeping/js/utils/utils.js` | 1, 2 |
| `frontend/public/bookkeeping/js/pos/pos-cart.js` | 2, 5 |
| `frontend/public/bookkeeping/js/pos/pos-checkout.js` | 5 |
| `frontend/public/bookkeeping/js/pos/pos-data.js` | 2 |
| `frontend/public/bookkeeping/js/pos/pos-invoice.js` | 2 |
| `frontend/public/bookkeeping/js/pos/pos-main.js` | 2, 5 |
| `frontend/public/bookkeeping/js/pos/pos-products.js` | 2 |
| `frontend/public/bookkeeping/js/pos/pos-scanner.js` | 2 |
| `frontend/public/bookkeeping/js/pos/pos-ui.js` | 2 |
| `frontend/public/bookkeeping/sw.js` | 1, 2 |
| `frontend/public/manifest.json` | 1 |
| `frontend/capacitor.config.ts` | 1 |
| `README.md` | 1 |
| `PRODUCT_PRIORITIES.md` | 4 |
| `metrics-events.md` | 4 |
| `memory/PRD.md` | 1 |
