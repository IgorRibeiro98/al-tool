import fs from 'fs/promises';
import path from 'path';
import { UPLOAD_DIR } from '../../config/paths';
import { randomUUID } from 'crypto';

const DEFAULT_MAX_BYTES = 2000 * 1024 * 1024; // 2000 MB

export class FileStorage {
    private readonly uploadsDir: string;
    private readonly maxBytes: number;
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;

    constructor(options?: { uploadsDir?: string; maxBytes?: number; logger?: Pick<Console, 'info' | 'warn' | 'error'> }) {
        this.uploadsDir = path.resolve(options?.uploadsDir ?? UPLOAD_DIR);
        const envMax = process.env.FILE_STORAGE_MAX_BYTES ? Number(process.env.FILE_STORAGE_MAX_BYTES) : undefined;
        this.maxBytes = options?.maxBytes ?? envMax ?? DEFAULT_MAX_BYTES;
        this.logger = options?.logger ?? console;
    }

    // Ensure uploads directory exists and is writable
    private async ensureUploadsDir(): Promise<void> {
        try {
            await fs.mkdir(this.uploadsDir, { recursive: true });
        } catch (err) {
            this.logger.error('[FileStorage] Failed to ensure uploads directory', err);
            throw err;
        }
    }

    private generateFilename(originalName: string): string {
        const ext = this.sanitizeExtension(path.extname(originalName || '') || '');
        return `${randomUUID()}${ext}`;
    }

    private sanitizeExtension(ext: string): string {
        if (!ext) return '';
        // Keep only the leading dot plus alphanumerics (e.g. `.txt`, `.csv`)
        const m = ext.match(/^\.[a-zA-Z0-9]+$/);
        return m ? m[0].toLowerCase() : '';
    }

    private toRelativePosix(absolutePath: string): string {
        return path.relative(process.cwd(), absolutePath).split(path.sep).join(path.posix.sep);
    }

    /**
     * Save a buffer to storage. Returns POSIX relative path (suitable for DB storage).
     * Throws on invalid input or write errors.
     */
    async save(buffer: Buffer, originalName: string): Promise<string> {
        if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer must be a Buffer');
        if (!originalName || typeof originalName !== 'string') throw new TypeError('originalName must be a string');
        if (buffer.length === 0) throw new Error('buffer is empty');
        if (buffer.length > this.maxBytes) throw new Error(`file exceeds max size ${this.maxBytes} bytes`);

        await this.ensureUploadsDir();

        const filename = this.generateFilename(originalName);
        const absolute = path.join(this.uploadsDir, filename);

        try {
            await fs.writeFile(absolute, buffer);
            this.logger.info('[FileStorage] saved', filename);
            return this.toRelativePosix(absolute);
        } catch (err) {
            this.logger.error('[FileStorage] write error', err);
            throw err;
        }
    }

    /**
     * Delete a file by relative path (from process.cwd()) if it exists.
     * Returns true if deleted, false if file not found.
     */
    async delete(relativePosixPath: string): Promise<boolean> {
        if (!relativePosixPath) return false;
        const absolute = path.resolve(process.cwd(), relativePosixPath);
        try {
            await fs.unlink(absolute);
            this.logger.info('[FileStorage] deleted', relativePosixPath);
            return true;
        } catch (err: any) {
            if (err && err.code === 'ENOENT') return false;
            this.logger.error('[FileStorage] delete error', err);
            throw err;
        }
    }

    /**
     * Helper: check if a given relative path exists on disk.
     */
    async exists(relativePosixPath: string): Promise<boolean> {
        if (!relativePosixPath) return false;
        const absolute = path.resolve(process.cwd(), relativePosixPath);
        try {
            const st = await fs.stat(absolute);
            return st.isFile();
        } catch (err: any) {
            if (err && err.code === 'ENOENT') return false;
            this.logger.error('[FileStorage] exists check error', err);
            throw err;
        }
    }
}

export const fileStorage = new FileStorage();

export default FileStorage;
