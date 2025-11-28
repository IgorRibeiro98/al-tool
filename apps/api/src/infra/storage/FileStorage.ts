import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export class FileStorage {
    private uploadsDir: string;

    constructor(uploadsDir?: string) {
        // Default to project-root/apps/api/storage/uploads
        this.uploadsDir = uploadsDir || path.resolve(__dirname, '..', '..', '..', 'storage', 'uploads');
    }

    /**
     * Save a file buffer to the uploads folder using a UUID filename.
     * @param buffer File contents as Buffer
     * @param originalName Original filename (used to preserve extension)
     * @returns Relative path to saved file from process.cwd()
     */
    async saveFile(buffer: Buffer, originalName: string): Promise<string> {
        await fs.mkdir(this.uploadsDir, { recursive: true });

        const ext = path.extname(originalName) || '';
        const filename = `${randomUUID()}${ext}`;
        const absolutePath = path.join(this.uploadsDir, filename);

        await fs.writeFile(absolutePath, buffer);

        // Return a posix-style relative path from the project root for easier storage in DB
        const rel = path.relative(process.cwd(), absolutePath).split(path.sep).join(path.posix.sep);
        return rel;
    }
}

// default instance for convenience
export const fileStorage = new FileStorage();

export default FileStorage;
