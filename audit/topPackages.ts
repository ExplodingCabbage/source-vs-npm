/**
 * Utils that sort the packages from downloadCounts by count, take the top n,
 * and cache the list in a file where it can be instantly reread later.
 */

// TODO: autoupdate download-counts at runtime

import { readFileSync, writeFileSync } from "fs";
import dcPkgJson from "download-counts/package.json" with { type: "json" };

const dcVersion = dcPkgJson.version;
// Using path resolution workaround for import.meta.dirname
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

type DownloadCountEntry = [string, number];

export function sortedPackages(): DownloadCountEntry[] {
  const cacheLocation = `${repoRoot}/cache/packageList/${dcVersion}-all.json`;
  try {
    return JSON.parse(readFileSync(cacheLocation).toString());
  } catch {
    const allDcs: Record<string, number> = JSON.parse(
      readFileSync(
        `${repoRoot}/node_modules/download-counts/counts.json`,
      ).toString(),
    );
    const sortedDcs: DownloadCountEntry[] = Object.entries(allDcs).sort(
      ([_, countA], [__, countB]) => countB - countA,
    );
    writeFileSync(cacheLocation, JSON.stringify(sortedDcs));
    return sortedDcs;
  }
}

export function topPackages(n: number): string[] {
  const cacheLocation = `${repoRoot}/cache/packageList/${dcVersion}-top${n}.json`;
  try {
    return JSON.parse(readFileSync(cacheLocation).toString());
  } catch {
    const sortedDcs = sortedPackages();
    const result = sortedDcs.slice(0, n).map(([name]) => name);
    writeFileSync(cacheLocation, JSON.stringify(result));
    return result;
  }
}
