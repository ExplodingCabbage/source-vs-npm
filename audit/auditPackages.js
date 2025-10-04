import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { isNaughty, auditPackage } from "./auditPackage.js";

const repoRoot = `${import.meta.dirname}/..`;

/**
 * Audit multiple packages in parallel. Should be called once per script, with
 * a full list of packages to audit.
 */
export async function auditPackages(packageNames) {
  packageNames = packageNames.filter((name) => !isNaughty(name));
  const MAX_SIMULTANEOUS_AUDITS = 5; // TODO: 10?
  const packageNamesQueue = [...packageNames].reverse();
  async function doAuditsUntilFinished() {
    while (packageNamesQueue.length > 0) {
      const packageName = packageNamesQueue.pop();
      console.log(
        `Auditing ${packageName}. ${packageNamesQueue.length} package audits still to start.`,
      );
      await auditPackage(packageName);
    }
  }
  const workers = [];
  for (let i = 0; i < MAX_SIMULTANEOUS_AUDITS; i++) {
    workers.push(doAuditsUntilFinished());
  }
  await Promise.all(workers);

  // TODO: Return something instead of writing to disk here. Move the write
  //       logic elsewhere.
  // Combine all results into a single result file:
  const allResults = packageNames.map((packageName) =>
    JSON.parse(
      readFileSync(`${repoRoot}/audits/${packageName}/results.json`).toString(),
    ),
  );
  writeFileSync(`${repoRoot}/allResults.json`, JSON.stringify(allResults));

  // Populate the results template and view results
  const resultsHtml = readFileSync(`${repoRoot}/results.template.html`)
    .toString()
    .replace(
      "PLACEHOLDER",
      // Escaping forward slashes, not done by JSON.stringify by default, avoids
      // breaking out of our <script> element if allResults contains the text
      // "</script>" in a string for some reason.
      JSON.stringify(allResults).replaceAll("/", "\\/"),
    );
  writeFileSync(`${repoRoot}/results.html`, resultsHtml);
  execFile("open", ["results.html"]);
}
