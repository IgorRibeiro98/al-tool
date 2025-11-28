import { ConciliacaoPipeline, NullsBaseAStep, EstornoBaseAStep, NullsBaseBStep, CancelamentoBaseBStep, ConciliacaoABStep } from '@al-tool/pipeline';
import db from '../db/knex';

// create steps in the required order: nulos A, estorno A, nulos B, cancelamento B, then others (if any)
const steps = [
    new NullsBaseAStep(db),
    new EstornoBaseAStep(db),
    new NullsBaseBStep(db),
    new CancelamentoBaseBStep(db),
    new ConciliacaoABStep(db),
];
const pipeline = new ConciliacaoPipeline(steps as any);
console.log('ConciliacaoPipeline instantiated with steps:', pipeline.getStepNames());

export default pipeline;
