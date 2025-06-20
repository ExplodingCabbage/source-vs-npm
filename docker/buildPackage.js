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
