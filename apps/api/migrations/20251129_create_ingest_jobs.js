/**
 * Create ingest_jobs table
 */
exports.up = async function (knex) {
    const exists = await knex.schema.hasTable('ingest_jobs');
    if (!exists) {
        await knex.schema.createTable('ingest_jobs', (t) => {
            t.increments('id').primary();
            t.integer('base_id').notNullable();
            t.string('status').notNullable().defaultTo('PENDING');
            t.text('erro').nullable();
            t.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
            t.timestamp('updated_at').nullable();
        });
        await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_ingest_jobs_base_status ON ingest_jobs (base_id, status)');
    }
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('ingest_jobs');
};
