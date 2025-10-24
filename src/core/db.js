const Database = require("better-sqlite3");
require("dotenv").config();

const dbPath = process.env.DB_PATH || "./central.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

module.exports = { db };
