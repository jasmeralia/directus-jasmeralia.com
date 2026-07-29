import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildManifest, diffManifests } from "./sync-dist.mjs";

test("detects same-size content changes without selecting unchanged files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sync-dist-test."));
  try {
    await writeFile(path.join(root, "changed.html"), "Andromeda\\n", "utf8");
    await writeFile(path.join(root, "unchanged.html"), "stable\\n", "utf8");
    const previous = await buildManifest(root);

    await writeFile(path.join(root, "changed.html"), "Legendary\\n", "utf8");
    const current = await buildManifest(root);
    const plan = diffManifests(previous, current);

    assert.deepEqual(plan.changed, ["changed.html"]);
    assert.deepEqual(plan.removed, []);
    assert.equal(plan.unchanged, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects removed files and excludes preserved media", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sync-dist-test."));
  try {
    await writeFile(path.join(root, "removed.html"), "remove me\\n", "utf8");
    const previous = await buildManifest(root);

    await rm(path.join(root, "removed.html"));
    await mkdir(path.join(root, "media"));
    await writeFile(path.join(root, "media", "cover.jpg"), "preserved\\n", "utf8");
    const current = await buildManifest(root);
    const plan = diffManifests(previous, current);

    assert.deepEqual(plan.changed, []);
    assert.deepEqual(plan.removed, ["removed.html"]);
    assert.equal("media/cover.jpg" in current.files, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
