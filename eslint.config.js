import js from "@eslint/js";
import { includeIgnoreFile } from "@eslint/compat";
import globals from "globals";
import json from "@eslint/json";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  includeIgnoreFile(
    `${import.meta.dirname}/.gitignore`,
    "Imported .gitignore patterns",
  ),
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    rules: {
      "no-unused-vars": ["error", { destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.json"],
    plugins: { json },
    language: "json/json",
    extends: ["json/recommended"],
  },
  [globalIgnores(["package-lock.json"])],
]);
