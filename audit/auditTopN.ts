import { auditPackages } from "./auditPackages.js";
import { topPackages } from "./topPackages.js";

export async function auditTop(n: number): Promise<void> {
  await auditPackages(topPackages(n));
}
