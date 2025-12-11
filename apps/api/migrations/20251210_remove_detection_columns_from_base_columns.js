/* eslint-disable camelcase */
exports.up = async function (knex) {
  const has = await knex.schema.hasTable('base_columns');
  if (!has) return;
  await knex.schema.alterTable('base_columns', (t) => {
    const p = Promise.resolve();
    // drop if they exist; knex doesn't provide conditional dropColumn across all adapters, so guard
    try { t.dropColumn('detection_confidence'); } catch (e) { /* ignore */ }
    try { t.dropColumn('detected_by'); } catch (e) { /* ignore */ }
    try { t.dropColumn('detected_at'); } catch (e) { /* ignore */ }
  });
};

exports.down = async function (knex) {
  const has = await knex.schema.hasTable('base_columns');
  if (!has) return;
  await knex.schema.alterTable('base_columns', (t) => {
    t.float('detection_confidence').nullable();
    t.string('detected_by').nullable();
    t.timestamp('detected_at').nullable();
  });
};
