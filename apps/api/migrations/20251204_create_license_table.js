/* Migration: create license table
 * Creates a single-row `license` table enforced by CHECK (id = 1).
 */
exports.up = async function up(knex) {
  const sql = `
    CREATE TABLE IF NOT EXISTS license (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      license_key TEXT NOT NULL,
      activation_token TEXT NOT NULL,
      machine_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_success_online_validation_at TEXT NOT NULL,
      next_online_validation_at TEXT NOT NULL,
      last_error TEXT
    );
  `;

  // Keep raw SQL for CHECK constraint; wrap in try/catch to surface clearer errors.
  try {
    await knex.raw(sql);
  } catch (err) {
    // Surface a helpful message to operator while preserving original error
    // Note: migrations framework will already log errors; this clarifies intent.
    throw new Error(`Failed to create license table: ${err.message}`);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('license');
};
