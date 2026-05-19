import { existsSync, readFileSync } from "node:fs";

const repoRoot = `${import.meta.dirname}`;
const secretsJsonPath = `${repoRoot}/secrets.json`;
let secrets = {};
if (existsSync(secretsJsonPath)) {
  secrets = JSON.parse(readFileSync(secretsJsonPath));
}

export default secrets;
