/**
 * Save PDF on Capacitor iOS/Android without npm bare imports.
 * Plain ES modules cannot import('@capacitor/*'); use registerPlugin when the bridge exists.
 * If the bridge is missing (remote URL, timing), fall back to Web Share API (files) or download.
 */

export function isCapacitorNative() {
    return window.Capacitor?.isNativePlatform?.() === true;
}

/** True only when JS can register Filesystem / Share (injected capacitor runtime) */
export function hasCapacitorPluginBridge() {
    const c = window.Capacitor;
    return !!(c && typeof c.registerPlugin === 'function');
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const r = reader.result;
            const base64 = typeof r === 'string' ? r.split(',')[1] : '';
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/** Matches @capacitor/filesystem Directory enum strings */
const Directory = {
    Documents: 'DOCUMENTS',
};

function getFilesystem() {
    const cap = window.Capacitor;
    if (!cap || typeof cap.registerPlugin !== 'function') {
        throw new Error('Capacitor runtime not available');
    }
    return cap.registerPlugin('Filesystem', {});
}

function getShare() {
    const cap = window.Capacitor;
    if (!cap || typeof cap.registerPlugin !== 'function') {
        throw new Error('Capacitor runtime not available');
    }
    return cap.registerPlugin('Share', {});
}

/** Share sheet (text/url) — uses bridge or navigator.share */
export async function capacitorShare(options) {
    if (hasCapacitorPluginBridge()) {
        const Share = getShare();
        return Share.share(options);
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        return navigator.share({
            title: options.title,
            text: options.text,
            url: options.url,
        });
    }
    throw new Error('Share not available');
}

/** Write a UTF-8 text file to app Documents */
export async function capacitorWriteUtf8File(path, text) {
    if (!hasCapacitorPluginBridge()) {
        throw new Error('Capacitor runtime not available');
    }
    const Filesystem = getFilesystem();
    await Filesystem.writeFile({
        path,
        data: text,
        directory: Directory.Documents,
        encoding: 'utf8',
    });
}

/**
 * Capacitor Filesystem + Share (any binary/text blob saved as base64 file).
 */
export async function shareBlobNativeFilesystem(blob, fileName, title, hint) {
    const base64Data = await blobToBase64(blob);
    const Filesystem = getFilesystem();
    const Share = getShare();

    await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true,
    });

    const { uri } = await Filesystem.getUri({
        path: fileName,
        directory: Directory.Documents,
    });

    await Share.share({
        title: title || 'Export',
        text: hint || 'Save to Files, AirDrop, or another app',
        url: uri,
        dialogTitle: title || 'Save or share',
    });
}

/** @deprecated use shareBlobNativeFilesystem */
export const sharePdfBlobNative = shareBlobNativeFilesystem;

export const FILE_SHARE_UNAVAILABLE = 'FILE_SHARE_UNAVAILABLE';
/** @deprecated alias */
export const PDF_SHARE_UNAVAILABLE = FILE_SHARE_UNAVAILABLE;

function isUserAbort(err) {
    const name = err && err.name;
    if (name === 'AbortError') return true;
    const msg = String(err && err.message ? err.message : err).toLowerCase();
    return msg.includes('cancel') || msg.includes('dismiss') || msg.includes('abort');
}

/** Native WebView can inject registerPlugin shortly after first paint */
async function waitForCapacitorBridge(maxMs = 2500) {
    if (hasCapacitorPluginBridge()) return true;
    if (!isCapacitorNative()) return false;
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        await new Promise((r) => setTimeout(r, 80));
        if (hasCapacitorPluginBridge()) return true;
    }
    return hasCapacitorPluginBridge();
}

/**
 * Capacitor → Web Share (files) → throws FILE_SHARE_UNAVAILABLE
 * @param {Blob} blob
 * @param {string} fileName — safe ASCII name (caller may sanitize)
 */
export async function shareBlobFileBestEffort(blob, fileName, title, hint) {
    const bridgeReady = (await waitForCapacitorBridge()) && isCapacitorNative();
    if (bridgeReady) {
        await shareBlobNativeFilesystem(blob, fileName, title, hint);
        return 'capacitor';
    }

    const mime = blob.type || 'application/octet-stream';
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
            const file = new File([blob], fileName, { type: mime });
            if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: title || 'Export',
                    text: hint || '',
                });
                return 'web-share';
            }
        } catch (e) {
            if (isUserAbort(e)) throw e;
            console.warn('navigator.share(files) failed:', e);
        }
    }

    const err = new Error(FILE_SHARE_UNAVAILABLE);
    err.code = FILE_SHARE_UNAVAILABLE;
    throw err;
}

export async function sharePdfBlobBestEffort(pdfBlob, fileName, title, hint) {
    const b =
        pdfBlob && pdfBlob.type && pdfBlob.type.includes('pdf')
            ? pdfBlob
            : new Blob([pdfBlob], { type: 'application/pdf' });
    return shareBlobFileBestEffort(b, fileName, title, hint);
}

/** Trigger download of any blob (CSV, XLSX, PDF, …) */
export function downloadBlobInBrowser(blob, fileName) {
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** @deprecated use downloadBlobInBrowser */
export const downloadPdfBlobInBrowser = downloadBlobInBrowser;

/**
 * Share sheet or download — for CSV/Excel from export-service and Utils.
 * @returns {{ ok: boolean, cancelled?: boolean }}
 */
export async function saveBlobWithNativeFallbacks(blob, fileName, shareTitle, hint) {
    const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    try {
        await shareBlobFileBestEffort(blob, safeName, shareTitle, hint || 'Save or share this file');
        return { ok: true };
    } catch (e) {
        if (isUserAbort(e)) return { ok: false, cancelled: true };
        try {
            downloadBlobInBrowser(blob, fileName);
            return { ok: true };
        } catch (dl) {
            console.warn('saveBlobWithNativeFallbacks: download failed', dl);
            throw e;
        }
    }
}
