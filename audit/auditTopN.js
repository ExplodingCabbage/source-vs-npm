import { auditPackages } from "./auditPackages.js";
import { topPackages } from "./topPackages.js";

export async function auditTop(n) {
  await auditPackages(topPackages(n));
}
