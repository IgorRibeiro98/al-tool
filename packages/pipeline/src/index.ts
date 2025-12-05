export interface PipelineContext {
    jobId: number;
    baseContabilId: number;
    baseFiscalId: number;
    configConciliacaoId: number;
    configEstornoId?: number;
    configCancelamentoId?: number;
    getBaseMeta?: (id: number) => Promise<any | undefined>;
    getConfigConciliacao?: (id: number) => Promise<any | undefined>;
    getConfigEstorno?: (id: number) => Promise<any | undefined>;
    getConfigCancelamento?: (id: number) => Promise<any | undefined>;
    reportStage?: (event: PipelineStageEvent) => Promise<void> | void;
}

export interface PipelineStageEvent {
    stepName: string;
    stepIndex: number;
    totalSteps: number;
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
        const total = this.steps.length;
        for (let index = 0; index < this.steps.length; index += 1) {
            const step = this.steps[index];
            if (ctx.reportStage) {
                await ctx.reportStage({ stepName: step.name, stepIndex: index, totalSteps: total });
            }
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
