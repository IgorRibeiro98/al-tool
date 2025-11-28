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

export class ConciliacaoPipeline {
    private steps: PipelineStep[];

    constructor(steps: PipelineStep[]) {
        this.steps = steps || [];
    }

    async run(ctx: PipelineContext): Promise<void> {
        for (const step of this.steps) {
            await step.execute(ctx);
        }
    }

    // helper to inspect step names
    getStepNames(): string[] {
        return this.steps.map(s => s.name);
    }
}

export default ConciliacaoPipeline;

// export steps
export { NullsBaseAStep } from './steps/NullsBaseAStep';
export { NullsBaseBStep } from './steps/NullsBaseBStep';
export { EstornoBaseAStep } from './steps/EstornoBaseAStep';
export { CancelamentoBaseBStep } from './steps/CancelamentoBaseBStep';
export { ConciliacaoABStep } from './steps/ConciliacaoABStep';
