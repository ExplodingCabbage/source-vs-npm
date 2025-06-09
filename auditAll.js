import downloadCounts from "download-counts" with { type: "json" };

const N_PACKAGES = 5000;

const packages = Object.entries(downloadCounts)
  .filter(([_, count]) => count)
  .sort(([_, countA], [__, countB]) => countB - countA)
  .slice(0, N_PACKAGES);

console.log(packages);
