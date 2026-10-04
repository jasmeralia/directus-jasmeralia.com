import assert from "node:assert/strict";
import test from "node:test";

import { findBlocking } from "./audit-gate.mjs";

const hcs = {
  via: [{ name: "http-cache-semantics", url: "https://github.com/advisories/GHSA-ch52-4w7c-c8xp" }],
};
const devalue = {
  via: [{ name: "devalue", url: "https://github.com/advisories/GHSA-j22f-vq7h-c4qm" }],
};

test("http-cache-semantics advisory and pass-through dependents block", () => {
  const report = { vulnerabilities: { "http-cache-semantics": hcs, astro: { via: ["http-cache-semantics"] } } };
  assert.deepEqual(findBlocking(report).sort(), ["astro", "http-cache-semantics"]);
});

test("any other advisory still blocks, including pass-through dependents", () => {
  const report = {
    vulnerabilities: {
      "http-cache-semantics": hcs,
      astro: { via: ["http-cache-semantics", "devalue"] },
      devalue,
    },
  };
  assert.deepEqual(findBlocking(report).sort(), ["astro", "devalue"]);
});

test("a package carrying both accepted and unaccepted advisories blocks", () => {
  const report = { vulnerabilities: { x: { via: [...hcs.via, ...devalue.via] } } };
  assert.deepEqual(findBlocking(report), ["x"]);
});

test("empty report passes", () => {
  assert.deepEqual(findBlocking({}), []);
});
