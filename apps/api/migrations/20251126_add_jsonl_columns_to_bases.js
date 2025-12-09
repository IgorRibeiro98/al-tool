/**
 * Add `arquivo_jsonl_path` and conversion metadata columns to `bases`.
 */
exports.up = async function up(knex) {
    const exists = await knex.schema.hasTable('bases');
    if (!exists) return;

    await knex.schema.table('bases', (table) => {
        table.string('arquivo_jsonl_path').nullable();
        table.string('conversion_status').nullable(); // PENDING, READY, FAILED
        table.timestamp('conversion_started_at').nullable();
        table.timestamp('conversion_finished_at').nullable();
        table.text('conversion_error').nullable();
    });
};

exports.down = async function down(knex) {
    const exists = await knex.schema.hasTable('bases');
    if (!exists) return;

    await knex.schema.table('bases', (table) => {
        table.dropColumn('arquivo_jsonl_path');
        table.dropColumn('conversion_status');
        table.dropColumn('conversion_started_at');
        table.dropColumn('conversion_finished_at');
        table.dropColumn('conversion_error');
    });
};
