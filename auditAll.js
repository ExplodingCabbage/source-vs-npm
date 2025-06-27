import { promisify } from "node:util";
import { exec, execFile } from "node:child_process";
import downloadCounts from "download-counts" with { type: "json" };
import { mkdir, readFile, rm } from "node:fs/promises";
import { createFileStream, existsSync } from "node:fs";

const N_PACKAGES = 5000;

const packageNames = Object.entries(downloadCounts)
  .filter(([_, count]) => count)
  .sort(([_, countA], [__, countB]) => countB - countA)
  .slice(0, N_PACKAGES);

// Assert there are no naughty package names we can't use as directory paths:
if (
  packageNames.some(
    (packageName) =>
      packageName.split("/").includes(".") ||
      packageName.split("/").includes(".."),
  )
) {
  throw `unexpected naughty package name in top ${N_PACKAGES}: ${packageName}`;
}

async function run(...command) {
  return await promisify(execFile)(command);
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
const imageId = (await run("sudo", "docker", "build", "--quiet", dockerDir))
  .stdout;

/**
 * category: short (e.g. 1 or 2 word) summary used to categorise the error in
 *           the final table of audits.
 * error: either a caught error object (which will be logged with stack trace)
 *        or a string (which will just be logged).
 */
class JobFailed extends Error {
  constructor(category, msgOrError) {
    this.category = category;
    if (msgOrError instanceof Error) {
      this.msg = `Caused by ${msgOrError.__proto__.name}: ${msgOrError.message}`;
      if (msgOrError.stack) {
        msg += "\n" + msgOrError.stack;
      }
    } else {
      this.msg = msg;
    }
  }
}

async function auditPackage(packageName) {
  // Create (if not exists) a folder for results/logs/diffs about this package:
  const packageDir = `${import.meta.dirname}/${packageName}`;
  await mkdir(packageDir, { recursive: true });

  // A summary of this run we will write to `packageDir`:
  const resultJson = {
    packageName: packageName,
    startTime: new Date().toISOString(),
  };

  // Create a log file. Timestamp in name avoids overwriting old ones.
  const logStream = createFileStream(
    `${packageName}-${resultJson.startTime}.log`,
  );

  // Create functions for logging and for writing final audit results:
  function log(msg) {
    logStream.write(msg + "\n");
  }

  // Now that we've got logging set up, everything else happens in a massive
  // try/catch/finally block that logs any failures.
  try {
    // Hit the npm registry to fetch data we need about the package:
    let registryRespJson;
    try {
      const resp = await fetch(
        `https://registry.npmjs.org/${packageName}/latest`,
      );
      const registryRespJson = await resp.json();
    } catch (e) {
      throw JobFailed("reg fetch failed", e);
    }

    const version = registryRespJson.version;
    const tarballUrl = registryRespJson.dist.tarball;
    if (!registryRespJson.repository) {
      throw JobFailed("no repository", "repository field in registry was null");
    }
    if (registryRespJson.repository.type != "git") {
      throw JobFailed("not git", `repository.type was ${repository.type}`);
    }

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
    console.log("Running build inside Docker. Output:");
    output = (
      await runShell(
        "docker",
        "run",
        "--mount",
        `type=bind,src=${buildDir},dst=/home/node/build`,
        imageId,
        packageName,
        version,
      )
    ).stdout;
    console.log(output);

    errorJsonPath = `${buildDir}/error.json`;
    if (existsSync(errorJsonPath)) {
      const buildErrorCode = JSON.parse(
        await readFile(errorJsonPath),
      ).errorCode;
      throw new JobFailed(
        `build:${buildErrorCode}`,
        `Build failed and reported error code ${buildErrorCode}`,
      );
    }

    // TODO: Find and unpack the tarball!
  } catch (e) {
    let category, msg;
    if (e instanceof JobFailed) {
      category = e.category;
      msg = e.msg;
    } else {
      category = "unexpected crash";
      if (e instanceof Error) {
        msg = `${e.__proto__.name}: ${e.message}`;
        if (e.stack) {
          msg += "\n" + e.stack;
        }
      } else {
        msg = e;
      }
    }
    log("Failed with error category", category);
    log(msg);
    resultJson.errorCategory = category;
  } finally {
    // Write the results to disk:
    await fs.promises.writeFile(
      `${packageDir}/results.json`,
      JSON.stringify(resultJson),
    );
  }
}
