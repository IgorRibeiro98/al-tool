/**
 * Knex configuration for SQLite (development)
 * Ensures the `db` directory exists before returning the config so better-sqlite3 can create/open the file.
 */
const fs = require('fs');
const path = require('path');

const dbDir = path.resolve(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

module.exports = {
    development: {
        client: 'better-sqlite3',
        connection: {
            filename: path.join(dbDir, 'dev.sqlite3')
        },
        useNullAsDefault: true,
        migrations: {
            // project keeps migrations under src/migrations — point knex there
            directory: path.resolve(__dirname, './migrations')
        }
    }
};
