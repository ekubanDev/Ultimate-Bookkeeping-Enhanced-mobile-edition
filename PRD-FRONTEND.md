# Frontend PRD — Ultimate Bookkeeping Enhanced
*Last updated: 2026-04-14*

---

## 1. Purpose & Scope

This document defines the product requirements for the frontend of Ultimate Bookkeeping Enhanced — a web and mobile bookkeeping application for Ghanaian SMBs. It covers architecture, user roles, all functional modules, UI/UX standards, performance targets, and known gaps.

The frontend is a **Vanilla JavaScript (ES6 modules) + HTML5 + CSS3** application deployed to Firebase Hosting, installable as a PWA, and packagable as a native iOS/Android app via Capacitor.

---

## 2. Users & Roles

| Role | Access level | Primary workflows |
|---|---|---|
| **Admin** | Full access — all sections, all outlets | Sales, inventory, expenses, POS, purchase orders, suppliers, outlets, settlements, reports, user management, settings |
| **Outlet Manager** | Restricted — own outlet only | POS checkout, outlet sales, consignments, settlements, daily close |
| **Business Owner** | Same as Admin but focused on reporting and analytics | Dashboard, reports, forecasting, accounting |

**Role enforcement:** `state.userRole` is read from Firestore on login. Restricted sections are hidden from the sidebar and guarded in `showSection()`. Direct URL access to admin-only sections redirects to dashboard. Outlet managers cannot escalate privileges.

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Language | Vanilla JavaScript ES6 modules |
| Markup | HTML5 |
| Styling | CSS3 with custom properties (design tokens) |
| Charts | Chart.js |
| PDF generation | html2pdf.js, jsPDF |
| Barcode | JsBarcode, QuaggaJS |
| Email | EmailJS |
| Offline | Service Worker (cache-first) |
| Mobile native | Capacitor v8.2 |
| Auth | Firebase Authentication (email/password) |
| Database | Firebase Firestore (real-time) |
| Hosting | Firebase Hosting |
| i18n | Custom `i18n-service.js` (English, Twi, French) |

---

## 4. Application Architecture

### 4.1 Entry point
`js/app.js` — initialises services in order: i18n → offline sync → email service → `AppController` → deferred heavy init (Enhanced Dashboard, AI Chat, barcode scanner via `requestIdleCallback`).

### 4.2 Controller layer
`AppController` (`js/controllers/app-controller.js`) — single controller orchestrating all sections: routing, rendering, form submission, modal management, realtime listener setup, role-based UI enforcement.

`PosController` (`js/controllers/pos-controller.js`) — isolated POS session controller for the standalone POS page.

### 4.3 Services layer

| Service | Responsibility |
|---|---|
| `firebase-service.js` | Firestore CRUD helpers, settings, user profile reads |
| `data-loader.js` | Parallel collection reads; populates `state.*` arrays |
| `activity-logger.js` | Writes activity log entries to Firestore |
| `ai-chat.js` | Floating chat window; calls `/api/ai/chat` |
| `enhanced-dashboard.js` | Dashboard KPI computation and Chart.js rendering |
| `export-service.js` | CSV and Excel exports |
| `pdf-export.js` | PDF report templates (sales, expenses, stock, etc.) |
| `email-service.js` | EmailJS integration for sending reports |
| `offline-sync.js` | Queue writes when offline; sync on reconnect |
| `i18n-service.js` | Language switching, translation lookup |
| `metrics-service.js` | Client-side event emission to `/api/metrics/events` |
| `stock-alerts.js` | Low/out-of-stock detection, "On Order" tracking, quantity suggestions |
| `barcode-scanner.js` | Camera and keyboard barcode scanning |
| `form-validator.js` | Shared form validation utilities |
| `profit-analysis.js` | Gross/net profit calculation |
| `customer-credit.js` | Customer credit limit tracking |
| `sales-returns.js` | Sales return/refund processing |
| `recurring-expenses.js` | Auto-generate due recurring expense records |
| `stock-transfer.js` | Inter-outlet inventory transfer |
| `native-features.js` | Capacitor plugin bridges (camera, share, haptics) |

### 4.4 Utilities

| Utility | Responsibility |
|---|---|
| `state.js` | Single shared in-memory state object (`allSales`, `allProducts`, etc.) |
| `utils.js` | Toast, spinner, currency formatting, debounce, date helpers |
| `accounting.js` | `getSaleTotal()`, `isDebtPayment()` — canonical financial calculations |
| `mobile-navigation.js` | Bottom nav bar, swipe gesture for sidebar |
| `financial-reports-modal.js` | Report generation modal orchestration |
| `mobile-dialogs.js` | Mobile-optimised modal overrides |
| `native-pdf-save.js` | Capacitor native file save for PDFs |

### 4.5 State management
`state.js` is a plain object singleton. All services and the controller read/write it directly. Firestore realtime listeners call `markSectionDirty()` to signal that a section needs a re-render on next visit.

---

## 5. Sections & Functional Modules

### 5.1 Dashboard
**Owner:** Admin / Business Owner
**Features:**
- 8 KPI cards: Total Revenue, Net Profit, Total Expenses, Inventory Value, Gross Margin %, Turnover Rate, Repeat Customer %, Avg Transaction Value
- Revenue trend chart (line/bar toggle, Chart.js)
- Sales by category doughnut chart
- Stock alerts widget (low stock, out-of-stock, expiring)
- Activity feed (last 20 actions)
- Top products and top customers lists
- Outlet performance comparison (main vs branches)
- AI business insights panel (calls `/api/ai/insights`)
- Forecast card (calls `/api/ai/forecast/advanced`)

**Rendering:** Lazy — renders on first visit; marked dirty by realtime listeners.

---

### 5.2 Sales
**Owner:** Admin, Outlet Manager (own outlet)
**Features:**
- Add sale modal: product search, quantity, price, customer, date, payment method
- Sales table with search, date filter, payment filter
- Edit and delete sales (admin only; outlet managers restricted)
- Sale total computed via `getSaleTotal()` (canonical)
- Debt payment flag via `isDebtPayment()`
- Barcode scanner to pre-fill product in sale modal

---

### 5.3 POS (Point of Sale)
**Owner:** Admin, Outlet Manager
**Standalone page:** `pos.html` + `pos-controller.js`
**Features:**
- Product grid with search and category filter
- Cart: add/remove items, quantity adjustment, per-item discount
- Checkout: cash, card, mobile money, split payment
- Change calculation
- Receipt generation (print and PDF)
- Barcode scanner integration
- Customer lookup and credit check
- Session isolation — POS state is independent from main app

---

### 5.4 Inventory
**Owner:** Admin
**Features:**
- Product list with search and category filter
- Add/edit/delete products: name, category, price, cost, quantity, min stock, barcode, expiry date
- Stock value summary
- Low stock and out-of-stock indicators per row
- Barcode label printing

---

### 5.5 Suppliers
**Owner:** Admin
**Features:**
- Supplier list: name, contact, payment terms, status
- Add/edit/delete suppliers
- Payment terms formatted display

---

### 5.6 Purchase Orders
**Owner:** Admin
**Features:**
- PO list with status filter (pending / received / cancelled) and search
- Summary metrics: total POs, pending count, pending value
- Create PO modal:
  - Supplier selection (auto-fills payment terms)
  - Multi-item rows: product search, quantity, unit cost, line total
  - Tax %, shipping, subtotal, grand total calculation
  - Remove item rows (with last-row guard)
  - "Add Item" button below rows
  - AI Optimize Quantities button (appears when opened from stock alert)
  - Save as PDF button
- Auto-suggest from stock alerts: `promptCreatePOWithStockSuggestion()` checks low/out-of-stock products and offers to pre-fill the PO
- Receive PO modal: confirm received quantities, trigger inventory update and liability record
- Export PO as PDF (columns: #, Product, Qty — no cost columns)
- Delete PO with `window.confirm` confirmation
- Status badges: pending (yellow), received (green), cancelled (grey)
- After create/receive/delete: stock alert widget refreshes automatically

---

### 5.7 Stock Alerts
**Owner:** Admin
**Features:**
- Low stock modal: products below `minStock`
- Out-of-stock modal: products with `quantity <= 0`
- Startup alert modal: fires once per session if any alerts exist
- Per-product columns: name, category, current stock, min, needed, suggested qty, status/action
- "On Order" badge: derived from `state.allPurchaseOrders` (pending only) — no Firestore read
- "Suggested Qty": 90-day sales velocity × 45-day target minus current stock (`suggestOrderQuantity()`)
- Bulk "Create PO" excludes already-on-order products
- "All items are on order" banner when all flagged products have a pending PO
- Status reinstated automatically when PO is deleted or received

---

### 5.8 Expenses
**Owner:** Admin
**Features:**
- Expense list with search, category filter, date filter
- Add/edit/delete expenses: category, amount, date, description, payment method
- Recurring expenses: setup, frequency, auto-generate on due date
- Expense category summary

---

### 5.9 Customers
**Owner:** Admin
**Features:**
- Customer list paginated at 50 per page ("Load more")
- Search resets pagination
- Add/edit/delete customers: name, phone, email, credit limit
- Customer credit tracking via `customer-credit.js`
- Customer account statement PDF

---

### 5.10 Outlets
**Owner:** Admin
**Features:**
- Outlet list: name, manager, commission rate, status
- Add/edit outlets
- Outlet performance comparison on dashboard
- Admin can view all outlet data in any section

---

### 5.11 Consignments
**Owner:** Admin, Outlet Manager
**Features:**
- Record consignment delivery to outlet
- Track consignment status
- Link to settlement workflow

---

### 5.12 Settlements
**Owner:** Admin, Outlet Manager
**Features:**
- Generate settlement for an outlet over a period
- Settlement formula: revenue × (1 − commission rate) − expenses
- Settlement history list

---

### 5.13 Accounting
**Owner:** Admin
**Features:**
- Income statement view (revenue − COGS − operating expenses = net profit)
- Transaction ledger with classification
- Liabilities list: add, record payment, track balance
- Payment transactions log

---

### 5.14 Forecasting
**Owner:** Admin, Business Owner
**Features:**
- 4 KPI cards: Projected Revenue, Projected Profit, Avg Daily Revenue, Trend direction
- Period selector (7d, 30d, 90d, 180d, 365d)
- Forecast chart with confidence bands (Chart.js)
- Weekly pattern bar chart (day-of-week seasonality)
- Monthly revenue history
- Product demand table: velocity, stockout date estimate, reorder quantity
- Calls `/api/ai/forecast/advanced`

---

### 5.15 Reports
**Owner:** Admin, Business Owner
**Features:**
- Report Center section with grouped cards
- Universal date-range picker with presets (Today, Week, Month, Quarter, Year, All)
- Multi-format export per report (PDF, CSV, Excel)
- Report types:
  - Sales Summary
  - Expenses Report
  - Cash Flow Statement
  - Tax / VAT Summary
  - AR Aging
  - Customer Account Statement
  - Stock Valuation
  - Period Comparison
  - Profit & Loss
- Calls `/api/reports/generate` for server-computed reports

---

### 5.16 User Management
**Owner:** Admin
**Features:**
- List system users
- Assign roles (admin / outlet manager)
- Assign outlet to outlet manager

---

### 5.17 Settings
**Owner:** Admin
**Features:**
- Business name, currency, tax rate, fiscal year
- Notification email for stock alerts
- Language selector (English, Twi, French)
- Email configuration

---

### 5.18 AI Chat (Floating FAB)
**Owner:** All roles
**Features:**
- Floating robot FAB button — only launcher; no header button
- Chat window: message history (last 12 messages sent as context), typing indicator, clear button
- Calls `/api/ai/chat` with business context snapshot and sales/product datasets
- Suggestion chips for common questions
- Error states: 401 (sign in), 429 (rate limited), network failure

---

## 6. UI/UX Standards

### 6.1 Design tokens (`styles.css`, `redesign.css`)
| Token | Purpose |
|---|---|
| `--primary` | Brand blue |
| `--danger` | Destructive actions |
| `--radius`, `--radius-sm`, `--radius-lg` | Border radii |
| `--shadow`, `--shadow-lg` | Elevation |
| `--transition` | Animation timing |
| `--font-mono` | Numeric values |

### 6.2 Navigation
- Sidebar: 7 grouped categories (Overview, Commerce, Procurement, Finance, Insights, Operations, Admin)
- Mobile bottom nav: 5 quick-access tabs (Home, Sales, POS, Stock, More)
- Sidebar swipe gesture on mobile
- Active section synced between sidebar and bottom nav

### 6.3 Tables
- Zebra striping
- Sticky headers
- `td.actions { cursor: pointer }` on action cells
- Empty state component when no data

### 6.4 Forms
- Focus rings (blue border + shadow)
- Inline validation: `focusField()` scrolls to offending field, red border, clears on input
- `form-validator.js` shared validation

### 6.5 Toasts
- Max 4 stacking
- Dismiss button
- Progress bar (auto-dismiss countdown)
- `role="alert"` for screen readers
- Types: success (green), error (red), warning (yellow), info (blue)

### 6.6 Modals
- Circular close button
- Backdrop click to close
- Mobile-optimised size via `mobile-dialogs.css`

### 6.7 Loading states
- Global spinner: `Utils.showSpinner()` / `Utils.hideSpinner()`
- Skeleton loaders for section content

### 6.8 Responsive breakpoints
| Breakpoint | Behaviour |
|---|---|
| < 768px | Mobile: bottom nav, full-width modals, stacked layouts |
| 768–899px | Tablet portrait: sidebar 200px, icon-only logout, compressed search |
| 900–1024px | Tablet landscape: lighter compression |
| > 1024px | Desktop: full sidebar, full header |

### 6.9 Accessibility
- `role="alert"` on toasts
- Keyboard navigation for forms
- `aria-label` on icon-only buttons

---

## 7. Offline & PWA

- **Service Worker** (`sw.js`): cache-first for app shell; network-first for API; stale-while-revalidate for CDN
- **Offline queue** (`offline-sync.js`): writes queued when offline, synced on reconnect
- **PWA install banner**: `beforeinstallprompt` captured; install + dismiss buttons
- **Manifest** (`manifest.json`): standalone display, full icon set, POS shortcut
- **Capacitor**: iOS and Android native shell; native camera, share, haptics, status bar, splash screen, barcode scanner

---

## 8. Internationalisation

- Languages: English (default), Twi, French
- `i18n-service.js` loads locale JSON from `locales/`
- Language selector in settings and header
- All user-facing strings should use `i18nService.t('key')` (ongoing migration)

---

## 9. Performance Requirements

| Metric | Target |
|---|---|
| Time to interactive (first load) | ≤ 3s on 4G |
| Section switch (cached data) | ≤ 200ms |
| Post-write visible update | ≤ 2s P95 |
| Customer list render (1000 rows) | Paginated at 50; no full render |

**Strategies implemented:**
- Lazy section rendering: render only on first visit or dirty signal
- `requestIdleCallback` for Enhanced Dashboard, AI Chat, barcode scanner
- `Promise.all` for parallel Firestore reads (inventory, outlet expenses, outlet sales)
- Realtime listeners set up after initial data load (not during)
- Customers paginated at 50 per page
- Preconnect hints for Google Fonts

---

## 10. Metrics & Observability

`metrics-service.js` emits events to `/api/metrics/events`:

| Event | Trigger |
|---|---|
| `runtime_error` | Global `window.onerror` and `unhandledrejection` |
| `section_view` | Every `showSection()` call |
| `feature_used` | Key user actions (add sale, create PO, etc.) |
| `write_error` | Failed Firestore write |

Every event carries: `surface`, `section`, `userRole`, `timestamp`.

---

## 11. Security

- Role enforcement in `showSection()` and all form submit handlers
- `escapeHtml()` used for all user-supplied content rendered into `innerHTML`
- No privilege escalation path for outlet managers
- Firebase ID token sent as `Authorization: Bearer <token>` to all backend calls
- Sensitive inputs (passwords) never logged

---

## 12. Known Gaps / Open Items

| Item | Priority | Notes |
|---|---|---|
| Guard edit/delete buttons in Sales table for outlet managers | High | Partially implemented; needs full enforcement |
| Sales table total to use `getSaleTotal()` consistently | High | `accounting.js` canonical function exists |
| Strip remaining debug `console.log` calls from dashboard/analytics render paths | Medium | |
| Virtual scrolling for very large tables | Low | Pagination is current mitigation |
| Additional chart types (P2 backlog) | Low | |
| Full i18n coverage for all user-facing strings | Medium | Only partially translated |
| Offline conflict resolution strategy | Medium | Queue exists but no conflict handling |

---

## 13. File Reference

```
frontend/public/bookkeeping/
├── index.html                        # App shell
├── pos.html                          # POS standalone page
├── sw.js                             # Service worker
├── css/
│   ├── styles.css                    # Base + design system
│   ├── redesign.css                  # Overrides, tablet breakpoints
│   ├── responsive.css                # Breakpoint rules
│   ├── enhanced-dashboard.css        # Dashboard widget styles
│   ├── ai-chat.css                   # AI chat window
│   ├── mobile-dialogs.css            # Mobile modal overrides
│   ├── pos-embedded.css              # POS section styles
│   ├── pos-redesign.css / pos.css    # POS page styles
│   ├── design-system.css             # Token definitions
│   ├── enhancements.css              # Feature-specific additions
│   ├── themes.css                    # Theme variants
│   └── ux-overhaul.css               # UX pass styles
├── js/
│   ├── app.js                        # Entry point
│   ├── config/firebase.js            # Firebase init + exports
│   ├── controllers/
│   │   ├── app-controller.js         # Main controller
│   │   └── pos-controller.js         # POS controller
│   ├── services/                     # (20 services — see §4.3)
│   ├── utils/                        # (8 utilities — see §4.4)
│   └── pos/                          # POS module files
└── locales/
    ├── en.json
    ├── tw.json
    └── fr.json
```
