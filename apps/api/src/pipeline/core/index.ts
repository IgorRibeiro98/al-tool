export interface PipelineContext {
    jobId: number;
    baseContabilId: number;
    baseFiscalId: number;
    configConciliacaoId: number;
    configEstornoId?: number;
    configCancelamentoId?: number;
    reportStage?: (info: { stepName: string; stepIndex: number; totalSteps: number }) => Promise<void>;
}

export interface PipelineStep {
    name: string;
    execute(ctx: PipelineContext): Promise<void>;
}

type PipelineLogger = Pick<Console, 'info' | 'warn' | 'error'>;

function isPipelineStep(value: unknown): value is PipelineStep {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as any).name === 'string' &&
        typeof (value as any).execute === 'function'
    );
}

// Helper to trigger garbage collection (works only if node is run with --expose-gc)
function tryGarbageCollect(): void {
    if (typeof global !== 'undefined' && typeof (global as any).gc === 'function') {
        try {
            (global as any).gc();
        } catch (_) {
            // ignore errors
        }
    }
}

// Helper to get current memory usage in MB for logging
function getMemoryUsageMB(): { heapUsed: number; heapTotal: number; rss: number } {
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
        const mem = process.memoryUsage();
        return {
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
            rss: Math.round(mem.rss / 1024 / 1024),
        };
    }
    return { heapUsed: 0, heapTotal: 0, rss: 0 };
}

export class ConciliacaoPipeline {
    private readonly steps: PipelineStep[];
    private readonly logger: PipelineLogger;

    constructor(steps: PipelineStep[] = [], logger: PipelineLogger = console) {
        this.logger = logger;
        this.steps = Array.isArray(steps) ? this.validateSteps(steps) : [];
    }

    private validateSteps(steps: PipelineStep[]): PipelineStep[] {
        const invalid = steps.findIndex(s => !isPipelineStep(s));
        if (invalid >= 0) {
            const idx = invalid;
            const bad = steps[idx];
            this.logger.error('[ConciliacaoPipeline] invalid step at index', idx, bad);
            throw new TypeError(`Invalid pipeline step provided at index ${idx}`);
        }
        // return a shallow copy to avoid external mutation
        return steps.slice();
    }

    async run(ctx: PipelineContext): Promise<void> {
        const totalSteps = this.steps.length;

        for (let i = 0; i < totalSteps; i++) {
            const step = this.steps[i];

            // Report stage before starting step
            if (ctx.reportStage) {
                try {
                    await ctx.reportStage({ stepName: step.name, stepIndex: i, totalSteps });
                } catch (err) {
                    this.logger.warn('[ConciliacaoPipeline] reportStage failed', { step: step.name }, err);
                }
            }

            // Log memory before step
            const memBefore = getMemoryUsageMB();
            this.logger.info('[ConciliacaoPipeline] starting step', {
                index: i,
                step: step.name,
                jobId: ctx?.jobId,
                memoryMB: memBefore
            });

            try {
                await step.execute(ctx);
            } catch (err) {
                // log with useful context and rethrow to let caller decide what to do
                this.logger.error('[ConciliacaoPipeline] step failed', { index: i, step: step.name, jobId: ctx?.jobId }, err);
                throw err;
            }

            // Log memory after step and trigger GC hint
            const memAfter = getMemoryUsageMB();
            this.logger.info('[ConciliacaoPipeline] completed step', {
                index: i,
                step: step.name,
                jobId: ctx?.jobId,
                memoryMB: memAfter,
                memoryDeltaMB: memAfter.heapUsed - memBefore.heapUsed
            });

            // Give V8 a hint to garbage collect between steps
            tryGarbageCollect();
        }
    }

    // helper to inspect step names
    getStepNames(): string[] {
        return this.steps.map(s => s.name);
    }
}

export default ConciliacaoPipeline;

// re-export steps for convenience (keeps compatibility with existing imports)
export { NullsBaseAStep } from './steps/NullsBaseAStep';
export { NullsBaseBStep } from './steps/NullsBaseBStep';
export { EstornoBaseAStep } from './steps/EstornoBaseAStep';
export { CancelamentoBaseBStep } from './steps/CancelamentoBaseBStep';
export { ConciliacaoABStep } from './steps/ConciliacaoABStep';
