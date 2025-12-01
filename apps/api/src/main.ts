import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';

import basesRouter from './routes/bases';
import configsCancelamentoRouter from './routes/configsCancelamento';
import configsEstornoRouter from './routes/configsEstorno';
import configsConciliacaoRouter from './routes/configsConciliacao';
import conciliacoesRouter from './routes/conciliacoes';
import maintenanceRouter from './routes/maintenance';
import './pipeline/integration';
import { startConciliacaoWorker } from './worker/conciliacaoWorker';
import { startIngestWorker } from './worker/ingestWorker';

const app = express();

const portEnv = process.env.APP_PORT || process.env.PORT || '3131';
const port = Number(portEnv) || 3131;

// Basic logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - startedAt;
        console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

app.use(express.json());

// CORS setup (same behaviour as existing server.ts)
const corsEnv = process.env.CORS_ORIGIN || '*';
let corsOptions: any = undefined;
if (corsEnv === '*' || corsEnv.trim() === '') {
    corsOptions = { origin: true };
}
app.use(cors(corsOptions));

// Health check (root level)
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

// API routes are all mounted under /api
const apiRouter = express.Router();

apiRouter.use('/bases', basesRouter);
apiRouter.use('/configs/cancelamento', configsCancelamentoRouter);
apiRouter.use('/configs/estorno', configsEstornoRouter);
apiRouter.use('/configs/conciliacao', configsConciliacaoRouter);
apiRouter.use('/conciliacoes', conciliacoesRouter);
apiRouter.use('/maintenance', maintenanceRouter);

app.use('/api', apiRouter);

// Static files only in production
if (process.env.NODE_ENV === 'production') {
    const clientDist = path.resolve(__dirname, '../../client/dist');
    app.use(express.static(clientDist));

    // SPA fallback: serve index.html for non-API GET requests
    app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith('/api') || req.method !== 'GET') {
            return next();
        }
        res.sendFile(path.join(clientDist, 'index.html'));
    });
}

// Default error handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    const status = err.status || 500;
    res.status(status).json({
        message: err.message || 'Internal server error',
    });
});

if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
        console.log(`App listening on http://localhost:${port}`);
        try {
            startConciliacaoWorker();
            console.log('Conciliacao worker started');
            try {
                startIngestWorker();
                console.log('Ingest worker started');
            } catch (err) {
                console.error('Failed to start ingest worker', err);
            }
        } catch (err) {
            console.error('Failed to start conciliacao worker', err);
        }
    });
}

export default app;
