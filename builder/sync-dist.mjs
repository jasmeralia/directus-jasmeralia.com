#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST_VERSION = 1;
const DELETE_BATCH_SIZE = 1000;

const compareNames = (left, right) =>
  left.localeCompare(right, undefined, { sensitivity: "base" })
  || (left < right ? -1 : left > right ? 1 : 0);

const sha256File = async (filePath) => {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

const walkFiles = async (root, relative = "") => {
  const directory = path.join(root, relative);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => compareNames(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const childRelative = relative
      ? path.posix.join(relative, entry.name)
      : entry.name;
    if (childRelative === "media" || childRelative.startsWith("media/")) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, childRelative));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported deploy entry: ${childRelative}`);
    }
    files.push(childRelative);
  }
  return files;
};

export const buildManifest = async (root) => {
  const files = {};
  for (const relative of await walkFiles(root)) {
    files[relative] = await sha256File(path.join(root, relative));
  }
  return { version: MANIFEST_VERSION, files };
};

export const diffManifests = (previous, current) => {
  const previousFiles = previous?.files ?? {};
  const currentFiles = current.files;
  const changed = Object.keys(currentFiles)
    .filter((key) => previousFiles[key] !== currentFiles[key])
    .sort(compareNames);
  const removed = Object.keys(previousFiles)
    .filter((key) => !(key in currentFiles))
    .sort(compareNames);
  return {
    changed,
    removed,
    unchanged: Object.keys(currentFiles).length - changed.length,
  };
};

const loadManifest = async (manifestPath) => {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    if (
      parsed?.version !== MANIFEST_VERSION
      || !parsed.files
      || typeof parsed.files !== "object"
      || Array.isArray(parsed.files)
    ) {
      throw new Error(`Unsupported deploy manifest: ${manifestPath}`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const saveManifest = async (manifestPath, manifest) => {
  const directory = path.dirname(manifestPath);
  const temporary = path.join(
    directory,
    `.${path.basename(manifestPath)}.${process.pid}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(manifest)}\n`, "utf8");
  await rename(temporary, manifestPath);
};

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`,
        ),
      );
    });
  });

const stageChangedFiles = async (distPath, changed, stagingPath) => {
  for (const relative of changed) {
    const source = path.join(distPath, relative);
    const target = path.join(stagingPath, relative);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await link(source, target);
    } catch (error) {
      if (!["EXDEV", "EPERM", "EACCES"].includes(error?.code)) throw error;
      await copyFile(source, target);
    }
  }
};

const deleteRemovedFiles = async (bucket, region, removed, temporaryRoot) => {
  for (let index = 0; index < removed.length; index += DELETE_BATCH_SIZE) {
    const batch = removed.slice(index, index + DELETE_BATCH_SIZE);
    const payloadPath = path.join(temporaryRoot, `delete-${index}.json`);
    await writeFile(
      payloadPath,
      JSON.stringify({
        Objects: batch.map((key) => ({ Key: key })),
        Quiet: true,
      }),
      "utf8",
    );
    await run("aws", [
      "s3api",
      "delete-objects",
      "--bucket",
      bucket,
      "--delete",
      `file://${payloadPath}`,
      "--region",
      region,
    ]);
  }
};

const publish = async (distPath, manifestPath, bucket, region) => {
  const current = await buildManifest(distPath);
  const previous = await loadManifest(manifestPath);

  if (previous === null) {
    console.log("No deploy manifest found; performing one full bootstrap sync.");
    await run("aws", [
      "s3",
      "sync",
      `${distPath}/`,
      `s3://${bucket}/`,
      "--delete",
      "--exclude",
      "media/*",
      "--region",
      region,
    ]);
    await saveManifest(manifestPath, current);
    console.log(`Bootstrap manifest saved for ${Object.keys(current.files).length} files.`);
    return;
  }

  const plan = diffManifests(previous, current);
  console.log(
    `Content plan: ${plan.changed.length} changed, `
    + `${plan.removed.length} removed, ${plan.unchanged} unchanged.`,
  );
  if (plan.changed.length === 0 && plan.removed.length === 0) {
    return;
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "site-publish."));
  try {
    if (plan.changed.length > 0) {
      const stagingPath = path.join(temporaryRoot, "changed");
      await mkdir(stagingPath);
      await stageChangedFiles(distPath, plan.changed, stagingPath);
      await run("aws", [
        "s3",
        "cp",
        `${stagingPath}/`,
        `s3://${bucket}/`,
        "--recursive",
        "--region",
        region,
      ]);
    }
    if (plan.removed.length > 0) {
      await deleteRemovedFiles(bucket, region, plan.removed, temporaryRoot);
    }
    await saveManifest(manifestPath, current);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

const main = async () => {
  const [distPath, manifestPath, bucket, region] = process.argv.slice(2);
  if (!distPath || !manifestPath || !bucket || !region) {
    throw new Error(
      "Usage: sync-dist.mjs <dist-path> <manifest-path> <bucket> <region>",
    );
  }
  await publish(
    path.resolve(distPath),
    path.resolve(manifestPath),
    bucket,
    region,
  );
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
