import { Pool } from "pg";

// TODO: This is using peer auth to my local DB. It also only supports one DB
//       (but we need to copy between DBs). Make flexible in due course.
const pool = new Pool({
  host: "/var/run/postgresql",
  database: "source_vs_npm",
});

export const query = (text, params) => {
  return pool.query(text, params);
};
