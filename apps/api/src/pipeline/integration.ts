import {
    ConciliacaoPipeline,
    PipelineStep,
    NullsBaseAStep,
    EstornoBaseAStep,
    NullsBaseBStep,
    CancelamentoBaseBStep,
    ConciliacaoABStep,
} from './core';
import defaultDb from '../db/knex';
import type { Knex } from 'knex';

type PipelineLogger = Pick<Console, 'info' | 'warn' | 'error'>;

export type PipelineFactoryOptions = {
    db?: Knex;
    logger?: PipelineLogger;
};

function buildDefaultSteps(db: Knex): PipelineStep[] {
    return [
        new NullsBaseAStep(db),
        new EstornoBaseAStep(db),
        new NullsBaseBStep(db),
        new CancelamentoBaseBStep(db),
        new ConciliacaoABStep(db),
    ];
}

export function createConciliacaoPipeline(options?: PipelineFactoryOptions): ConciliacaoPipeline {
    const db: Knex = (options?.db as Knex) ?? (defaultDb as unknown as Knex);
    const logger: PipelineLogger = options?.logger ?? console;

    const steps = buildDefaultSteps(db);
    const pipeline = new ConciliacaoPipeline(steps as PipelineStep[]);

    try {
        const names = pipeline.getStepNames();
        logger.info('[pipeline] ConciliacaoPipeline instantiated', { steps: names });
    } catch (err) {
        logger.warn('[pipeline] created pipeline but failed to read step names', err);
    }

    return pipeline;
}

// Default singleton pipeline used by the rest of the app
export const pipeline = createConciliacaoPipeline();

export default pipeline;
