import express from "express";
import { latestCompletedRun, getRunResults } from "../audit/database.js";
import { readFileSync } from "node:fs";

const app = express();
const port = 3000;
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

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
