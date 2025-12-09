/**
 * Create `ingest_jobs` table and an index for common queries.
 */
const { addTimestamps } = require('./helpers/migrationHelpers');

exports.up = async function up(knex) {
    const exists = await knex.schema.hasTable('ingest_jobs');
    if (exists) return;

    await knex.schema.createTable('ingest_jobs', (table) => {
        table.increments('id').primary();
        table.integer('base_id').notNullable();
        table.string('status').notNullable().defaultTo('PENDING');
        table.text('erro').nullable();
        addTimestamps(table, knex);
    });

    await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_ingest_jobs_base_status ON ingest_jobs (base_id, status)');
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists('ingest_jobs');
};
