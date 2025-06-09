# TODO

* write everything
* use real download-counts package

# source-vs-npm

A tool to check that the most popular npm packages contain what you get when you build them from source.

Entry point is `auditAll.js`. When this is run:

1. For each of the top 5000 packages (determined via the `download-counts` package), the following steps are run (with multiple packages being handled in parallel):
  * Create an output directory for that package.
  * Check with the npm registry what the latest version of the package is, and what the URL to the project's source repository is (if specified)
  * Create an output directory for that version (and record the latest version number in a metadata file in the package directory)
  * Check if we've already successfully built and packed that version; if so, skip the rest
  * If there's no source repository specified, check if we've got one hard-coded in this repo. If not, abort with an error.
  * Spin up a new Docker container to do the build process in, starting from a base image with Node.js, npm, yarn, and various other common build dependencies. Inside the container:
    * Clone the repo and attempt to build it. (TODO: more detail here - how do we determine how to build it? Do we try multiple candidate commands?) If the build fails, abort with an error.
    * Pack the result (with `npm pack`, `yarn pack`, etc), and store the packed result in a directory visible from the host machine.
  * Compare the result against the published tarball, downloaded from npm. (TODO: details on metadata. Is it expected to differ?) If it differs, abort with an error and save the diff where it can be reviewed later.

  Any errors in this step are recorded to a result file in the version directory. All output is also saved to a log file.

2. A HTML table is generated summarising the results from the data. For each package, the table notes:
  * the latest version
  * whether the test above passed, and if not, what error happened, out of the following possibilities:
    * couldn't identify source repo
    * build failed
    * built tarball didn't match published tarball
    * something else went wrong
