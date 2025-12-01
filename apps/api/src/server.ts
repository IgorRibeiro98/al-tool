import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
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
const defaultPort = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json());
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
    res.json({ status: 'ok' });
});

app.use('/bases', basesRouter);
app.use('/configs/cancelamento', configsCancelamentoRouter);
app.use('/configs/estorno', configsEstornoRouter);
app.use('/configs/conciliacao', configsConciliacaoRouter);
app.use('/conciliacoes', conciliacoesRouter);
app.use('/maintenance', maintenanceRouter);

export async function startServer(port?: number): Promise<{ port: number }> {
    const finalPort = port ?? defaultPort;

    return new Promise((resolve, reject) => {
        const server = app.listen(finalPort, () => {
            console.log(`Server listening on http://localhost:${finalPort}`);
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
            resolve({ port: finalPort });
        });

        server.on('error', (err: any) => {
            console.error('Failed to start API server', err);
            reject(err);
        });
    });
}

if (process.env.NODE_ENV !== 'test' && !process.env.RUN_INSIDE_ELECTRON) {
    // Standalone mode (CLI / dev)
    void startServer().catch((err) => {
        console.error('Error starting server in standalone mode', err);
        process.exitCode = 1;
    });
}

export default app;
