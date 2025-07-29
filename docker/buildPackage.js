import process from "node:process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fs, { existsSync } from "node:fs";
import { readFile, copyFile } from "node:fs/promises";

const scriptArgs = process.argv.slice(2);

if (scriptArgs.length != 4) {
  console.error(
    "Expected 4 arguments - name, Git repo path, version number, and publication date. Got ",
    scriptArgs.length,
    "arguments: ",
    scriptArgs,
  );
  process.exit(1);
}

const [packageName, gitUrl, version, publishedDate] = scriptArgs;

console.log(
  "Attempting to fetch and build version",
  version,
  "of",
  packageName,
  "from",
  gitUrl,
);

async function run(command, options) {
  console.log("Running", command, "with options:", options);
  try {
    const result = await promisify(execFile)(
      command[0],
      command.slice(1),
      options,
    );
    console.log("stdout:", result.stdout);
    console.log("stderr:", result.stderr);
    console.log("---");
    return result;
  } catch (e) {
    console.log("Command failed!");
    console.log("stdout:", e.stdout);
    console.log("stderr:", e.stderr);
    console.log("---");
    throw e;
  }
}

async function git(...command) {
  return await run(["git", ...command]);
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
  const repoRoot = process.cwd();
  const useYarn = existsSync("yarn.lock");
  const usePnpm = existsSync("pnpm-lock.yaml");
  const pkgMngr = useYarn ? "yarn" : usePnpm ? "pnpm" : "npm";

  // Some multi-package monorepos like https://github.com/eslint/js have
  // individual packages in folders within a /packages/ top-level folder.
  // We try to detect that here and adjust the build and pack process
  // accordingly later.
  let packageSubdir = null; // null means this is NOT a multipackage monorepo

  for (const possibleSubfolderName of [
    `${repoRoot}/${packageName}`,
    `${repoRoot}/packages/${packageName}`,
  ]) {
    if (existsSync(`${possibleSubfolderName}/package.json`)) {
      packageSubdir = possibleSubfolderName;
      break;
    }
  }
  if (!packageSubdir && packageName.includes("/")) {
    // Example:
    // packageName: @babel/types
    //   namespace: @babel
    //     subname: types
    //      noAtNs: babel
    // noAtPkgName: babel/types
    const [namespace, subname] = packageName.split("/");
    const noAtNs = namespace.replace("@", "");
    const noAtPkgName = packageName.replace("@", "");

    for (const possibleSubfolderName of [
      `${repoRoot}/${packageName}`,
      `${repoRoot}/packages/${packageName}`,
      `${repoRoot}/${noAtPkgName}`,
      `${repoRoot}/packages/${noAtPkgName}`,
      `${repoRoot}/${noAtNs}-${subname}`,
      // Example: @babel/types package lives at
      //          https://github.com/babel/babel/tree/main/packages/babel-types
      `${repoRoot}/packages/${noAtNs}-${subname}`,
    ]) {
      if (existsSync(`${possibleSubfolderName}/package.json`)) {
        packageSubdir = possibleSubfolderName;
        break;
      }
    }
  }

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
      }
    }
    if (!tagExisted) {
      console.error("Couldn't find a Git tag matching the npm version");
      throw new BuildFailed("no tag match");
    }
    console.log("Checked out", tagExisted);
  }

  const rootPackageJson = JSON.parse(await readFile("package.json"));
  let subdirPackageJson;
  if (packageSubdir) {
    subdirPackageJson = JSON.parse(
      await readFile(`${packageSubdir}/package.json`),
    );
  }

  if (!packageName.startsWith("@types/")) {
    // npm, but not yarn, lets you pass a "--before" argument to only install
    // dependency versions that were published before a given date. If we're
    // using npm, let's use that to ensure we build using dep versions that
    // were available when the published version was built.
    const beforeDateArgs = pkgMngr == "npm" ? ["--before", publishedDate] : [];

    await run([pkgMngr, "install", ...beforeDateArgs]);
    if (packageSubdir) {
      await run([pkgMngr, "install", ...beforeDateArgs], {
        cwd: packageSubdir,
      });
    }

    if (
      packageSubdir &&
      subdirPackageJson.scripts &&
      "build" in subdirPackageJson.scripts
    ) {
      await run([pkgMngr, "run", "build"], { cwd: packageSubdir });
    } else if (rootPackageJson.scripts && "build" in rootPackageJson.scripts) {
      if (packageSubdir) {
        // First try passing the package name as an argument to the top-level
        // build script. Sometimes they take arguments!
        try {
          await run([pkgMngr, "run", "build", packageName]);
        } catch {
          // If that fails, just run it with no arguments. Probably this builds
          // lots of packages and is slow, but if that's the only option, we
          // just have to suck it up.
          await run([pkgMngr, "run", "build"]);
        }
      } else {
        await run([pkgMngr, "run", "build"]);
      }
    }
  }

  // Special-snowflake logic for the Babel monorepo, which uses Make
  if (gitUrl === "https://github.com/babel/babel.git") {
    await run(["make", "prepublish"]);
  }

  // Special-snowflake logic for the React monorepo - this is where it puts
  // built packages ready to be packed!
  if (gitUrl === "https://github.com/facebook/react.git") {
    process.chdir(`build/oss-stable-semver/${packageName}`);
  } else if (packageSubdir) {
    process.chdir(packageSubdir);
  }

  // Is there a clue in any package.json file that the clean-publish package
  // should be used for generating the published version? Clues could be:
  // - "clean-publish" being listed as a dev dependency
  // - there being a "clean-publish" config object at the top level of the JSON
  const useCleanPublish =
    rootPackageJson.devDependencies?.["clean-publish"] ||
    subdirPackageJson?.devDependencies?.["clean-publish"] ||
    rootPackageJson["clean-publish"] ||
    subdirPackageJson?.["clean-publish"];

  let finalTgz;
  if (useCleanPublish) {
    // Awkward case! clean-publish does have a mode that just packs without
    // publishing, sort of - but rather than compressing the output into a
    // .tar.gz file, it just leaves it uncompressed in a temporary folder.
    // To be able to get a tarball, we need to tell it what to call that folder
    // (so we know where the output will go - otherwise it's randomly named!)
    // and then compress the output ourselves.
    const packFolderName = "cleanpublishoutput";
    await run([
      "npx",
      "clean-publish",
      "--without-publish",
      "--temp-dir",
      packFolderName,
    ]);
    finalTgz = `${packageName}-${version}.tgz`;
    await run(["tar", "-czf", finalTgz, packFolderName]);
  } else {
    // Normal, simple case, where we just run `npm pack` or `yarn pack` or
    // whatever.
    const packResult = await run([pkgMngr, "pack"]);
    if (useYarn) {
      // We're looking to find and parse a line like this:
      //     success Wrote tarball to "/home/mark/react/packages/react-is/react-is-v19.1.0.tgz".
      // or
      //     Package archive generated in /home/node/gitrepo/packages/pretty-format/package.tgz
      // (which format depends on Yarn version).
      // (In a real terminal it's colored, but yarn omits the colors when not
      // called from a terminal, so we don't need to deal with that nuisance.)
      // (Hopefully there will never be multiple lines like that, or we'll get
      // this wrong!)
      const match =
        packResult.stdout.match(/^success Wrote tarball to "(.+)"\.$/m) ||
        packResult.stdout.match(/Package archive generated in (.+)$/m);
      if (!match) {
        console.log(
          "yarn didn't output tarball name? Output:",
          packResult.stdout,
        );
        throw "couldn't determine tarball name";
      }
      finalTgz = match[1].split("/").pop();
    } else {
      // TODO: What about pnpm? Does this logic handle pnpm pack properly?
      // npm pack outputs the name of the .tgz file it creates on stdout (below a
      // whole load of other output, mostly sent to stderr - though when there are
      // scripts that run before packing, some may go to stdout too):
      finalTgz = packResult.stdout.trim().split("\n").pop();
    }
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
