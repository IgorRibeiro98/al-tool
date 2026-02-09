/**
 * CleanupLightTableStep - Pipeline step that cleans up light tables
 * after pipeline execution is complete.
 * 
 * This step should run at the end of the pipeline to drop any temporary
 * light tables that were created for the job.
 */

import { PipelineStep, PipelineContext } from '../index';
import { LightTableService } from '../../../services/LightTableService';

const LOG_PREFIX = '[CleanupLightTable]';

export class CleanupLightTableStep implements PipelineStep {
    readonly name = 'CleanupLightTable';

    constructor(
        private readonly lightTableService: LightTableService = new LightTableService()
    ) { }

    async execute(ctx: PipelineContext): Promise<void> {
        const startTime = Date.now();

        console.log(`${LOG_PREFIX} Cleaning up light tables for job ${ctx.jobId}`);

        // Drop all light tables associated with this job
        const dropped = await this.lightTableService.dropAllLightTablesForJob(ctx.jobId);

        // Clear context references
        if ((ctx as any).lightTableContabil) {
            delete (ctx as any).lightTableContabil;
        }
        if ((ctx as any).lightTableFiscal) {
            delete (ctx as any).lightTableFiscal;
        }

        const totalTime = Date.now() - startTime;
        console.log(`${LOG_PREFIX} Cleanup completed in ${totalTime}ms (dropped ${dropped} tables)`);
    }
}

export default CleanupLightTableStep;
