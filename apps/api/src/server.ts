import './env';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import basesRouter from './routes/bases';
import configsCancelamentoRouter from './routes/configsCancelamento';
import configsEstornoRouter from './routes/configsEstorno';
import configsConciliacaoRouter from './routes/configsConciliacao';
import configsMapeamentoRouter from './routes/configsMapeamento';
import conciliacoesRouter from './routes/conciliacoes';
import maintenanceRouter from './routes/maintenance';
import licenseRouter from './routes/license';
import './pipeline/integration';
import { startConciliacaoWorker } from './worker/conciliacaoWorker';
import { startIngestWorker } from './worker/ingestWorker';
import { DATA_DIR, DB_PATH, UPLOAD_DIR, EXPORT_DIR } from './config/paths';

const app = express();
const portEnv = process.env.APP_PORT || process.env.PORT || '3000';
const port = Number(portEnv) || 3000;
const clientDistPath = path.resolve(__dirname, '../../client/dist');

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - startedAt;
        console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});
// CORS setup
// Configure via CORS_ORIGIN env var. Examples:
// - unset or "*" => allow any origin (useful for local dev)
// - "https://example.com" => allow only that origin
// - "https://a.com,https://b.com" => allow those origins
const corsEnv = process.env.CORS_ORIGIN || '*';
let corsOptions: any = undefined;
if (corsEnv === '*' || corsEnv.trim() === '') {
    corsOptions = { origin: true };
}
// else {
//     const allowed = corsEnv.split(',').map((s) => s.trim()).filter(Boolean);
//     corsOptions = {
//         origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
//             // allow non-browser or same-origin requests (no origin)
//             if (!origin) return callback(null, true);
//             if (allowed.indexOf(origin) !== -1) return callback(null, true);
//             return callback(new Error('Not allowed by CORS'));
//         },
//         credentials: true
//     };
// }
app.use(cors(corsOptions));

app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', dataDir: DATA_DIR, dbPath: DB_PATH });
});

// Diagnostics endpoint to inspect effective env + resolved paths
app.get('/api/diagnostics/env', (_req: Request, res: Response) => {
    res.json({
        NODE_ENV: process.env.NODE_ENV,
        APP_PORT: process.env.APP_PORT,
        DATA_DIR,
        DB_PATH,
        UPLOAD_DIR,
        EXPORT_DIR,
        RAW_DATA_DIR: process.env.DATA_DIR,
        RAW_APP_DATA_DIR: process.env.APP_DATA_DIR,
    });
});

// Mount API under /api
const apiRouter = express.Router();
apiRouter.use('/bases', basesRouter);
apiRouter.use('/configs/cancelamento', configsCancelamentoRouter);
apiRouter.use('/configs/estorno', configsEstornoRouter);
apiRouter.use('/configs/conciliacao', configsConciliacaoRouter);
apiRouter.use('/configs/mapeamento', configsMapeamentoRouter);
apiRouter.use('/conciliacoes', conciliacoesRouter);
apiRouter.use('/maintenance', maintenanceRouter);
apiRouter.use('/license', licenseRouter);
app.use('/api', apiRouter);

// Serve frontend build (always prefer dist to make Electron loadable)
app.use(express.static(clientDistPath));

// SPA fallback: middleware that serves index.html for all non-API GET requests
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.method !== 'GET') {
        return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
});

if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
        console.log(`App listening on http://localhost:${port}`);
        try {
            startConciliacaoWorker();
            console.log('Conciliacao worker started');
        } catch (err) {
            console.error('Failed to start conciliacao worker', err);
        }
        try {
            startIngestWorker();
            console.log('Ingest worker started');
        } catch (err) {
            console.error('Failed to start ingest worker', err);
        }
    });
}

export default app;
