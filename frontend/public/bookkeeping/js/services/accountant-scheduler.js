/**
 * AccountantScheduler — fires scheduled AI accountant reports while the app is open.
 * Schedule config persists in localStorage; results written to Firestore + local cache.
 */

import { auth, db, collection, addDoc } from '../config/firebase.js';

const BACKEND_URL = window.BACKEND_URL || '';
const CONFIG_KEY  = 'accountant_schedule_config';
const LASTRUN_KEY = 'accountant_schedule_last_run';
const CACHE_KEY   = 'accountant_recent_reports';
const UNREAD_KEY  = 'accountant_reports_unread';

export const REPORT_TYPES = {
    daily_pl:       { label: 'Daily P&L Summary',    icon: 'fa-chart-line',   color: '#059669' },
    weekly_expense: { label: 'Weekly Expense Review', icon: 'fa-tags',         color: '#d97706' },
    monthly_vat:    { label: 'Monthly VAT Report',    icon: 'fa-file-invoice', color: '#7c3aed' },
};

const DEFAULT_CONFIG = {
    daily_pl:       { enabled: false, hour: 7,  minute: 0 },
    weekly_expense: { enabled: false, day: 1,   hour: 9,  minute: 0 },
    monthly_vat:    { enabled: false, dayOfMonth: 1, hour: 8, minute: 0 },
};

class AccountantScheduler {
    constructor() {
        this._interval = null;
        this._onReport = null;
    }

    init(onReport) {
        this._onReport = onReport;
    }

    start() {
        if (this._interval) return;
        this._tick();
        this._interval = setInterval(() => this._tick(), 60_000);
    }

    stop() {
        clearInterval(this._interval);
        this._interval = null;
    }

    getConfig() {
        try {
            const raw = localStorage.getItem(CONFIG_KEY);
            if (raw) {
                const p = JSON.parse(raw);
                return {
                    daily_pl:       { ...DEFAULT_CONFIG.daily_pl,       ...(p.daily_pl       || {}) },
                    weekly_expense: { ...DEFAULT_CONFIG.weekly_expense,  ...(p.weekly_expense  || {}) },
                    monthly_vat:    { ...DEFAULT_CONFIG.monthly_vat,     ...(p.monthly_vat     || {}) },
                };
            }
        } catch (_) { /* */ }
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    saveConfig(config) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }

    _getLastRuns() {
        try { return JSON.parse(localStorage.getItem(LASTRUN_KEY)) || {}; }
        catch { return {}; }
    }

    _saveLastRun(type, key) {
        const runs = this._getLastRuns();
        runs[type] = key;
        localStorage.setItem(LASTRUN_KEY, JSON.stringify(runs));
    }

    getRecentReports() {
        try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || []; }
        catch { return []; }
    }

    _cacheReport(report) {
        const reports = this.getRecentReports();
        reports.unshift(report);
        if (reports.length > 20) reports.length = 20;
        localStorage.setItem(CACHE_KEY, JSON.stringify(reports));
    }

    getUnreadCount() {
        return parseInt(localStorage.getItem(UNREAD_KEY) || '0', 10);
    }

    clearUnread() {
        localStorage.setItem(UNREAD_KEY, '0');
    }

    _incUnread() {
        localStorage.setItem(UNREAD_KEY, String(this.getUnreadCount() + 1));
    }

    _tick() {
        const config   = this.getConfig();
        const lastRuns = this._getLastRuns();
        const now      = new Date();
        this._checkDaily(config.daily_pl, lastRuns.daily_pl, now);
        this._checkWeekly(config.weekly_expense, lastRuns.weekly_expense, now);
        this._checkMonthly(config.monthly_vat, lastRuns.monthly_vat, now);
    }

    _dailyKey(d)  { return `d${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
    _weekKey(d)   {
        const s = new Date(d); s.setHours(0,0,0,0); s.setDate(s.getDate() - s.getDay());
        return `w${s.getFullYear()}-${s.getMonth()}-${s.getDate()}`;
    }
    _monthKey(d)  { return `m${d.getFullYear()}-${d.getMonth()}`; }

    _checkDaily(cfg, lastRun, now) {
        if (!cfg.enabled) return;
        if (now.getHours() !== cfg.hour || now.getMinutes() !== cfg.minute) return;
        const key = this._dailyKey(now);
        if (lastRun === key) return;
        this._saveLastRun('daily_pl', key);
        this._runReport('daily_pl');
    }

    _checkWeekly(cfg, lastRun, now) {
        if (!cfg.enabled) return;
        if (now.getDay() !== cfg.day) return;
        if (now.getHours() !== cfg.hour || now.getMinutes() !== cfg.minute) return;
        const key = this._weekKey(now);
        if (lastRun === key) return;
        this._saveLastRun('weekly_expense', key);
        this._runReport('weekly_expense');
    }

    _checkMonthly(cfg, lastRun, now) {
        if (!cfg.enabled) return;
        if (now.getDate() !== cfg.dayOfMonth) return;
        if (now.getHours() !== cfg.hour || now.getMinutes() !== cfg.minute) return;
        const key = this._monthKey(now);
        if (lastRun === key) return;
        this._saveLastRun('monthly_vat', key);
        this._runReport('monthly_vat');
    }

    async _runReport(type) {
        const user = auth.currentUser;
        if (!user) return;

        try {
            const token = await user.getIdToken();
            const resp  = await fetch(`${BACKEND_URL}/api/ai/accountant/scheduled`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body:    JSON.stringify({ report_type: type }),
            });

            if (!resp.ok) {
                console.warn(`[Scheduler] ${type} failed: ${resp.status}`);
                return;
            }

            const data = await resp.json();
            const responseText = data.response || '';

            // Drop error responses — don't pollute history with config/infra failures
            const isError = !responseText ||
                /not configured|missing|unavailable|error generating/i.test(responseText);
            if (isError) {
                console.warn('[Scheduler] Report response was an error — not stored:', responseText.slice(0, 120));
                return;
            }

            const report = {
                id:          `${type}_${Date.now()}`,
                type,
                label:       REPORT_TYPES[type].label,
                text:        responseText,
                tools:       data.tools_called || [],
                steps:       data.steps || 0,
                generatedAt: new Date().toISOString(),
            };

            this._cacheReport(report);
            this._incUnread();

            try {
                const col = collection(db, 'users', user.uid, 'accountant_reports');
                await addDoc(col, {
                    type:        report.type,
                    label:       report.label,
                    text:        report.text,
                    tools:       report.tools,
                    steps:       report.steps,
                    generatedAt: report.generatedAt,
                });
            } catch (fsErr) {
                console.warn('[Scheduler] Firestore write failed:', fsErr);
            }

            if (this._onReport) this._onReport(report);

        } catch (err) {
            console.error('[Scheduler] Error:', err);
        }
    }
}

export const accountantScheduler = new AccountantScheduler();
window.accountantScheduler = accountantScheduler;
export default accountantScheduler;
