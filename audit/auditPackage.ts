import { promisify } from "util";
import { exec, execFile } from "child_process";
import { mkdir, readFile, writeFile, rm, readdir } from "fs/promises";
import { createWriteStream, existsSync } from "fs";
import knownMismatches from "./knownMismatches.js";
import { parsePatch } from "diff";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

async function run(
  ...command: string[]
): Promise<{ stdout: string; stderr: string }> {
  return await promisify(execFile)(command[0], command.slice(1));
}

/**
 * Run the given command as a shell command, redirecting stderr to stdout so
 * that output will be interleaved, and relaxing Node's default max buffer size
 * in case that output is large.
 */
async function runShell(
  ...command: string[]
): Promise<{ stdout: string; stderr: string }> {
  return await promisify(exec)(
    command.map(escapeShellArg).join(" ") + " 2>&1",
    { maxBuffer: 1024 * 1024 * 250 }, // 250MiB
  );
}

// Nicked from https://stackoverflow.com/a/22827128/1709587
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

// Module initialisation: make sure we have an up-to-date version of the Docker
// image we use for running untrusted build scripts in. Without this, we can't
// audit packages.
const dockerDir = `${repoRoot}/audit/docker`;
const imageId = (
  await run("sudo", "docker", "build", "--quiet", dockerDir)
).stdout.trim();

interface BuildResultJson {
  errorCode?: string;
  [key: string]: any;
}

interface RegistryResponse {
  "dist-tags": {
    latest: string;
    [key: string]: string;
  };
  time: {
    [version: string]: string;
  };
  versions: {
    [version: string]: {
      dist: {
        tarball: string;
      };
    };
  };
  repository?:
    | {
        type?: string;
        url?: string;
      }
    | string;
}

interface ResultJson {
  packageName: string;
  startTime: string;
  version?: string;
  publishedAt?: string;
  repoUrl?: string;
  labels: string[];
  buildDetails?: any;
  mismatch?: boolean;
  diffs?: any;
  summary?: string;
}

/**
 * category: short (e.g. 1 or 2 word) summary used to categorise the error in
 *           the final table of audits.
 * error: either a caught error object (which will be logged with stack trace)
 *        or a string (which will just be logged).
 */
class JobFailed extends Error {
  category: string;
  explanation: string;
  error: Error | string | null;

  constructor(
    category: string,
    explanation: string,
    errorObj: Error | string | null = null,
  ) {
    super();
    this.category = category;
    this.explanation = explanation;
    this.error = errorObj;
  }
}

/**
 * Sometimes people upload packages like `@chee/..` that break the npm website
 * and API (due to the special meaning of `.` and `..` in URLs) and also this
 * tool's own logic when writing files to the local filesystem (due to the
 * special meaning of `.` and `..` in Unix file paths). "Auditing" these
 * packages is of no practical use to anybody, so we just check for them and
 * reject attempts to audit them.
 */
export function isNaughty(packageName: string): boolean {
  return (
    packageName.split("/").includes(".") ||
    packageName.split("/").includes("..")
  );
}

export async function auditPackage(packageName: string): Promise<void> {
  if (isNaughty(packageName)) {
    throw `Cannot audit naughty package ${packageName}`;
  }

  // Create (if not exists) a folder for results/logs/diffs about this package:
  const packageDir = `${repoRoot}/audits/${packageName}`;
  await mkdir(packageDir, { recursive: true });

  // A summary of this run we will write to `packageDir`:
  const resultJson: ResultJson = {
    packageName: packageName,
    startTime: new Date().toISOString(),
    // TODO: use these properties from buildResult.json
    // - successfulBuildCommand
    labels: [],
  };

  // Create a log file. Timestamp in name avoids overwriting old ones.
  const logStream = createWriteStream(
    `${packageDir}/${resultJson.startTime}.log`,
  );
  let drainPromiseResolver: (() => void) | undefined;
  logStream.on("drain", () => {
    if (drainPromiseResolver) drainPromiseResolver();
  });

  async function writeStringToLog(string: string): Promise<void> {
    if (!logStream.write(string)) {
      const drainPromise = new Promise<void>((resolve) => {
        drainPromiseResolver = resolve;
      });
      await drainPromise;
    }
  }

  // Create functions for logging and for writing final audit results:
  // TODO: Just "log" to an array, and form a big string in memory later and
  //       return it. Then it can be written to either disk or DB, once we have
  //       a DB.
  async function log(...msg: any[]): Promise<void> {
    msg.reverse();
    while (msg.length) {
      await writeStringToLog((msg.pop() as any).toString());
      await writeStringToLog(msg.length > 0 ? " " : "\n");
    }
  }

  // Now that we've got logging set up, everything else happens in a massive
  // try/catch/finally block that logs any failures.
  try {
    // Hit the npm registry to fetch data we need about the package:
    let registryRespJson: RegistryResponse;
    // TODO: Error handling here is bad. Handle error status codes and invalid JSON.
    try {
      // We only care about the latest version, but cannot use the endpoint to
      // fetch just that version because that endpoint doesn't return the
      // publication date, which we need. So we have to fetch all the data
      // about the package!
      const resp = await fetch(`https://registry.npmjs.org/${packageName}`);
      registryRespJson = (await resp.json()) as RegistryResponse;
    } catch (e) {
      throw new JobFailed(
        "reg fetch failed",
        "No response from the npm registry when requesting package info",
        e as Error,
      );
    }

    const version = registryRespJson["dist-tags"].latest;
    resultJson.version = version;

    const publishedAt = registryRespJson.time[version];
    resultJson.publishedAt = publishedAt;

    const tarballUrl = registryRespJson.versions[version].dist.tarball;
    if (!tarballUrl.endsWith(".tgz")) {
      throw "Unexpected tarball URL format. Value was: " + tarballUrl;
    }
    if (!registryRespJson.repository) {
      throw new JobFailed(
        "no repository",
        "repository field in registry was null or absent",
      );
    }
    if (
      typeof registryRespJson.repository === "object" &&
      registryRespJson.repository.type !== "git" &&
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
      typeof registryRespJson.repository === "object" &&
      registryRespJson.repository.url
        ? registryRespJson.repository.url
        : (registryRespJson.repository as string);

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

    resultJson.repoUrl = repoUrl;

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

    const buildJsonPath = `${buildDir}/buildResult.json`;
    if (!existsSync(buildJsonPath)) {
      throw "buildPackage.js failed to write a buildResult.json file";
    }
    const buildResultJson: BuildResultJson = JSON.parse(
      await readFile(buildJsonPath, "utf-8"),
    );
    resultJson.buildDetails = buildResultJson;
    if (buildResultJson.errorCode) {
      throw new JobFailed(
        `build:${buildResultJson.errorCode}`,
        `Build failed and reported error code ${buildResultJson.errorCode}`,
      );
    }

    // Download the published package from npm and extract it to `/published`:
    await log("Downloading package from npm");
    await runShell("cd", publishedDir, "&&", "npm", "pack", tarballUrl);
    // The tarball is named {name}-{version}.tgz, but the name may be a "scoped
    // package" in the format @scope/name, and this means the tarball is named
    // scope-name-version.tgz
    const tarballsInDir = await readdir(publishedDir);
    if (tarballsInDir.length != 1) {
      throw `Expected 1 tarball in ${publishedDir}, saw: ${tarballsInDir}`;
    }
    await log("Extracting package.tgz");
    // Extract to current directory, overwriting destination files if they
    // already exist (-o flag):
    await runShell(
      "tar",
      "-xozf",
      `${publishedDir}/${tarballsInDir[0]}`,
      "-C",
      publishedDir,
    );

    // Compare the results of our build with the published version:
    await log("Comparing npm package content to built content");
    // Omitting --no-dereference (which would prevent following symlinks)
    // because I've seen one in the lodash package, and I think it's intended
    // to be there. The point is to ensure that the *content* is identical, not
    // necessarily all details of the file metadata.
    // TODO: allow for differences in file mtime when comparing.
    const diffResult = await runShell(
      "sudo", // Gives us access to read all files
      "diff",
      "-r", // recursive
      "--unified", // include a bit of context
      "--text", // Prevent treating files as binary (e.g. if they have NUL bytes)
      "--color", // Feel like it
      // We want to ignore package.json differences like the "gitHead" field
      // which is inserted by the npm publish process. We don't consider
      // metadata like that to be "content" we care about.
      "--exclude=package.json",
      `${publishedDir}/package`,
      `${buildDir}/package`,
    );
    if (diffResult.stdout) {
      const diffs = parsePatch(diffResult.stdout);
      await log("diffs:", JSON.stringify(diffs, null, 2));

      // Check if the package is known to have this version mismatch:
      const knownMismatchVersions = knownMismatches[packageName] || [];

      // We found differences. Mark the result as "mismatched":
      resultJson.mismatch = true;
      resultJson.diffs = diffs;
      resultJson.summary = knownMismatchVersions.includes(version)
        ? "Known mismatch: this version is whitelisted because we know about " +
          "and don't care about some differences between the built and published packages."
        : "Mismatch: the built package does not match the published package.\n" +
          "The command `diff -r --unified --text " +
          `${publishedDir}/package ${buildDir}/package` +
          "` yielded output.\n" +
          "This might be a sign of foul play: packages on npm that cannot be " +
          "recreated from the source using the build instructions. " +
          "But it's more likely a false positive: some innocuous extra file " +
          "added during the npm publish process, " +
          "or the author used a slightly different build process when publishing " +
          "(rare, but not malicious).";

      const allLabels = [
        "red",
        ...(knownMismatchVersions.includes(version)
          ? ["white", "whitelisted"]
          : []),
      ];
      resultJson.labels = allLabels;
    } else {
      // No differences. The build and the published package are byte-for-byte identical.
      resultJson.summary = `Package was successfully audited. No differences found between built and published versions.`;
      resultJson.labels = ["green", "clean"];
    }

    // Now we've finished, we write out the result with all our conclusions:
    await writeFile(
      `${packageDir}/results.json`,
      JSON.stringify(resultJson, null, 2),
    );
    await log("Done! Final report:", JSON.stringify(resultJson, null, 2));
  } catch (e) {
    await log("ERROR:", e);
    // We want a nicer JSON error report for the UI
    let errorCategory = "unknown";
    let errorExplanation = "";

    if (e instanceof JobFailed) {
      errorCategory = e.category;
      errorExplanation = e.explanation;
      if (e.error) {
        await log("Caused by", e.error);
      }
    } else if (typeof e === "string") {
      errorCategory = "coded error";
      errorExplanation = e;
    } else if (e instanceof Error) {
      errorCategory = "unexpected error";
      errorExplanation = e.message;
      await log(e.stack);
    }

    // Even though the audit failed, we still write a report
    // file so that we can show the error in the UI:
    resultJson.summary = `Error during audit. Category: ${errorCategory}. ${errorExplanation}`;
    resultJson.labels = ["red", "error", errorCategory];

    await writeFile(
      `${packageDir}/results.json`,
      JSON.stringify(resultJson, null, 2),
    );
  } finally {
    logStream.end();
  }
}
