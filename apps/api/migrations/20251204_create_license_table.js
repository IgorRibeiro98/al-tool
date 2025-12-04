/* Migration: create license table
 * Creates a single-row `license` table enforced by CHECK (id = 1).
 */
exports.up = async function (knex) {
    // Use a raw CREATE TABLE so we can include the CHECK constraint
    // directly (SQLite does not support ALTER TABLE ADD CONSTRAINT).
    await knex.raw(`
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
  `);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('license');
};
