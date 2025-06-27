import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fs from "node:fs";

const scriptArgs = process.argv.slice(2);

if (scriptArgs.length != 2) {
  console.error(
    "Expected 2 arguments - Git repo path and version number. Got ",
    scriptArgs.length,
    "arguments: ",
    scriptArgs,
  );
  process.exit(1);
}

const [gitUrl, version] = scriptArgs;

console.log("Attempting to fetch and build version", version, "of", gitUrl);

async function run(...command) {
  return await promisify(execFile)(command);
}

async function git(...command) {
  return await run("git");
}

class BuildFailed extends Error {
  constructor(errorCode) {
    this.errorCode = errorCode;
  }
}

// Giant try/catch that all the logic runs in. If we get an error, we stick it
// in an error.json file.
try {
  await git("clone", gitUrl);
  // A version number on npm of `1.2.3` might correspond to a tag on GitHub of
  // `v1.2.3`, so we try both
  let tagExisted = false;
  for (const tagName of [version, `v${version}`]) {
    try {
      await git(["checkout", `refs/tags/${tagName}`]);
      tagExisted = tagName;
      break;
    } catch (e) {
      continue;
    }
  }
  if (!tagExisted) {
    console.error("Couldn't find a Git tag matching the npm version");
    throw BuildFailed("no tag match");
  }
  console.log("Checked out", tagExisted);

  // TODO: The stuff below needs generalising to more kinds of repo; loads will
  //       probably fail. Essentially a placeholder right now.
  //       Also we should actually programatically inspect the package.json to
  //       check what scripts are available so we don't e.g. attempt build for
  //       a package that simply has no build step
  await run("npm", "install");
  await run("npm", "run", "build");

  // npm pack outputs the name of the .tgz file it creates on stdout (below a
  // whole load of logging it outputs to stderr):
  const packResult = await run("npm", "pack");
  const finalTgz = packResult.stdout;

  // Move the final tgz to host-bound output folder we set up in the Dockerfile
  fs.rename(finalTgz, "/home/node/build/");
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
      console.error(`${e.__proto__.name}: ${e.message}`);
      if (e.stack) {
        console.error(e.stack);
      }
    } else {
      console.error(e);
    }
  }
  fs.writeFileSync("/home/node/build/error.json", JSON.stringify(errJson));
}
