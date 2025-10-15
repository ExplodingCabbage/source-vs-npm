import { query } from "../database/query.js";

/**
 * Records to the database that a audit job just started, and returns a pair of
 * functions, respectively for recording a single package's results and for
 * recording that the whole job is finished.
 */
export async function recordJobStart(jobArgs) {
  const queryResult = await query(
    `INSERT INTO audit_job (started_at, args)
     VALUES (NOW(), $1)
     RETURNING id`,
    [jobArgs],
  );
  const jobId = queryResult.rows[0].id;

  /**
   * Takes an object, `resultJson`, of the type returned by `auditPackage`,
   * and records the result to the database.
   */
  async function recordPackageAuditResult(resultJson) {
    await query(
      `INSERT INTO package_audit
       (audit_run_id, package_name, package_version, results)
       VALUES ($1, $2, $3, $4)`,
      [jobId, resultJson.packageName, resultJson.packageVersion, resultJson],
    );
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
