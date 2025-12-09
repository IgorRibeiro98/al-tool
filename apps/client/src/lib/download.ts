import { AxiosResponse } from 'axios';

// Constants
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const URL_REVOKE_DELAY_MS = 1000; // Allow time for browser to start download before revoking
const DEFAULT_FILENAME = 'download';

function getHeaderValue(headers: Record<string, any> | undefined, key: string): string | undefined {
    if (!headers) return undefined;
    return headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
}

function parseFilenameFromContentDisposition(header?: string | null): string | null {
    if (!header) return null;

    const filenameStar = header.match(/filename\*=(?:UTF-8''|utf-8'')([^;\n]+)/i);
    if (filenameStar && filenameStar[1]) {
        try {
            return decodeURIComponent(filenameStar[1].trim());
        } catch {
            return filenameStar[1].trim();
        }
    }

    const filenameMatch = header.match(/filename\s*=\s*"?([^";\n]+)"?/i);
    if (filenameMatch && filenameMatch[1]) return filenameMatch[1].trim();
    return null;
}

function sanitizeFilename(name: string): string {
    if (!name) return DEFAULT_FILENAME;
    // Remove characters that can interfere with file paths or browsers
    const sanitized = name.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim();
    // Limit length to avoid issues on some filesystems
    return sanitized.slice(0, 200) || DEFAULT_FILENAME;
}

function deriveFilename(response: AxiosResponse, explicitName?: string | null): string {
    if (explicitName) return sanitizeFilename(explicitName);

    const contentDisposition = getHeaderValue(response.headers, 'content-disposition') ?? '';
    const fromContentDisposition = parseFilenameFromContentDisposition(contentDisposition);
    if (fromContentDisposition) return sanitizeFilename(fromContentDisposition);

    // Fallback: try to infer from request URL
    try {
        const url = response.config?.url;
        if (url) {
            const parsed = new URL(url, window.location.href);
            const last = parsed.pathname.split('/').filter(Boolean).pop();
            if (last) return sanitizeFilename(decodeURIComponent(last));
        }
    } catch {
        // ignore and fallback
    }

    return DEFAULT_FILENAME;
}

function createAndClickAnchor(objectUrl: string, filename?: string | null): void {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    if (filename) anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);

    try {
        anchor.click();
    } finally {
        // Clean up after a short delay to give browser time to process the click
        setTimeout(() => {
            try {
                URL.revokeObjectURL(objectUrl);
            } catch {
                /* ignore */
            }
            anchor.remove();
        }, URL_REVOKE_DELAY_MS);
    }
}

/**
 * Download a file from an Axios response.
 * Returns the filename used for the download (or null if download was not triggered).
 */
export function downloadFromResponse(response: AxiosResponse, explicitName?: string | null): string | null {
    if (!response || typeof response !== 'object') {
        console.error('downloadFromResponse: resposta inválida');
        return null;
    }

    const responseType = response.config?.responseType;
    if (!responseType || (responseType !== 'blob' && responseType !== 'arraybuffer')) {
        console.error('downloadFromResponse: a requisição deve usar `responseType: "blob" | "arraybuffer"`');
        return null;
    }

    const contentType = getHeaderValue(response.headers, 'content-type') ?? DEFAULT_CONTENT_TYPE;
    const data = response.data;

    const blob = data instanceof Blob ? data : new Blob([data], { type: contentType });

    const filename = deriveFilename(response, explicitName);

    const objectUrl = URL.createObjectURL(blob);
    createAndClickAnchor(objectUrl, filename);

    return filename || null;
}

export default { downloadFromResponse };
