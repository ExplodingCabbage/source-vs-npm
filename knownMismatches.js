export default {
  // Published version contains a licensing comment and some sponsorship info
  // in package.json that is missing from the source. Inconsequential.
  "safe-buffer": ["5.2.1"],

  // resolve v1 ships with a "core.json" file that identifies which packages are
  // "core modules" of Node (to be removed in v2 in favour of
  // https://github.com/inspect-js/is-core-module). In v1.22.10, one version
  // range in core.json was updated to match the change from
  // https://github.com/inspect-js/is-core-module/commit/aafb7cae0976ecfb156bc563dde57ca8fd838d0c
  // without that change being committed to source control. Innocuous.
  resolve: ["1.22.10"],

  // Maintainer accidentally published his /.idea folder (IDE config outside
  // source control).
  "iconv-lite": ["0.6.3"],
};
