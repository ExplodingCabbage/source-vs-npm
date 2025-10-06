import js from "@eslint/js";
import { includeIgnoreFile } from "@eslint/compat";
import globals from "globals";
import json from "@eslint/json";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default defineConfig([
  includeIgnoreFile(
    `${import.meta.dirname}/.gitignore`,
    "Imported .gitignore patterns",
  ),
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    plugins: { js },
    extends: ["js/recommended"],
    rules: {
      "no-unused-vars": ["error", { destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.ts"],
    plugins: { "@typescript-eslint": tseslint },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    extends: ["js/recommended", "plugin:@typescript-eslint/recommended"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
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
