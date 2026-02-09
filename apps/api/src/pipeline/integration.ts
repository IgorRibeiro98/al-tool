import {
    ConciliacaoPipeline,
    PipelineStep,
    NullsBaseAStep,
    EstornoBaseAStep,
    NullsBaseBStep,
    CancelamentoBaseBStep,
    ConciliacaoABStep,
    CreateLightTableStep,
    CleanupLightTableStep,
} from './core';
import defaultDb from '../db/knex';
import type { Knex } from 'knex';

type PipelineLogger = Pick<Console, 'info' | 'warn' | 'error'>;

// Feature flag to enable/disable light tables optimization
const USE_LIGHT_TABLES = process.env.USE_LIGHT_TABLES !== 'false';

export type PipelineFactoryOptions = {
    db?: Knex;
    logger?: PipelineLogger;
    useLightTables?: boolean;
};

function buildDefaultSteps(db: Knex, useLightTables: boolean): PipelineStep[] {
    const steps: PipelineStep[] = [];

    // NullsBaseA/B modify the original tables (UPDATE), must run before light table creation
    steps.push(new NullsBaseAStep(db));
    steps.push(new EstornoBaseAStep(db));
    steps.push(new NullsBaseBStep(db));
    steps.push(new CancelamentoBaseBStep(db));

    // Create light tables for optimized conciliation (after Nulls steps normalize data)
    if (useLightTables) {
        steps.push(new CreateLightTableStep(db));
    }

    // Main conciliation step - uses light tables if available
    steps.push(new ConciliacaoABStep(db));

    // Cleanup light tables at the end (optional, but saves disk space)
    if (useLightTables) {
        steps.push(new CleanupLightTableStep());
    }

    return steps;
}

export function createConciliacaoPipeline(options?: PipelineFactoryOptions): ConciliacaoPipeline {
    const db: Knex = (options?.db as Knex) ?? (defaultDb as unknown as Knex);
    const logger: PipelineLogger = options?.logger ?? console;
    const useLightTables = options?.useLightTables ?? USE_LIGHT_TABLES;

    const steps = buildDefaultSteps(db, useLightTables);
    const pipeline = new ConciliacaoPipeline(steps as PipelineStep[]);

    try {
        const names = pipeline.getStepNames();
        logger.info('[pipeline] ConciliacaoPipeline instantiated', { steps: names, useLightTables });
    } catch (err) {
        logger.warn('[pipeline] created pipeline but failed to read step names', err);
    }

    return pipeline;
}

// Default singleton pipeline used by the rest of the app
export const pipeline = createConciliacaoPipeline();

export default pipeline;
