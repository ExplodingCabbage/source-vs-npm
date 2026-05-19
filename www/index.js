import express from "express";
import { readFileSync } from "node:fs";
import { latestCompletedRun, getRunResults } from "../audit/database.js";
import { listen } from "./listen.js";

const app = express();
const repoRoot = `${import.meta.dirname}/..`;

// TODO:
// - UI to view past runs
// - UI to filter results by package
// - UI to filter packages and see latest result for each package (potentially different runs for different packages)
// - UI to trigger runs?
app.get("/", async (req, res) => {
  const latestRun = await latestCompletedRun();
  const packageResults = await getRunResults(latestRun.id);

  // Populate the results template and view results
  const resultsHtml = readFileSync(`${repoRoot}/results.template.html`)
    .toString()
    .replace(
      "PLACEHOLDER",
      // Escaping forward slashes, not done by JSON.stringify by default, avoids
      // breaking out of our <script> element if allResults contains the text
      // "</script>" in a string for some reason.
      JSON.stringify(packageResults).replaceAll("/", "\\/"),
    );

  res.send(resultsHtml);
});

// Either listen HTTP or, if this is the prod server, listen on HTTPS and set
// up automatic cert reloading.
listen(app);
