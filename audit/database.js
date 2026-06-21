import { localQuery } from "../database/query.js";

/**
 * Records to the database that a audit job just started, and returns a pair of
 * functions, respectively for recording a single package's results and for
 * recording that the whole job is finished.
 */
export async function recordJobStart(jobArgs, query = localQuery) {
  const pgResult = await query(
    `INSERT INTO audit_job (started_at, args)
     VALUES (NOW(), $1)
     RETURNING id`,
    [jobArgs],
  );
  const jobId = pgResult.rows[0].id;

  async function recordPackageAuditResult(resultJson) {
    return recordPackageAudit(jobId, resultJson, query);
  }

  async function recordJobEnd() {
    await query(
      `UPDATE audit_job
       SET finished_at = NOW()
       WHERE id = $1`,
      [jobId],
    );
  }
  return [recordPackageAuditResult, recordJobEnd];
}

/**
 * Takes an object, `resultJson`, of the type returned by `auditPackage`,
 * and records the result to the database.
 */
export async function recordPackageAudit(
  jobId,
  resultJson,
  query = localQuery,
) {
  await query(
    `INSERT INTO package_audit
     (audit_run_id, package_name, package_version, results)
     VALUES ($1, $2, $3, $4)`,
    [jobId, resultJson.packageName, resultJson.packageVersion, resultJson],
  );
}

/**
 * Return details of the most-recently-completed audit run.
 */
// TODO: This returns an object with col names as keys.
//       Remove note of this fact when we migrate to typescript
//       Also share return type with getRun
export async function latestCompletedRun(query = localQuery) {
  const pgResult = await query(
    `SELECT id, started_at, finished_at, args
    FROM audit_job
    WHERE finished_at IS NOT NULL
    ORDER BY finished_at DESC
    LIMIT 1`,
  );
  return pgResult.rows[0];
}

export async function getRun(runId, query = localQuery) {
  const pgResult = await query(
    `SELECT id, started_at, finished_at, args
    FROM audit_job
    WHERE id = $1`,
    [runId],
  );
  if (!pgResult.rowCount) {
    throw new Error(`No run found with id ${runId}`);
  }
  return pgResult.rows[0];
}

/**
 * Get all the per-package result data associated with a given audit run ID.
 */
export async function getRunResults(runId, query = localQuery) {
  const pgResult = await query(
    `SELECT results
    FROM package_audit
    WHERE audit_run_id = $1`,
    [runId],
  );
  return pgResult.rows.map((row) => row.results);
}
