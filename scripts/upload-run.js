import process from "node:process";
import { getRemotePool } from "../database/query";
import {
  getRun,
  getRunResults,
  recordPackageAuditResult,
} from "../audit/database";

const whatToUpload = Number(process.argv[2]);
if (whatToUpload.isNaN()) {
  console.error(
    "Pass a single argument with the ID, in the local database, of an audit job to upload.",
  );
  process.exit(1);
}

const run = getRun(whatToUpload);
if (!run.finished_at) {
  throw new Error(`audit job ${whatToUpload} is not finished`);
}
const packages = getRunResults(whatToUpload);
if (!packages.length) {
  throw new Error(`No package data for run ${whatToUpload}`);
}

const remoteDbClient = getRemotePool().connect();
remoteDbClient.query("START");
remoteDbClient.query("INSERT INTO audit_job (started_at, finished_at, args)", [
  run.started_at,
  run.finished_at,
  run.args,
]);
for (const packageData of packages) {
  recordPackageAuditResult(packageData, remoteDbClient.query);
}
remoteDbClient.query("COMMIT");
