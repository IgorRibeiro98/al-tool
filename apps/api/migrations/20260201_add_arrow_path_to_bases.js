/**
 * Add `arquivo_arrow_path` column to `bases` for Apache Arrow format support.
 * This replaces the previous JSONL format with Arrow IPC for 10-100x faster I/O.
 */
exports.up = async function (knex) {
    await knex.schema.alterTable('bases', (table) => {
        table.string('arquivo_arrow_path').nullable();
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable('bases', (table) => {
        table.dropColumn('arquivo_arrow_path');
    });
};
