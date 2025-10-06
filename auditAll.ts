import process from "process";
import { auditPackages } from "./audit/auditPackages.js";
import { auditTop } from "./audit/auditTopN.js";

/**
 * Main entry point for the source-vs-npm tool.
 *
 * This file processes command line arguments and runs the appropriate audit functions.
 */
async function main() {
  const whatToAudit: string[] = process.argv
    .slice(2)
    .map((arg) => arg.toLowerCase());

  if (whatToAudit.length === 0) {
    console.error("No arguments received");
    console.error("Usage examples:");
    console.error("  npm start all");
    console.error("  npm start failing");
    console.error("  npm start 'build:no tag match'");
    console.error("  npm start 'mismatch' 'build:unexpected-error'");
    console.error("  npm start 'mismatch' 'benign-mismatch'");
    console.error("  npm start lodash");
    console.error("  npm start diff prettier");
    console.error("  npm start top10");
    process.exit(1);
  }

  try {
    if (whatToAudit.length === 1 && /top\d+/.test(whatToAudit[0])) {
      const n: number = Number(whatToAudit[0].slice(3));
      await auditTop(n);
      console.log(`Successfully audited top ${n} packages.`);
    } else {
      // Assume the arguments are individual package names
      await auditPackages(whatToAudit);
      console.log(`Successfully audited ${whatToAudit.length} packages.`);
    }
  } catch (error) {
    console.error("Error running audit:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
