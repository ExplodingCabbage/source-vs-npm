import process from "node:process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { readFile, copyFile } from "node:fs/promises";

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

  // A version number on npm of `1.2.3` might correspond to a tag on GitHub of
  // `v1.2.3`, so we try both
  let tagExisted = false;
  for (const tagName of [version, `v${version}`]) {
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

  const packageJson = JSON.parse(await readFile("package.json"));

  // TODO: Generalise this to yarn and pnpm?
  await run("npm", "install");

  // If there's a "build" script, run it.
  // TODO: Probably need to loop over multiple possible script names here?
  if ("build" in packageJson.scripts) {
    console.log("Running `npm run build`.");
    const buildResult = await run("npm", "run", "build");
    console.log("stdout:", buildResult.stdout);
    console.log("stderr:", buildResult.stderr);
  } else {
    console.log(
      "No build script found. Packing repo contents without running a build.",
    );
  }

  // npm pack outputs the name of the .tgz file it creates on stdout (below a
  // whole load of logging it outputs to stderr):
  const packResult = await run("npm", "pack");
  const finalTgz = packResult.stdout.trim();

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
