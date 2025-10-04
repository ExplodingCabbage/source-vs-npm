#!/usr/bin/env node
import process from "node:process";
import { auditPackages } from "../audit/auditPackages.js";
import { auditTop } from "../audit/auditTopN.js";

// TODO: support saving to a local database OR outputting to terminal OR outputting to a HTML file with results baked in
// TODO: support scripts outside the top N; support running ./run-audit.js top200 or whatever
// TODO: support targeting a specific package version
// TODO: support targeting a lockfile
// TODO: should this be multiple scripts?

const whatToAudit = process.argv.slice(2).map((arg) => arg.toLowerCase());

if (whatToAudit.length == 0) {
  console.error("No arguments received");
  console.error("Usage examples:");
  console.error("  ./audit all");
  console.error("  ./audit failing");
  console.error("  ./audit 'build:no tag match'");
  console.error("  ./audit 'mismatch' 'build:unexpected-error'");
  console.error("  ./audit 'mismatch' 'benign-mismatch'");
  console.error("  ./audit lodash");
  console.error("  ./audit diff prettier");
  process.exit(1);
}

if (whatToAudit.length == 1 && /top\d+/.test(whatToAudit[0])) {
  const n = Number(whatToAudit[0].slice(3));
  await auditTop(n);
} else {
  // Assume the arguments are individual package names
  await auditPackages(whatToAudit);
}
