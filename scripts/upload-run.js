import process from "node:process";
import { getRemotePool } from "../database/query.js";
import {
  getRun,
  getRunResults,
  recordPackageAudit,
} from "../audit/database.js";

const whatToUpload = Number(process.argv[2]);
if (Number.isNaN(whatToUpload)) {
  console.error(
    "Pass a single argument with the ID, in the local database, of an audit job to upload.",
  );
  process.exit(1);
}

const run = await getRun(whatToUpload);
if (!run.finished_at) {
  throw new Error(`audit job ${whatToUpload} is not finished`);
}
const packages = await getRunResults(whatToUpload);
if (!packages.length) {
  throw new Error(`No package data for run ${whatToUpload}`);
}

const remoteDbClient = await getRemotePool().connect();
try {
  await remoteDbClient.query("BEGIN");
  const pgResult = await remoteDbClient.query(
    `INSERT INTO audit_job (started_at, finished_at, args)
    VALUES ($1, $2, $3)
    RETURNING id`,
    [run.started_at, run.finished_at, run.args],
  );
  const jobId = pgResult.rows[0].id;
  let i = 0;
  for (const packageData of packages) {
    await recordPackageAudit(
      jobId,
      packageData,
      remoteDbClient.query.bind(remoteDbClient),
    );
  }
  await remoteDbClient.query("COMMIT");
} catch (e) {
  await remoteDbClient.query("ROLLBACK");
  throw e;
} finally {
  remoteDbClient.release();
}
