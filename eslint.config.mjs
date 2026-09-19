import { createRequire } from "node:module";

// The site's package owns the shared JavaScript toolchain. Resolve from that
// package explicitly so builder scripts can be linted from the repository root
// without a duplicate package.json or node_modules tree.
const require = createRequire(new URL("./site/package.json", import.meta.url));
const js = require("@eslint/js");
const globals = require("globals");

export default [
  js.configs.recommended,
  {
    files: ["builder/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
];
