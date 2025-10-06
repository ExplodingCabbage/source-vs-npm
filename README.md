# source-vs-npm

Tools to check that npm package contents match what you get when you build them from source.

## Overview

This repository contains tools that audit npm packages by comparing the published package contents with what you get when building from the source repository. This helps verify package integrity and identify potential discrepancies.

## Key Features

- Audit packages to compare built output vs. published npm packages
- Supports parallel auditing of multiple packages
- Integration with Docker to safely build packages in isolated environments
- Support for monorepo structures and various build patterns
- Track and report on known package mismatches

## Getting Started

### Prerequisites

- Node.js 18+ 
- Docker (for running untrusted build scripts safely)
- TypeScript

### Installation

```bash
npm install
```

### Build

```bash
npm run build
```

### Usage

Audit specific packages:
```bash
npm run audit lodash express
```

Audit top N packages:
```bash
npm run audit top10
```

## TypeScript

This project is written in TypeScript. The TypeScript files are compiled to JavaScript using the `tsc` compiler. The compiled JavaScript files are stored in the `dist` directory.

## Project Structure

- `/audit`: Core auditing functionality
- `/audit/docker`: Docker integration for safe package building
- `/scripts`: Utility scripts for running audits
- `/www`: Web interface files
- `/cache`: Local cache for package information
- `/audits`: Results of package audits

## License

ISC
