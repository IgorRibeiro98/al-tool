/**
 * Add arquivo_jsonl_path and conversion_status to bases
 */
exports.up = function (knex) {
    return knex.schema.table('bases', function (table) {
        table.string('arquivo_jsonl_path').nullable();
        table.string('conversion_status').nullable(); // PENDING, READY, FAILED
        table.timestamp('conversion_started_at').nullable();
        table.timestamp('conversion_finished_at').nullable();
        table.text('conversion_error').nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.table('bases', function (table) {
        table.dropColumn('arquivo_jsonl_path');
        table.dropColumn('conversion_status');
        table.dropColumn('conversion_started_at');
        table.dropColumn('conversion_finished_at');
        table.dropColumn('conversion_error');
    });
};
