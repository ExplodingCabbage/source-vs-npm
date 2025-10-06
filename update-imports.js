#!/usr/bin/env node

/**
 * This script finds all TypeScript files in the project and updates their import statements
 * to use .js extensions, which is necessary for ES modules when the code is compiled to JavaScript.
 *
 * ESM requires explicit file extensions in imports, but TypeScript doesn't want them in source files.
 * This script adds the extensions after compilation.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const glob = promisify(require('glob'));

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Regular expression to match relative imports without file extensions
const importRegex = /from\s+['"]([^'"]+)['"]/g;

/**
 * Add .js extension to import statements that don't already have extensions
 */
function addJsExtension(content) {
  return content.replace(importRegex, (match, importPath) => {
    // Skip if it's not a relative import or already has an extension
    if (!importPath.startsWith('.') || path.extname(importPath) !== '') {
      return match;
    }
    return `from '${importPath}.js'`;
  });
}

/**
 * Process all TypeScript files in the project
 */
async function processFiles() {
  try {
    // Get all TypeScript files
    const files = await glob('source-vs-npm/**/*.ts');

    console.log(`Found ${files.length} TypeScript files to process`);

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      const updatedContent = addJsExtension(content);

      if (content !== updatedContent) {
        await writeFile(file, updatedContent);
        console.log(`Updated imports in ${file}`);
      }
    }

    console.log('Import paths updated successfully');
  } catch (error) {
    console.error('Error updating import paths:', error);
    process.exit(1);
  }
}

processFiles();
