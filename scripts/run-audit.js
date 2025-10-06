#!/usr/bin/env node
import process from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { auditPackages } from "../audit/auditPackages.js";
import { auditTop } from "../audit/auditTopN.js";

const repoRoot = `${import.meta.dirname}/..`;

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

let results = [];
if (whatToAudit.length == 1 && /top\d+/.test(whatToAudit[0])) {
  const n = Number(whatToAudit[0].slice(3));
  results = await auditTop(n);
} else {
  // Assume the arguments are individual package names
  results = await auditPackages(whatToAudit);
}

// Populate the results template and view results
const resultsHtml = readFileSync(`${repoRoot}/results.template.html`)
  .toString()
  .replace(
    "PLACEHOLDER",
    // Escaping forward slashes, not done by JSON.stringify by default, avoids
    // breaking out of our <script> element if allResults contains the text
    // "</script>" in a string for some reason.
    JSON.stringify(results).replaceAll("/", "\\/"),
  );
writeFileSync(`${repoRoot}/results.html`, resultsHtml);
execFile("open", ["results.html"]);
