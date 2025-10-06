import { auditPackages } from "./auditPackages.js";
import { topPackages } from "./topPackages.js";

export async function auditTop(n) {
  return await auditPackages(topPackages(n));
}
