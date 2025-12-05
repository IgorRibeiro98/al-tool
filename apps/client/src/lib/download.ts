import { AxiosResponse } from 'axios';

function parseFilenameFromContentDisposition(header?: string | null): string | null {
    if (!header) return null
    const filenameStar = header.match(/filename\*=(?:UTF-8''|utf-8'')([^;\n]+)/)
    if (filenameStar && filenameStar[1]) {
        try {
            return decodeURIComponent(filenameStar[1].trim())
        } catch {
            return filenameStar[1].trim()
        }
    }
    const filenameMatch = header.match(/filename\s*=\s*"?([^";\n]+)"?/)
    if (filenameMatch && filenameMatch[1]) return filenameMatch[1].trim()
    return null
}

function sanitizeFilename(name: string): string {
    return name;
    return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export const downloadFromResponse = (response: AxiosResponse, explicitName?: string | null) => {
    const { data, headers, config } = response;
    if (!config?.responseType || config.responseType !== 'blob') {
        console.error('A request deve conter a config "responseType: `blob`"');
        return;
    }

    const contentType = headers['content-type'] || headers['Content-Type'] || 'application/octet-stream';
    const contentDisposition = headers['content-disposition'] || headers['Content-Disposition'] || '';

    const blob = new Blob([data], { type: contentType });

    let filename = explicitName ?? parseFilenameFromContentDisposition(contentDisposition);
    if (filename) filename = sanitizeFilename(filename);

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }, 0);
};

export default { downloadFromResponse };
