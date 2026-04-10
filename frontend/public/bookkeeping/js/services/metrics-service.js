import { state } from '../utils/state.js';

const BACKEND_URL = (window.BACKEND_URL || '').replace(/\/$/, '');

/** Same-origin `/api/...` when BACKEND_URL is empty (Firebase Hosting rewrites to Cloud Run). */
function metricsIngestUrl() {
    if (BACKEND_URL) {
        return `${BACKEND_URL}/api/metrics/events`;
    }
    return '/api/metrics/events';
}

function generateId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch (e) {
        // noop
    }
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function detectPlatform() {
    try {
        if (window.Capacitor?.isNativePlatform?.()) {
            const p = (window.Capacitor.getPlatform?.() || '').toLowerCase();
            if (p === 'ios' || p === 'android') return p;
            return 'native';
        }
    } catch (e) {
        // noop
    }
    return 'web';
}

class MetricsService {
    constructor() {
        this.disabled = false;
    }

    buildEnvelope(eventName, payload = {}, meta = {}) {
        return {
            event_name: eventName,
            event_version: 1,
            event_id: generateId(),
            correlation_id: meta.correlationId || generateId(),
            timestamp_client: new Date().toISOString(),
            timestamp_server: null,
            actor: {
                user_id: state.currentUser?.uid || null,
                user_role: state.userRole || 'unknown',
                assigned_outlet: state.assignedOutlet || null
            },
            context: {
                selected_outlet_filter: state.selectedOutletFilter || null,
                section: window.appController?._currentSection || 'other',
                platform: detectPlatform(),
                app_version: window.APP_VERSION || null,
                release_sha: window.RELEASE_SHA || null
            },
            payload
        };
    }

    async emit(eventName, payload = {}, meta = {}) {
        if (this.disabled || !eventName) return;
        const event = this.buildEnvelope(eventName, payload, meta);

        // Keep a tiny local buffer for troubleshooting in QA.
        try {
            const key = 'metrics_event_buffer';
            const buf = JSON.parse(localStorage.getItem(key) || '[]');
            buf.push(event);
            localStorage.setItem(key, JSON.stringify(buf.slice(-100)));
        } catch (e) {
            // noop
        }

        try {
            await fetch(metricsIngestUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event)
            });
        } catch (e) {
            // Best-effort only.
        }
    }
}

export const metricsService = new MetricsService();

