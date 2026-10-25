import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv from "ajv";
import addFormats from "ajv-formats";

// Intentionally no URL argument: this mutating check owns a fresh local host.
const root = fileURLToPath(new URL("../", import.meta.url));
const baseUrl = "http://localhost:3000";
const func = process.env.ORDER_API_FUNC || "func";
const statuses = ["pending", "processing", "shipped", "delivered", "cancelled"];
const registrations = [
  ["createOrder", "POST", "/orders"],
  ["getOrder", "GET", "/orders/{orderId}"],
  ["listOrders", "GET", "/orders"],
  ["updateOrderStatus", "PATCH", "/orders/{orderId}/status"],
];
let activeHost;
let shuttingDown;
let requests = 0;

async function requireFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error("Port 3000 is unavailable; refusing to use another host"),
      ),
    );
    server.listen({ port: 3000, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function killGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    if (child.exitCode === null) {
      const result = spawnSync("taskkill", [
        "/pid",
        String(child.pid),
        "/t",
        "/f",
      ]);
      assert.equal(
        result.status,
        0,
        "Could not stop the owned host process tree",
      );
    }
  } else {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

async function stopHost() {
  if (!activeHost) return;
  if (shuttingDown) return shuttingDown;
  const host = activeHost;
  shuttingDown = (async () => {
    killGroup(host.child, "SIGTERM");
    const timer = setTimeout(() => killGroup(host.child, "SIGKILL"), 10_000);
    try {
      await host.closed;
    } finally {
      clearTimeout(timer);
      killGroup(host.child, "SIGKILL");
      activeHost = undefined;
    }
    await requireFreePort();
    console.log("Owned Functions host stopped; port 3000 released.");
  })();
  try {
    await shuttingDown;
  } finally {
    shuttingDown = undefined;
  }
}

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, () => {
    void stopHost().finally(() => process.exit(code));
  });
}

async function startHost() {
  await requireFreePort();
  const child = spawn(func, ["start", "--port", "3000"], {
    cwd: root,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      FUNCTIONS_WORKER_RUNTIME: "node",
      FUNCTIONS_WORKER_PROCESS_COUNT: "1",
      AZURE_FUNCTIONS_ENVIRONMENT: "Development",
      FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT: "1",
    },
  });
  const host = { child, output: "", error: undefined, exited: false };
  host.closed = new Promise((resolve) => {
    child.once("error", (error) => {
      host.error = error;
    });
    child.once("close", () => {
      host.exited = true;
      resolve();
    });
  });
  activeHost = host;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      host.output = (host.output + chunk.toString()).slice(-150_000);
    });
  }
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (host.error) throw host.error;
    assert.equal(host.exited, false, "Functions host exited before readiness");
    const discovered = registrations.every(([name, method, route]) =>
      host.output.includes(`${name}: [${method}] ${baseUrl}${route}`),
    );
    if (discovered) {
      try {
        const response = await fetch(`${baseUrl}/orders`, {
          signal: AbortSignal.timeout(2_000),
          redirect: "error",
        });
        if (response.status === 200) {
          assert.deepEqual(await response.json(), { orders: [], total: 0 });
          assert.equal(host.exited, false);
          for (const [name, method, route] of registrations) {
            console.log(`Registered ${name}: ${method} ${route}`);
          }
          const runtime = host.output.match(/Function Runtime Version:.*$/m);
          if (runtime) console.log(runtime[0].trim());
          console.log("Fresh process ready: GET /orders = 200, empty store.");
          return;
        }
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
    }
    await delay(200);
  }
  throw new Error(
    "Functions host did not register all routes and become ready",
  );
}

async function main() {
  assert.equal(
    process.versions.node.split(".")[0],
    "24",
    "Select Node 24 first",
  );
  assert.equal(
    process.argv.length,
    2,
    "Smoke test does not accept URL arguments",
  );
  let settings;
  try {
    settings = JSON.parse(await readFile(join(root, "local.settings.json")));
  } catch {
    throw new Error("Cannot read valid local settings for the smoke test");
  }
  const expectedSettings = {
    FUNCTIONS_WORKER_RUNTIME: "node",
    AZURE_FUNCTIONS_ENVIRONMENT: "Development",
    FUNCTIONS_WORKER_PROCESS_COUNT: "1",
  };
  assert.ok(
    settings?.IsEncrypted === false &&
      Object.keys(settings.Values ?? {}).length === 3 &&
      Object.entries(expectedSettings).every(
        ([key, value]) => settings.Values?.[key] === value,
      ),
    "Smoke test requires the isolated HTTP-only local settings template",
  );
  for (const key of Object.keys(process.env)) {
    assert.ok(
      !/^(AzureWebJobsStorage($|__)|APPLICATIONINSIGHTS_CONNECTION_STRING$|APPINSIGHTS_INSTRUMENTATIONKEY$)/i.test(
        key,
      ),
      "Smoke test refuses inherited storage or telemetry connections",
    );
  }
  await requireFreePort();
  const version = spawnSync(func, ["--version"], { encoding: "utf8" });
  assert.equal(
    version.status,
    0,
    "Set ORDER_API_FUNC to a current Core Tools v4 executable",
  );
  assert.match(version.stdout.trim(), /^4\./);
  console.log(
    `Node ${process.versions.node}; Core Tools ${version.stdout.trim()}`,
  );
  const files = (await readdir(join(root, "dist/functions")))
    .filter((name) => name.endsWith(".js"))
    .sort();
  assert.deepEqual(files, registrations.map(([name]) => `${name}.js`).sort());
  const document = await SwaggerParser.dereference(join(root, "openapi.yaml"));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  async function request(
    method,
    path,
    expected,
    operationPath = path,
    payload,
    raw,
  ) {
    assert.ok(activeHost && !activeHost.exited, "Owned host is not running");
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(payload === undefined && raw === undefined
        ? {}
        : { body: raw ?? JSON.stringify(payload) }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    assert.equal(response.status, expected, `${method} ${operationPath}`);
    assert.match(response.headers.get("content-type"), /application\/json/);
    const body = await response.json();
    const schema =
      document.paths[operationPath][method.toLowerCase()].responses[
        String(expected)
      ].content["application/json"].schema;
    const validate = ajv.compile(schema);
    assert.ok(
      validate(body),
      `Response contract mismatch: ${method} ${operationPath}`,
    );
    requests++;
    console.log(`PASS ${method} ${operationPath} -> ${expected}`);
    return body;
  }

  await startHost();
  assert.deepEqual(await request("GET", "/orders", 200), {
    orders: [],
    total: 0,
  });
  const payload = { customerName: "", items: [{ name: " ", quantity: 2 }] };
  const first = await request("POST", "/orders", 201, "/orders", {
    ...payload,
    orderId: "ignored",
    createdAt: "ignored",
    status: "shipped",
  });
  assert.deepEqual(first, {
    ...payload,
    orderId: first.orderId,
    createdAt: first.createdAt,
    status: "pending",
  });
  assert.ok(first.orderId.length > 0);
  assert.equal(new Date(first.createdAt).toISOString(), first.createdAt);
  const second = await request("POST", "/orders", 201, "/orders", payload);
  assert.notEqual(first.orderId, second.orderId);
  const itemPath = `/orders/${encodeURIComponent(first.orderId)}`;
  assert.deepEqual(
    await request("GET", itemPath, 200, "/orders/{orderId}"),
    first,
  );
  for (const status of statuses) {
    const updated = await request(
      "PATCH",
      `${itemPath}/status`,
      200,
      "/orders/{orderId}/status",
      { status },
    );
    assert.deepEqual(updated, { ...first, status });
    const repeated = await request(
      "PATCH",
      `${itemPath}/status`,
      200,
      "/orders/{orderId}/status",
      { status },
    );
    assert.deepEqual(repeated, updated);
    const filtered = await request(
      "GET",
      `/orders?status=${status}`,
      200,
      "/orders",
    );
    assert.equal(filtered.total, status === "pending" ? 2 : 1);
    assert.equal(filtered.total, filtered.orders.length);
    assert.ok(filtered.orders.every((order) => order.status === status));
  }
  assert.deepEqual(
    await request("GET", "/orders?status=shipped", 200, "/orders"),
    { orders: [], total: 0 },
  );
  const before = await request("GET", "/orders", 200);
  for (const invalid of [
    null,
    [],
    {},
    { ...payload, items: [] },
    { ...payload, items: [{ name: "", quantity: 0 }] },
  ]) {
    await request("POST", "/orders", 400, "/orders", invalid);
  }
  await request("POST", "/orders", 400, "/orders", undefined, "{");
  for (const invalid of [null, {}, { status: "unknown" }]) {
    await request(
      "PATCH",
      `${itemPath}/status`,
      400,
      "/orders/{orderId}/status",
      invalid,
    );
  }
  await request(
    "PATCH",
    `${itemPath}/status`,
    400,
    "/orders/{orderId}/status",
    undefined,
    "{",
  );
  await request("GET", "/orders?status=unknown", 400, "/orders");
  await request("GET", "/orders/missing-opaque-id", 404, "/orders/{orderId}");
  await request(
    "PATCH",
    "/orders/missing-opaque-id/status",
    404,
    "/orders/{orderId}/status",
    { status: "pending" },
  );
  assert.deepEqual(await request("GET", "/orders", 200), before);
  await stopHost();
  await startHost();
  assert.deepEqual(await request("GET", "/orders", 200), {
    orders: [],
    total: 0,
  });
  await request("GET", itemPath, 404, "/orders/{orderId}");
  console.log(
    `PASS: ${requests} contract-checked HTTP requests; restart discarded orders.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  if (activeHost) {
    // Only expose startup diagnostics, never arbitrary host output or HTTP bodies.
    for (const line of activeHost.output.split("\n")) {
      if (
        /No job functions found|ERR_MODULE_NOT_FOUND|Worker failed to start|Port 3000 is unavailable/.test(
          line,
        )
      ) {
        console.error(line);
      }
    }
  }
  process.exitCode = 1;
} finally {
  await stopHost();
}
