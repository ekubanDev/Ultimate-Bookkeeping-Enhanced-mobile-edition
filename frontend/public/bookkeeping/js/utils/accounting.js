/**
 * Canonical accounting classification utilities.
 *
 * Import from this module — never redefine locally — so every surface
 * (dashboard, exports, PDF, AI) agrees on what counts as a debt payment
 * and how to compute a sale total.
 */

/**
 * Returns true if the expense row should be classified as a liability/debt
 * repayment rather than an operating expense.
 *
 * Canonical rule (single source of truth):
 *   expenseType === 'liability_payment'
 *   OR category === 'debt payment'
 *   OR category === 'loan repayment'
 */
export function isDebtPayment(expense) {
    const type = (expense?.expenseType || '').toLowerCase();
    const cat  = (expense?.category    || '').toLowerCase();
    return type === 'liability_payment'
        || cat  === 'debt payment'
        || cat  === 'loan repayment';
}

/**
 * Write-time guardrails — validate a data object before it goes to Firestore.
 *
 * Call these before addDoc/updateDoc in any write handler. They return an object:
 *   { ok: true }                    — safe to write
 *   { ok: false, error: 'message' } — reject the write and show the error to the user
 *
 * Rules enforced:
 *   - Required string fields must be non-empty after trimming.
 *   - Numeric fields (amounts, prices, quantities) must be finite numbers.
 *   - Amount/price/quantity fields must be >= 0.
 *   - Expense category must not be a debt-payment alias (those belong in
 *     Liabilities, not the expenses collection).
 */

/**
 * Validate a product write (add or edit).
 * @param {{ name: string, cost: any, price: any, quantity: any }} data
 */
export function validateProductWrite(data) {
    if (!data.name || !String(data.name).trim()) return { ok: false, error: 'Product name is required.' };
    if (!Number.isFinite(parseFloat(data.cost)) || parseFloat(data.cost) < 0)
        return { ok: false, error: 'Cost must be a valid non-negative number.' };
    if (!Number.isFinite(parseFloat(data.price)) || parseFloat(data.price) < 0)
        return { ok: false, error: 'Price must be a valid non-negative number.' };
    if (!Number.isFinite(parseFloat(data.quantity)) || parseFloat(data.quantity) < 0)
        return { ok: false, error: 'Quantity must be a valid non-negative number.' };
    return { ok: true };
}

/**
 * Validate an expense write.
 * @param {{ date: string, description: string, category: string, amount: any }} data
 */
export function validateExpenseWrite(data) {
    if (!data.date || !String(data.date).trim()) return { ok: false, error: 'Expense date is required.' };
    if (!data.description || !String(data.description).trim()) return { ok: false, error: 'Expense description is required.' };
    if (!data.category || !String(data.category).trim()) return { ok: false, error: 'Expense category is required.' };
    const amount = parseFloat(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Expense amount must be a positive number.' };
    // Prevent debt-payment aliases from being written as operating expenses
    const cat = String(data.category).toLowerCase();
    if (cat === 'debt payment' || cat === 'loan repayment')
        return { ok: false, error: 'Debt and loan repayments must be recorded under Liabilities → Record Payment, not as expenses.' };
    return { ok: true };
}

/**
 * Validate a liability write (add or edit).
 * @param {{ type: string, creditor: string, amount: any, balance: any, dueDate: string }} data
 */
export function validateLiabilityWrite(data) {
    if (!data.type || !String(data.type).trim()) return { ok: false, error: 'Liability type is required.' };
    if (!data.creditor || !String(data.creditor).trim()) return { ok: false, error: 'Creditor name is required.' };
    const amount = parseFloat(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Liability amount must be a positive number.' };
    const balance = parseFloat(data.balance);
    if (!Number.isFinite(balance) || balance < 0) return { ok: false, error: 'Balance must be a valid non-negative number.' };
    if (balance > amount) return { ok: false, error: 'Balance cannot exceed the original liability amount.' };
    if (!data.dueDate || !String(data.dueDate).trim()) return { ok: false, error: 'Due date is required.' };
    return { ok: true };
}

/**
 * Compute the revenue total for one sale record.
 *
 * Priority:
 *   1. s.total — use the stored total when present and finite (written at
 *      POS checkout time; most accurate because it captures the exact
 *      amount the customer paid).
 *   2. Derive from components: qty × price × (1 − discount%) × (1 + tax%).
 *
 * This is the canonical formula. Dashboard, PDF, export, and AI must all
 * call this function so they produce identical revenue figures.
 */
export function getSaleTotal(s) {
    const explicit = parseFloat(s?.total);
    if (Number.isFinite(explicit)) return explicit;
    const qty      = parseFloat(s?.quantity) || 0;
    const price    = parseFloat(s?.price)    || 0;
    const discount = parseFloat(s?.discount) || 0;
    const tax      = parseFloat(s?.tax)      || 0;
    const subtotal = qty * price;
    const discounted = subtotal * (1 - discount / 100);
    return discounted * (1 + tax / 100);
}
