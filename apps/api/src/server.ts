import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import path from 'path';
import basesRouter from './routes/bases';
import configsCancelamentoRouter from './routes/configsCancelamento';
import configsEstornoRouter from './routes/configsEstorno';
import configsConciliacaoRouter from './routes/configsConciliacao';
import configsMapeamentoRouter from './routes/configsMapeamento';
import conciliacoesRouter from './routes/conciliacoes';
import keysRouter from './routes/keys';
import keysPairsRouter from './routes/keysPairs';
import maintenanceRouter from './routes/maintenance';
import licenseRouter from './routes/license';
import './pipeline/integration';
import { startConciliacaoWorker } from './worker/conciliacaoWorker';
import { startIngestWorker } from './worker/ingestWorker';
import { env } from './env';

const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
const DEFAULT_PORT = 3000;

function parseCors(originEnv: string | undefined): CorsOptions | undefined {
    const raw = (originEnv || '*').trim();
    if (raw === '*' || raw === '') return { origin: true };
    const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length === 0) return { origin: true };
    return {
        origin: (incomingOrigin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
            if (!incomingOrigin) return cb(null, true);
            return cb(null, allowed.includes(incomingOrigin));
        },
        credentials: true,
    };
}

function requestTimingLogger(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    });
    next();
}

function createApiRouter() {
    const router = express.Router();
    router.use('/bases', basesRouter);
    router.use('/configs/cancelamento', configsCancelamentoRouter);
    router.use('/configs/estorno', configsEstornoRouter);
    router.use('/configs/conciliacao', configsConciliacaoRouter);
    router.use('/configs/mapeamento', configsMapeamentoRouter);
    router.use('/keys', keysRouter);
    router.use('/keys-pairs', keysPairsRouter);
    router.use('/conciliacoes', conciliacoesRouter);
    router.use('/maintenance', maintenanceRouter);
    router.use('/license', licenseRouter);
    return router;
}

export function createApp() {
    const app = express();
    const port = Number(env.port || DEFAULT_PORT) || DEFAULT_PORT;

    app.use(express.json());
    app.use(requestTimingLogger);

    const corsOptions = parseCors(env.get('CORS_ORIGIN', '*'));
    app.use(cors(corsOptions));

    app.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok', dataDir: env.dataDir, dbPath: env.dbPath });
    });

    app.get('/api/diagnostics/env', (_req: Request, res: Response) => {
        res.json({
            NODE_ENV: env.nodeEnv,
            APP_PORT: env.raw.APP_PORT,
            DATA_DIR: env.dataDir,
            DB_PATH: env.dbPath,
            UPLOAD_DIR: env.uploadDir,
            EXPORT_DIR: env.exportDir,
            RAW_DATA_DIR: env.raw.DATA_DIR,
            RAW_APP_DATA_DIR: env.raw.APP_DATA_DIR,
        });
    });

    app.use('/api', createApiRouter());

    // Serve frontend build (preferred for Electron compatibility)
    app.use(express.static(CLIENT_DIST));

    // SPA fallback for non-API GET requests
    app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith('/api') || req.method !== 'GET') return next();
        res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });

    // attach port to app locals for easier testing/debugging
    (app as any).locals.port = port;
    return app;
}

function startBackgroundWorkers() {
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
}

export function startServer() {
    const app = createApp();
    const port = Number(env.port || DEFAULT_PORT) || DEFAULT_PORT;
    const nodeEnv = env.nodeEnv;

    if (nodeEnv === 'test') {
        console.log('[startServer] Test environment detected, skipping listen');
        return app;
    }

    const server = app.listen(port, () => {
        console.log(`App listening on http://localhost:${port}`);
        startBackgroundWorkers();
    });

    return server;
}

const defaultApp = createApp();
if (env.nodeEnv !== 'test') {
    // start server when module is executed directly (production/dev)
    startServer();
}

export default defaultApp;
