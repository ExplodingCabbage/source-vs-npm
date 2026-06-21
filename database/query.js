import { Pool } from "pg";
import secrets from "../secrets.js";
import { PRODUCTION_DOMAIN } from "../config.js";

const DATABASE_NAME = "source_vs_npm";
const PRODUCTION_DB_USER = "ubuntu";

// TODO: This is using peer auth to my local DB. It also only supports one DB
//       (but we need to copy between DBs). Make flexible in due course.
const localPool = new Pool({
  host: "/var/run/postgresql",
  database: DATABASE_NAME,
});

export function localQuery(text, params) {
  return localPool.query(text, params);
}

export function getRemotePool() {
  if (!secrets.PRODUCTION_DB_PASSWORD) {
    throw new Error(
      "To connect remotely to production Postgres database, ensure PRODUCTION_DB_PASSWORD is set in secrets.json",
    );
  }
  return new Pool({
    host: PRODUCTION_DOMAIN,
    database: DATABASE_NAME,
    user: PRODUCTION_DB_USER,
    password: secrets.PRODUCTION_DB_PASSWORD,
  });
}
