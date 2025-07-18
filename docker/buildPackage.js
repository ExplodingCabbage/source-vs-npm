import process from "node:process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fs, { existsSync } from "node:fs";
import { readFile, copyFile } from "node:fs/promises";

const scriptArgs = process.argv.slice(2);

if (scriptArgs.length != 3) {
  console.error(
    "Expected 3 arguments - name, Git repo path and version number. Got ",
    scriptArgs.length,
    "arguments: ",
    scriptArgs,
  );
  process.exit(1);
}

const [packageName, gitUrl, version] = scriptArgs;

console.log(
  "Attempting to fetch and build version",
  version,
  "of",
  packageName,
  "from",
  gitUrl,
);

async function run(...command) {
  return await promisify(execFile)(command[0], command.slice(1));
}

async function git(...command) {
  return await run("git", ...command);
}

class BuildFailed extends Error {
  constructor(errorCode) {
    super();
    this.errorCode = errorCode;
  }
}

// Giant try/catch that all the logic runs in. If we get an error, we stick it
// in an error.json file.
try {
  await git("clone", gitUrl, "gitrepo");
  process.chdir("gitrepo");
  const useYarn = existsSync("yarn.lock");
  const pkgMngr = useYarn ? "yarn" : "npm";

  if (packageName.startsWith("@types/")) {
    // @types packages all come from the DefinitelyTyped repo which contains
    // a bajillion small packages within it.
    // We just change to the directory for this package (which will have its
    // own package.json), skip all the other build steps, and pack.
    process.chdir(packageName.slice(1));
  } else {
    // A version number on npm of `1.2.3` might correspond to a tag on GitHub of
    // `v1.2.3`, so we try both
    let tagExisted = false;
    for (const tagName of [
      version,
      `v${version}`,
      `${packageName}-${version}`,
      `${packageName}-v${version}`, // Used by yargs-parser
    ]) {
      try {
        await git("checkout", `refs/tags/${tagName}`);
        tagExisted = tagName;
        break;
      } catch (e) {
        console.log(`Attempted to checkout ${tagName}; got this output:`);
        console.log("stdout:", e.stdout);
        console.log("stderr:", e.stderr);
        continue;
      }
    }
    if (!tagExisted) {
      console.error("Couldn't find a Git tag matching the npm version");
      throw new BuildFailed("no tag match");
    }
    console.log("Checked out", tagExisted);

    // (The React monorepo is a special snowflake & needs some of custom logic)
    const isReact = gitUrl === "https://github.com/facebook/react.git";

    // Some multi-package monorepos like https://github.com/eslint/js have
    // individual packages in folders within a /packages/ top-level folder.
    // Let's try to handle that:
    if (!isReact) {
      for (const possibleSubfolderName of [
        packageName,
        `packages/${packageName}`,
      ]) {
        if (existsSync(`${possibleSubfolderName}/package.json`)) {
          process.chdir(possibleSubfolderName);
        }
      }
    }

    const packageJson = JSON.parse(await readFile("package.json"));

    await run(pkgMngr, "install");

    // If there's a "build" script, run it. For some packages we need
    // repo-specific special cases here
    if (isReact) {
      await run("yarn", "build", packageName);
      process.chdir(`build/oss-stable-semver/${packageName}`);
    } else if (!packageJson.scripts) {
      console.log(
        "Package has no scripts whatsoever. Packing without running a build.",
      );
    } else if ("build" in packageJson.scripts) {
      console.log("Running `build`.");
      const buildResult = await run(pkgMngr, "run", "build");
      console.log("stdout:", buildResult.stdout);
      console.log("stderr:", buildResult.stderr);
    } else {
      console.log(
        "No build script found. Packing repo contents without running a build.",
      );
    }
  }

  const packResult = await run(pkgMngr, "pack");
  let finalTgz;
  if (useYarn) {
    // We're looking to find and parse a line like this:
    //     success Wrote tarball to "/home/mark/react/packages/react-is/react-is-v19.1.0.tgz".
    // (In a real terminal it's colored, but yarn omits the colors when not
    // called from a terminal, so we don't need to deal with that nuisance.)
    // (Hopefully there will never be multiple lines like that, or we'll get
    // this wrong!)
    const match = packResult.stdout.match(
      /^success Wrote tarball to "(.+)"\.$/m,
    );
    if (!match) {
      console.log(
        "yarn didn't output tarball name? Output:",
        packResult.stdout,
      );
      throw "couldn't determine tarball name";
    }
    finalTgz = match[1].split("/").pop();
  } else {
    // npm pack outputs the name of the .tgz file it creates on stdout (below a
    // whole load of other output, mostly sent to stderr - though when there are
    // scripts that run before packing, some may go to stdout too):
    finalTgz = packResult.stdout.trim().split("\n").pop();
  }

  // Move the final tgz to host-bound output folder we set up in the Dockerfile
  await copyFile(finalTgz, `/home/node/build/${finalTgz}`);
  console.log("Successfully wrote packed .tgz file to the build directory");
} catch (e) {
  let errJson;
  if (e instanceof BuildFailed) {
    console.error("Build failed due to:", e.errorCode);
    errJson = { errorCode: e.errorCode };
  } else {
    errJson = { errorCode: "unexpected-error" };
    // Output the error and stack trace (which will then be captured and logged
    // to a file by auditAll.js)
    console.error("Build failed with unexpected error:");
    if (e instanceof Error) {
      console.error(e.stack);
    } else {
      console.error(e);
    }
  }
  fs.writeFileSync("/home/node/build/error.json", JSON.stringify(errJson));
}
