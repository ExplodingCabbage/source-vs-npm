#!/usr/bin/env node

import process from "node:process";
import { promisify } from "node:util";
import { exec, execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import knownMismatches from "./knownMismatches.js";
import { parsePatch } from "diff";
import { topPackages } from "./topPackages.js";

const whatToAudit = process.argv.slice(2).map((arg) => arg.toLowerCase());

if (whatToAudit.length == 0) {
  console.error("No arguments received");
  console.error("Usage examples:");
  console.error("  ./audit all");
  console.error("  ./audit failing");
  console.error("  ./audit 'build:no tag match'");
  console.error("  ./audit 'mismatch' 'build:unexpected-error'");
  console.error("  ./audit 'mismatch' 'benign-mismatch'");
  console.error("  ./audit lodash");
  console.error("  ./audit diff prettier");
  process.exit(1);
}

// TODO: 5000
const N_PACKAGES = 1000;

const packageNames = topPackages(N_PACKAGES);

// Assert there are no naughty package names we can't use as directory paths:
for (const packageName of packageNames) {
  if (
    packageName.split("/").includes(".") ||
    packageName.split("/").includes("..")
  ) {
    throw `unexpected naughty package name in top ${N_PACKAGES}: ${packageName}`;
  }
}

async function run(...command) {
  return await promisify(execFile)(command[0], command.slice(1));
}

/**
 * Run the given command as a shell command, redirecting stderr to stdout so
 * that output will be interleaved.
 */
async function runShell(...command) {
  return await promisify(exec)(command.map(escapeShellArg).join(" ") + " 2>&1");
}

// Nicked from https://stackoverflow.com/a/22827128/1709587
function escapeShellArg(arg) {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

// Before we begin, make sure we have an up-to-date version of the Docker image
// we use for running untrusted build scripts in
const dockerDir = `${import.meta.dirname}/docker`;
const imageId = (
  await run("sudo", "docker", "build", "--quiet", dockerDir)
).stdout.trim();

/**
 * category: short (e.g. 1 or 2 word) summary used to categorise the error in
 *           the final table of audits.
 * error: either a caught error object (which will be logged with stack trace)
 *        or a string (which will just be logged).
 */
class JobFailed extends Error {
  constructor(category, msgOrError) {
    super();
    this.category = category;
    if (msgOrError instanceof Error) {
      this.msg = `Caused by ${msgOrError.__proto__.name}: ${msgOrError.message}`;
      if (msgOrError.stack) {
        this.msg += "\n" + msgOrError.stack;
      }
    } else {
      this.msg = msgOrError;
    }
  }
}

async function auditPackage(packageName) {
  // Create (if not exists) a folder for results/logs/diffs about this package:
  const packageDir = `${import.meta.dirname}/audits/${packageName}`;
  await mkdir(packageDir, { recursive: true });

  async function shouldSkip() {
    if (whatToAudit.includes("all")) {
      return false;
    }
    if (whatToAudit.includes(packageName.toLowerCase())) {
      return false;
    }
    const oldResultJson = JSON.parse(
      (await readFile(`${packageDir}/results.json`)).toString(),
    );
    if (
      !oldResultJson.contentMatches &&
      !oldResultJson.isKnownBenignMismatch &&
      whatToAudit.includes("failing")
    ) {
      return false;
    }
    if (
      oldResultJson.contentMatches === false &&
      whatToAudit.includes("benign-mismatch")
    ) {
      return false;
    }
    if (
      oldResultJson.contentMatches === false &&
      !oldResultJson.isKnownBenignMismatch &&
      whatToAudit.includes("mismatch")
    ) {
      return false;
    }
    if (whatToAudit.includes(oldResultJson.errorCategory?.toLowerCase())) {
      return false;
    }
    return true;
  }

  if (await shouldSkip()) {
    console.log(
      `Skipping ${packageName}. ${packageNamesQueue.length} left after this.`,
    );
    return;
  }

  console.log(
    `Auditing ${packageName}. ${packageNamesQueue.length} left after this.`,
  );

  // A summary of this run we will write to `packageDir`:
  const resultJson = {
    packageName: packageName,
    startTime: new Date().toISOString(),
  };

  // Create a log file. Timestamp in name avoids overwriting old ones.
  const logStream = createWriteStream(
    `${packageDir}/${resultJson.startTime}.log`,
  );
  let drainPromiseResolver;
  logStream.on("drain", () => {
    if (drainPromiseResolver) drainPromiseResolver();
  });

  async function writeStringToLog(string) {
    if (!logStream.write(string)) {
      const drainPromise = new Promise((resolve, _) => {
        drainPromiseResolver = resolve;
      });
      await drainPromise;
    }
  }

  // Create functions for logging and for writing final audit results:
  async function log(...msg) {
    msg.reverse();
    while (msg.length) {
      await writeStringToLog(msg.pop().toString());
      await writeStringToLog(msg.length > 0 ? " " : "\n");
    }
  }

  // Now that we've got logging set up, everything else happens in a massive
  // try/catch/finally block that logs any failures.
  try {
    // Hit the npm registry to fetch data we need about the package:
    let registryRespJson;
    try {
      // We only care about the latest version, but cannot use the endpoint to
      // fetch just that version because that endpoint doesn't return the
      // publication date, which we need. So we have to fetch all the data
      // about the package!
      const resp = await fetch(`https://registry.npmjs.org/${packageName}`);
      registryRespJson = await resp.json();
    } catch (e) {
      throw new JobFailed("reg fetch failed", e);
    }

    const version = registryRespJson["dist-tags"].latest;
    resultJson.version = version;

    if (
      packageName in knownMismatches &&
      knownMismatches[packageName].includes(version)
    ) {
      resultJson.contentMatches = false;
      resultJson.isKnownBenignMismatch = true;
      return;
    }

    const publishedAt = registryRespJson.time[version];

    const tarballUrl = registryRespJson.versions[version].dist.tarball;
    if (!tarballUrl.endsWith(".tgz")) {
      throw "Unexpected tarball URL format. Value was: " + tarballUrl;
    }
    if (!registryRespJson.repository) {
      throw new JobFailed(
        "no repository",
        "repository field in registry was null",
      );
    }
    if (
      registryRespJson.repository.type != "git" &&
      registryRespJson.repository.type // Assume Git if not specified
    ) {
      throw new JobFailed(
        "not git",
        `repository.type was ${registryRespJson.repository.type}`,
      );
    }

    // The "repository" field returned from the npm API is always EITHER just a
    // string OR an object with a URL field which is a string that has a `git+`
    // prefix, e.g.
    //
    // "repository":	"https://github.com/nodelib/nodelib/tree/master/packages/fs/fs.stat"
    //
    // {
    //   "repository": {
    //     "type": "git",
    //     "url": "git+https://github.com/npm/cli.git"
    //   }
    // }
    //
    // We need to remove this git+" prefix before we can actually use the
    // URL. No idea why the prefix is there at all; it's redundant given the
    // "type" field and contradicts the explicit statement in the docs at
    // https://docs.npmjs.com/cli/v11/configuring-npm/package-json that:
    //
    // > The URL should be a ... URL that can be handed directly to a VCS
    // > program without any modification
    //
    // Dumb, but it is what it is.
    let repoUrl =
      registryRespJson.repository.url || registryRespJson.repository;
    repoUrl = repoUrl.replace(/^git\+/, "");
    // The next complication is that most repos are hosted on GitHub and lots
    // of package.json files still refer to the repo using the git:// protocol
    // that GitHub dropped support for in 2022 (see discussion at
    // https://github.com/kpdecker/jsdiff/pull/622 where I fixed this for
    // jsdiff). So we need to correct those to a usable protocol:
    repoUrl = repoUrl.replace(/^git:\/\//, "https://");

    // GitHub repos can also be referenced either with SSH URLs or HTTPS URLs.
    // To avoid needing any SSH creds, we convert the former into the latter:
    repoUrl = repoUrl.replace(
      /^ssh:\/\/git@github.com\//,
      "https://github.com/",
    );

    // Create (if not exists) a folder to audit this version in:
    const versionDir = `${packageDir}/${version}`;
    await mkdir(versionDir, { recursive: true });
    // The version published to npm:
    const publishedDir = `${versionDir}/published`;
    await mkdir(publishedDir, { recursive: true });
    // The result of running the build ourselves (SHOULD match /published)
    const buildDir = `${versionDir}/build`;
    // We clear away any existing content here before proceeding so the
    // container can do a fresh build untainted by previous attempts:
    await rm(buildDir, { recursive: true, force: true });
    await mkdir(buildDir, { recursive: true });

    // TODO: Spec says to check for an existing build here and skip if there is
    //       one. Is that actually reasonable? Probably we should just check if
    //       the package has passed the audit (earlier); if so, skip everything,
    //       if not, do everything.

    // We need to clone the source and try to build it... but that entails
    // running arbitrary untrusted code, so we do it inside a Docker container,
    // created from the image we built earlier.
    // We "bind mount" an empty folder on the host to the container for the
    // container to write results to:
    await log("Running build inside Docker. Output:");
    const output = (
      await runShell(
        "sudo",
        "docker",
        "run",
        "--rm",
        "--mount",
        `type=bind,src=${buildDir},dst=/home/node/build`,
        imageId,
        packageName,
        repoUrl,
        version,
        publishedAt,
      )
    ).stdout;
    await log(output);

    const errorJsonPath = `${buildDir}/error.json`;
    if (existsSync(errorJsonPath)) {
      const buildErrorCode = JSON.parse(
        await readFile(errorJsonPath),
      ).errorCode;
      throw new JobFailed(
        `build:${buildErrorCode}`,
        `Build failed and reported error code ${buildErrorCode}`,
      );
    }

    // If the build script didn't output an error, it will have output a
    // tarball containing the packed files (and this will be the only thing in
    // the build dir):
    const buildDirContents = await readdir(buildDir);
    if (buildDirContents.length != 1) {
      throw "unexpected /build contents: " + buildDirContents;
    }
    const [tgzFilename] = buildDirContents;
    if (!tgzFilename.endsWith(".tgz")) {
      throw "unexpected filename in /build: " + tgzFilename;
    }

    await run("tar", "-C", buildDir, "-xzf", `${buildDir}/${tgzFilename}`);
    await rm(`${buildDir}/${tgzFilename}`);
    // As described at
    // https://docs.npmjs.com/cli/v9/commands/npm-install#description
    // (points a and b), a package tarball contains a folder that contains the
    // package contents. That folder is usually named "package" (that seems to
    // be what `npm pack` defaults to), but this is not strictly required and
    // there are exceptions - e.g.
    // https://registry.npmjs.org/@types/node/-/node-24.0.14.tgz
    // Therefore we need to check the name of the folder we've extracted here:
    const [buildTarballFolderName] = await readdir(buildDir);
    const builtContentPath = `${buildDir}/${buildTarballFolderName}`;

    // If we successfully ran a build, next we need to download the version
    // published on npm to compare against
    const tarballFilename = tarballUrl.split("/").pop();
    await run("wget", tarballUrl, "-O", `${publishedDir}/${tarballFilename}`);
    await run(
      "tar",
      "-C",
      publishedDir,
      "-xzf",
      `${publishedDir}/${tarballFilename}`,
    );
    await rm(`${publishedDir}/${tarballFilename}`);
    const [publishedTarballFolderName] = await readdir(publishedDir);
    const publishedContentPath = `${publishedDir}/${publishedTarballFolderName}`;

    // npm tarballs always have a top-level "package/" directory, so the final
    // step is to diff those against each other:
    await log("Diffing", builtContentPath, "against", publishedContentPath);
    try {
      await run("diff", "-ur", builtContentPath, publishedContentPath);
      resultJson.contentMatches = true;
    } catch (e) {
      let diff = e.stdout;
      if (!diff.trim()) {
        throw "diff failed, but with no output";
      }
      resultJson.contentMatches = false;
      await log("Mismatch! Diff:");
      await log(diff);

      // Next we parse the output from `diff` to get a list of what files have
      // been changed and how, and then we determine whether all of those
      // changes are known to be "benign" (based on a list of known-benign
      // commonly-occurring differences between built and published versions)

      // First parse lines like this:
      //   Only in /home/mark/source-vs-npm/audits/cliui/9.0.1/published/package: CHANGELOG.md
      const changes = Array.from(
        diff
          .matchAll(/^Only in (.+): (.+)$\n/gm)
          .map(([_, folder, filename]) => {
            if (folder.startsWith(publishedContentPath)) {
              const sansPrefix = folder
                .replace(publishedContentPath, "")
                .replace(/^\//, "");
              return {
                type: "published-only",
                path: `${sansPrefix}/${filename}`,
              };
            } else if (folder.startsWith(builtContentPath)) {
              const sansPrefix = folder
                .replace(builtContentPath, "")
                .replace(/^\//, "");
              return {
                type: "build-only",
                path: `${sansPrefix}/${filename}`,
              };
            } else
              throw `unexpected only in line; folder: ${folder}; filename: ${filename}`;
          }),
      );

      // Then strip out those lines, parse the remaining output (if any) with
      // jsdiff, and check the diff headers to see which files have been
      // modified:
      diff = diff.replaceAll(/^Only in .+:.+$\n/gm, "").trim();
      if (diff) {
        const parsedPatch = parsePatch(diff);

        for (const fileDiff of parsedPatch) {
          changes.push({
            type: "change",
            path: fileDiff.newFileName.replace(publishedContentPath, ""),
          });
        }
      }

      await log("Summary of files changed:", JSON.stringify(changes, null, 2));

      // Now evaluate whether every single change in the diff matches a known
      // benign reason for a mismatch to be present.
      let dubiousChange;
      resultJson.isKnownBenignMismatch = changes.every((change) => {
        // 1. Sometimes the published version includes CHANGELOG.md but our
        //    generated version doesn't, because npm's rules on packing
        //    CHANGELOG.md by default have changed.
        if (change.type == "published-only" && change.path == "/CHANGELOG.md") {
          return true;
        }

        // 2. Some packages (e.g. cliui) publish tsconfig.tsbuildinfo, an
        //    intermediate build artifact from incremental TypeScript
        //    compilation that doesn't reliably end up with the same content
        //    when rebuilding from scratch.
        //    (Presumably its content depends in part on the order in which
        //    different files were incrementally built.)
        //    Ignore any differences in that file:
        if (change.path.endsWith("/tsconfig.tsbuildinfo")) {
          return true;
        }

        // 3. In @types packages, the `package.json`, `README.md` and `LICENSE`
        //    files are generated by
        //    https://github.com/microsoft/DefinitelyTyped-tools/blob/main/packages/publisher/src/generate-packages.ts
        //    in a way we simply don't bother to replicate, so we assume here
        //    any differences in those files are benign:
        if (
          packageName.startsWith("@types/") &&
          ["/package.json", "/README.md", "/LICENSE"].includes(change.path)
        ) {
          return true;
        }

        dubiousChange = change;
        return false;
      });
      if (!resultJson.isKnownBenignMismatch) {
        await log(
          "Change",
          JSON.stringify(dubiousChange),
          "does not appear benign",
        );
      }
    }
  } catch (e) {
    let category, msg;
    if (e instanceof JobFailed) {
      category = e.category;
      msg = e.msg;
    } else {
      category = "unexpected crash";
      if (e instanceof Error) {
        if (e.stdout || e.stderr) {
          msg = `Command failed with an error. Stack: ${e.stack}\n`;
          if (e.stdout) {
            msg += `stdout: ${e.stdout}\n`;
          }
          if (e.stderr) {
            msg += `stderr: ${e.stderr}\n`;
          }
        } else {
          msg = e.stack;
        }
      } else {
        msg = e;
      }
    }
    await log("Failed with error category", category);
    await log(msg);
    resultJson.errorCategory = category;
  } finally {
    // Make sure the writeable log stream has flushed everything.
    // I am not sure if this stuff is really necessary, because the docs kinda
    // suck; am including it because I'm paranoid.
    let logsAllWrittenResolve;
    const logsAllWrittenPromise = new Promise((resolve, _) => {
      logsAllWrittenResolve = resolve;
    });
    logStream.on("finish", logsAllWrittenResolve);
    logStream.end();
    await logsAllWrittenPromise;

    // Write the results to disk:
    await writeFile(`${packageDir}/results.json`, JSON.stringify(resultJson));
  }
}

const MAX_SIMULTANEOUS_AUDITS = 5;
const packageNamesQueue = [...packageNames].reverse();
async function doAuditsUntilFinished() {
  while (packageNamesQueue.length > 0) {
    const packageName = packageNamesQueue.pop();
    await auditPackage(packageName);
  }
}

const workers = [];
for (let i = 0; i < MAX_SIMULTANEOUS_AUDITS; i++) {
  workers.push(doAuditsUntilFinished());
}

await Promise.all(workers);

// Combine all results into a single result file:
const allResults = packageNames.map((packageName) =>
  JSON.parse(readFileSync(`audits/${packageName}/results.json`).toString()),
);
writeFileSync("allResults.json", JSON.stringify(allResults));

// Populate the results template and view results
const resultsHtml = readFileSync("./results.template.html").toString().replace(
  "PLACEHOLDER",
  // Escaping forward slashes, not done by JSON.stringify by default, avoids
  // breaking out of our <script> element if allResults contains the text
  // "</script>" in a string for some reason.
  JSON.stringify(allResults).replaceAll("/", "\\/"),
);
writeFileSync("./results.html", resultsHtml);
execFile("open", ["results.html"]);
