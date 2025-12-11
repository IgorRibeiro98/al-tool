exports.up = async function(knex) {
  // remove 'tipo' column from base_subtypes
  const has = await knex.schema.hasColumn('base_subtypes', 'tipo');
  if (!has) return;

  // SQLite doesn't support dropColumn; recreate table without 'tipo'
  const client = (knex.client && knex.client.config && knex.client.config.client) || '';
  if (client === 'sqlite3') {
    await knex.transaction(async (trx) => {
      await trx.schema.createTable('base_subtypes_new', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });

      // copy data (ignore tipo)
      const rows = await trx.select('id', 'name', 'created_at').from('base_subtypes');
      for (const r of rows) {
        await trx('base_subtypes_new').insert({ id: r.id, name: r.name, created_at: r.created_at });
      }

      await trx.schema.dropTable('base_subtypes');
      await trx.schema.renameTable('base_subtypes_new', 'base_subtypes');
    });
  } else {
    // for other DBs that support dropping column
    await knex.schema.alterTable('base_subtypes', (t) => {
      t.dropColumn('tipo');
    });
  }
};

exports.down = async function(knex) {
  // re-add 'tipo' column as notNullable with default empty string and backfill ''
  const has = await knex.schema.hasColumn('base_subtypes', 'tipo');
  if (has) return;

  const client = (knex.client && knex.client.config && knex.client.config.client) || '';
  if (client === 'sqlite3') {
    await knex.transaction(async (trx) => {
      await trx.schema.createTable('base_subtypes_old', (t) => {
        t.increments('id').primary();
        t.string('tipo').notNullable().defaultTo('');
        t.string('name').notNullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });

      const rows = await trx.select('id', 'name', 'created_at').from('base_subtypes');
      for (const r of rows) {
        await trx('base_subtypes_old').insert({ id: r.id, tipo: '', name: r.name, created_at: r.created_at });
      }

      await trx.schema.dropTable('base_subtypes');
      await trx.schema.renameTable('base_subtypes_old', 'base_subtypes');
    });
  } else {
    await knex.schema.alterTable('base_subtypes', (t) => {
      t.string('tipo').notNullable().defaultTo('');
    });
    // backfill
    await knex('base_subtypes').update({ tipo: '' });
  }
};
