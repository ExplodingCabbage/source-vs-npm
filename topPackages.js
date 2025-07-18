/**
 * Utils that sort the packages from downloadCounts by count, take the top n,
 * and cache the list in a file where it can be instantly reread later.
 */

import { readFileSync, writeFileSync } from "node:fs";
import dcPkgJson from "download-counts/package.json" with { type: "json" };

const dcVersion = dcPkgJson.version;

export function sortedPackages() {
  const cacheLocation = `${import.meta.dirname}/cache/packageList/${dcVersion}-all.json`;
  try {
    return JSON.parse(readFileSync(cacheLocation).toString());
  } catch {
    const allDcs = JSON.parse(
      readFileSync(
        `${import.meta.dirname}/node_modules/download-counts/counts.json`,
      ),
    );
    const sortedDcs = Object.entries(allDcs).sort(
      ([_, countA], [__, countB]) => countB - countA,
    );
    writeFileSync(cacheLocation, JSON.stringify(sortedDcs));
    return sortedDcs;
  }
}

export function topPackages(n) {
  const cacheLocation = `${import.meta.dirname}/cache/packageList/${dcVersion}-top${n}.json`;
  try {
    return JSON.parse(readFileSync(cacheLocation).toString());
  } catch {
    const sortedDcs = sortedPackages();
    const result = sortedDcs.slice(0, n).map(([name, _count]) => name);
    writeFileSync(cacheLocation, JSON.stringify(result));
    return result;
  }
}
