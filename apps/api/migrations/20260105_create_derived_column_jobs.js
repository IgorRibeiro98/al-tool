/**
 * Migration: Create derived_column_jobs table
 * Jobs for creating derived columns in background (ABS, INVERTER, etc.)
 */

exports.up = async function (knex) {
    const exists = await knex.schema.hasTable('derived_column_jobs');
    if (exists) return;

    await knex.schema.createTable('derived_column_jobs', (table) => {
        table.increments('id').primary();
        table.integer('base_id').notNullable().references('id').inTable('bases').onDelete('CASCADE');
        table.string('source_column').notNullable();
        table.string('target_column').nullable();
        table.string('operation').notNullable(); // ABS, INVERTER, etc.
        table.string('status').notNullable().defaultTo('PENDING'); // PENDING, RUNNING, DONE, FAILED
        table.integer('total_rows').nullable();
        table.integer('processed_rows').defaultTo(0);
        table.integer('progress').defaultTo(0); // 0-100
        table.text('error').nullable();
        table.timestamp('started_at').nullable();
        table.timestamp('completed_at').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    });

    // Index for faster lookups
    await knex.schema.alterTable('derived_column_jobs', (table) => {
        table.index(['base_id', 'status']);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('derived_column_jobs');
};
