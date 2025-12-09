/**
 * Migration helpers to keep migration files small and consistent.
 * Keep helpers minimal and pure to avoid side-effects during migration runs.
 */
module.exports = {
  addTimestamps(table, knex) {
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
  },

  addCreatedAt(table, knex) {
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
  }
};
