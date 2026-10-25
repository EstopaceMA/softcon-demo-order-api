import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// No HTTP requests, process killing, settings writes, or dependency upgrades.
const root = fileURLToPath(new URL("../", import.meta.url));
const npm = join(
  dirname(process.execPath),
  "../lib/node_modules/npm/bin/npm-cli.js",
);
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const runNpm = (...args) =>
  spawnSync(process.execPath, [npm, ...args], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });

async function requireFreePort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is unavailable. Stop its owner yourself; no existing process was contacted or stopped.`,
        ),
      ),
    );
    server.listen({ port, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function lockedDependenciesAvailable() {
  try {
    const manifest = readJson("package.json");
    const lock = readJson("package-lock.json");
    const installed = readJson("node_modules/.package-lock.json");
    for (const key of ["dependencies", "devDependencies"]) {
      assert.deepEqual(manifest[key], lock.packages[""][key]);
    }
    for (const [path, entry] of Object.entries(installed.packages)) {
      assert.ok(existsSync(join(root, path)));
      for (const key of ["version", "resolved", "integrity"]) {
        assert.equal(entry[key], lock.packages[path]?.[key]);
      }
    }
    return runNpm("ls", "--all", "--json").status === 0;
  } catch {
    return false;
  }
}

try {
  assert.equal(
    process.versions.node.split(".")[0],
    "24",
    "Select Node 24 in workspace settings",
  );
  const version = runNpm("--version");
  assert.equal(version.status, 0, "Selected npm is unavailable");
  assert.match(version.stdout.trim(), /^11\./, "Select npm 11");
  assert.ok(
    process.env.ORDER_API_FUNC,
    "Select Core Tools in workspace settings",
  );
  const func = spawnSync(process.env.ORDER_API_FUNC, ["--version"], {
    encoding: "utf8",
  });
  assert.equal(func.status, 0, "Selected Core Tools executable is unavailable");
  assert.match(func.stdout.trim(), /^4\./, "Select Core Tools v4");
  await requireFreePort(3000);
  await requireFreePort(9229);
  if (lockedDependenciesAvailable()) {
    console.log("Reusing installed, lock-consistent dependencies.");
  } else {
    const install = spawnSync(process.execPath, [npm, "ci"], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    assert.equal(install.status, 0, "Locked dependency installation failed");
    assert.ok(
      lockedDependenciesAvailable(),
      "Installed dependencies do not match the lockfile",
    );
  }
  console.log(
    `Debug prerequisites ready: Node ${process.versions.node}, npm ${version.stdout.trim()}, Core Tools ${func.stdout.trim()}; ports 3000/9229 free.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
