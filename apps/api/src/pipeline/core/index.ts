export interface PipelineContext {
    jobId: number;
    baseContabilId: number;
    baseFiscalId: number;
    configConciliacaoId: number;
    configEstornoId?: number;
    configCancelamentoId?: number;
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
        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i];
            try {
                await step.execute(ctx);
            } catch (err) {
                // log with useful context and rethrow to let caller decide what to do
                this.logger.error('[ConciliacaoPipeline] step failed', { index: i, step: step.name, jobId: ctx?.jobId }, err);
                throw err;
            }
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
