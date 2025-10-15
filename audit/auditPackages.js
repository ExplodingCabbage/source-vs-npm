import { isNaughty, auditPackage } from "./auditPackage.js";

/**
 * Audit multiple packages in parallel. Should be called once per script, with
 * a full list of packages to audit.
 */
// TODO: Make this an async generator
export async function auditPackages(packageNames) {
  packageNames = packageNames.filter((name) => !isNaughty(name));
  const MAX_SIMULTANEOUS_AUDITS = 5; // TODO: 10?
  const packageNamesQueue = [...packageNames].reverse();
  const nameToResult = {};
  async function doAuditsUntilFinished() {
    while (packageNamesQueue.length > 0) {
      const packageName = packageNamesQueue.pop();
      console.log(
        `Auditing ${packageName}. ${packageNamesQueue.length} package audits still to start.`,
      );
      nameToResult[packageName] = await auditPackage(packageName);
    }
  }
  const workers = [];
  for (let i = 0; i < MAX_SIMULTANEOUS_AUDITS; i++) {
    workers.push(doAuditsUntilFinished());
  }
  await Promise.all(workers);

  // Combine all results into a list:
  return packageNames.map((packageName) => nameToResult[packageName]);
}
