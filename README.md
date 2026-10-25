# Order Management API

TypeScript Azure Functions host v4 / Node.js programming model v4 demo with
exactly four HTTP operations at **http://localhost:3000**, without an `/api`
prefix. The contract is [openapi.yaml](openapi.yaml).

**In-memory demo, not production-durable storage.** Every process starts empty;
there are no fixtures or seed data. Orders disappear on restart and are not shared
between worker processes or scale-out instances. The local settings template uses
one worker, but that does not provide persistence or distributed consistency.
No database, storage SDK, user login, gateway, health/docs endpoint, cloud
infrastructure, migrations, or deployment is included.

## Runtime and tools

Runtime selection was verified on **2026-10-26** against
[Azure Functions supported languages](https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages)
and [Node.js releases](https://nodejs.org/en/about/previous-releases): **Node.js 24
LTS** is the latest LTS major supported by Functions (GA). Node.js 26 is listed as
Current, not the target. Node.js 24 is not supported on the legacy Linux
Consumption hosting plan; this project does not select or provision a hosting plan.

- [.nvmrc](.nvmrc) pins major **24**; [package.json](package.json) requires Node 24
  and npm 11. The available local toolchain is **Node 24.11.1 / npm 11.6.2**.
  Use the latest Node 24 patch for ongoing development and security fixes rather
  than treating 24.11.1 as the recommended current patch.
- **Azure Functions Core Tools v4** is an external prerequisite; `npm start`
  resolves `func` from your PATH. Integration verified **4.16.0**, host runtime
  **4.1054.250.26428**, with Node 24.11.1. The official macOS ARM64 release archive
  was SHA-256 verified and installed separately, leaving the old global **4.0.5907**
  unchanged. Select the current executable on PATH; do not rely on the old global.
  The npm installer is deliberately excluded because its `extract-zip` dependency
  has unpatched advisories. Use an official non-npm installation method.
- **TypeScript 6.0.3** is intentionally paired with **typescript-eslint 8.72.0**,
  whose TypeScript peer range is `>=4.8.4 <6.1.0`. Although TypeScript 7 is latest,
  it is outside the parser's supported range and is not selected here.
- Runtime dependencies are `@azure/functions` and Zod. Compiler, linter, formatter,
  Vitest, V8 coverage, OpenAPI parser, and Ajv are development dependencies. Versions are
  recorded in [package-lock.json](package-lock.json).

## Local setup and use

From the project root:

1. Select Node 24. If nvm is installed, use `nvm use`; use `nvm install 24` first
   if necessary. Check `node --version` and `npm --version` against the ranges above.
2. Run `npm ci` to install the locked project dependencies. Separately ensure a
  current Core Tools v4 is on PATH, using the
  [official installation instructions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local).
  Verify `func --version`; the tested version is 4.16.0. The smoke test verifies
  actual Node 24 compatibility, not merely the presence of a v4 executable.
3. Copy [local.settings.example.json](local.settings.example.json) to
   [local.settings.json](local.settings.json) if no local copy exists. Preserve any
   existing local settings; the file is excluded by [.gitignore](.gitignore).
4. Run `npm start` for local use. Its `prestart` builds the
   TypeScript source, then Core Tools listens on port **3000**. Use Ctrl+C to stop.
5. Use `GET http://localhost:3000/orders` for readiness; do not expect a health or
   documentation endpoint. The OpenAPI contract is a file, not a served route.

[host.json](host.json) uses configuration schema version `2.0`, extension bundle
`[4.*,5.0.0)`, and an empty HTTP route prefix. [tsconfig.json](tsconfig.json)
compiles the root package's source into `dist`; the package entry-point glob is
`dist/functions/*.js`, containing one registration per operation.

## Debugging in VS Code (macOS)

1. Open **Run and Debug** with **Cmd+Shift+D**, select **Order API (debug)**,
   then press **F5**. The single service needs no compound configuration.
2. Set a source breakpoint in [src/functions/listOrders.ts](src/functions/listOrders.ts)
   at the query parsing statement and request `GET http://localhost:3000/orders`.
   Inspect variables, step, then resume. A new host returns an empty list.
3. Save TypeScript edits to recompile. The host restarts its worker and the debugger
   reconnects. **Every worker restart loses all orders.** Compiler errors do not
   emit changed JavaScript; fix errors before relying on edited behavior.
4. Stop debugging with **Shift+F5**. The Functions extension is configured to stop
   its host. Also run **Tasks: Terminate Task** and select
   **softcon-demo-order-api: npm watch** (and test watch if used). Terminate only
   this session's tasks; never kill an arbitrary owner of ports 3000 or 9229.
   Stop the watch task before the next clean F5 session or a smoke run.

[.vscode/launch.json](.vscode/launch.json) attaches to the Node worker, not Core
Tools, using source maps in the compiled output and loopback-only inspector port
9229. [.vscode/tasks.json](.vscode/tasks.json) runs **bootstrap → clean → watch →
Functions host**. Bootstrap checks both ports without contacting their owners,
reuses lock-consistent dependencies or runs `npm ci`, and verifies runtime majors.
Clean removes only TypeScript-owned outputs. Watch uses `--noEmitOnError` and a
`$tsc-watch`-based matcher that releases startup **only after zero errors**. The
required `debug.onTaskErrors: debugAnyway` setting is not evidence of compilation
success: failed prerequisites must be fixed, not bypassed. There is no emulator,
cloud connection, browser debugger, or smoke-test write in the F5 chain.

### Workspace runtime selection

[.vscode/settings.json](.vscode/settings.json) selects the tested **Node 24.11.1 /
npm 11.6.2 / Core Tools 4.16.0** installation on this Mac. It preserves unrelated
settings. The **Order API (Node 24)** integrated-terminal profile starts non-login
zsh without user startup files, so a profile cannot switch child processes to the
old global Node 20. Open a **new terminal** to use this selection; existing terminals
retain their environment. Task executables are explicit and do not depend on the
interactive shell's Node selection.

For another Mac or an updated Node 24 installation, adjust `ORDER_API_NODE_BIN`,
`ORDER_API_FUNC_BIN`, `ORDER_API_FUNC`, and `PATH` under `terminal.integrated.env.osx`,
plus `azureFunctions.funcCliPath`, to installed absolute paths. npm is resolved
relative to the selected Node installation. Do not use `~` or variable expressions
inside `azureFunctions.funcCliPath`. This is a macOS setup, not a tested Windows or
Linux configuration. No global nvm default, shell profile, or npm setting is changed.

### Tests, output, and troubleshooting

Use **Tasks: Run Task** for build, typecheck, lint, formatting, OpenAPI, isolated
tests, coverage, or test watch. `npm test` and `npm run test:watch` never start a
host. The separate **npm test:smoke (owned host)** task must run **after stopping
debugging and watch tasks**; it creates and stops its own fresh host and rejects
an occupied port.

- **Port busy:** stop the known owning application yourself, then retry. Do not
  change port 3000, reuse a shared host, or attach to an unknown inspector.
- **Unbound breakpoint:** check the selected runtime, watch terminal's zero-error
  compilation, generated source maps, and inspector availability. Start from a
  stopped host/watch pair after fixing compiler errors.
- **Output:** compiler and Functions host logs are in their task terminals;
  debugger expression evaluation is in Debug Console. Do not log customer bodies
  or secrets when troubleshooting.
- **Stopping:** automatic host-stop is extension behavior; if it remains running,
  terminate this session's **func host start** task explicitly. Manual watch-task
  termination is intentional; no broad process-kill command is installed.

### Host storage and verification boundary

The intended account-free, HTTP-only local profile deliberately omits
`AzureWebJobsStorage`; it has no storage bindings. **Verified on 2026-10-26** using
Core Tools 4.16.0 and Node 24.11.1: all four unprefixed operations registered on
port 3000, responded correctly, and started empty again after a real host restart.
No Azure account, storage connection, emulator, or container engine was used.
This evidence applies to the tested combination, not every future host version.

If the host requires storage, investigate the actual failure and verify a local
Azurite emulator before declaring success. `UseDevelopmentStorage=true` is only
valid when a working emulator is available. Do not substitute cloud storage,
silently ignore storage failures, or claim a successful run without evidence.
Host storage, if needed, is separate from order storage and must not persist orders.

### Local versus hosted authentication

All four functions register with `authLevel: "function"`. Core Tools disables
authentication locally by default, so the local examples do not need a key.
Default hosted function-level access requires a function key supplied via the
`x-functions-key` header or the `code` query parameter; prefer the header so keys
are not placed in URLs. No keys or user identity flows are implemented here.

The optional hosted-key scheme in [openapi.yaml](openapi.yaml) documents that
difference without requiring a key locally. Any future APIM integration needs a
backend function key and a publicly reachable **HTTPS** backend. No APIM gateway
or hosted deployment is part of this scaffold.

## API

Import [order-api.postman_collection.json](order-api.postman_collection.json) into
Postman to try the deployed API. In the Azure portal, open **softcon-demo-order-api
→ Functions → App keys** and copy the `default` host key. Set the collection's
blank `functionKey` variable to that value before sending requests; each request
has a visible `x-functions-key: {{functionKey}}` header. A key from one function's
**Function keys** tab only authorizes that function. Run **Create order** first; its
post-response script saves the returned `orderId` for **Get order** and **Update
order status**. The collection's `baseUrl` defaults to the deployed demo app and
can be changed for another environment. Do not save a real function key in the
JSON file.

All bodies and responses are JSON. Successful item operations return an `Order`
with `orderId`, `customerName`, `items`, `status`, and `createdAt`. Allowed statuses
are `pending`, `processing`, `shipped`, `delivered`, and `cancelled` (case-sensitive).

- **GET `/orders`**: list all orders; optional `?status=pending` filter.
  Returns 200 with `{orders: Order[], total: number}`.
- **POST `/orders`**: create with a server-generated ID, pending status, and UTC
  timestamp. Returns 201 with `Order`.
- **GET `/orders/{orderId}`**: retrieve an opaque order ID. Returns 200 with `Order`.
- **PATCH `/orders/{orderId}/status`**: update only status, without transition
  restrictions. Returns 200 with `Order`.

- Example create body: `{"customerName":"Example customer","items":[{"name":"Notebook","quantity":2}]}`.
- Example update body: `{"status":"processing"}`. Use the returned `orderId` in
  the route, encoding it as a URL path segment rather than assuming a UUID format.
- An empty list or unmatched filter returns `{"orders":[],"total":0}`. `total`
  always counts the returned, filtered array; there is no pagination or ordering guarantee.
- Customer and item names must be strings, but empty strings and whitespace are
  allowed and preserved. There is no trimming or string-length restriction.
- Create requires at least one item. Each item needs a string `name` and numeric
  integer `quantity >= 1`; numeric strings are not coerced. No maximum quantity or
  safe-integer cap is imposed. JavaScript number precision still applies.
- Unknown request properties are accepted and stripped. Client-provided IDs,
  timestamps, or other server-owned properties are not applied.
- IDs are arbitrary opaque strings; generated IDs default to `crypto.randomUUID()`.
  `createdAt` is assigned once using a UTC ISO timestamp. Status updates, including
  same-status updates, preserve every non-status field.

### Errors and logging

Every application error response has the envelope `{"error":"message"}`:

- **400**: malformed JSON; invalid body or supplied status filter.
  The response is `{"error":"Invalid request"}`. Missing route segments may be
  rejected by the host before a handler runs.
- **404**: a well-formed opaque ID is unknown on get/update;
  `{"error":"Order not found"}`.
- **500**: unexpected application, stream, or internal failures;
  `{"error":"Internal server error"}`. An ID-generator collision fails without
  overwriting an existing order.

Validation finishes before mutation. Only JSON syntax errors are classified as
malformed JSON; other read failures remain unexpected errors. No `422` responses
or additional status-transition rules are introduced.

The central wrapper writes structured `InvocationContext` entries containing only
`operation`, HTTP `status`, `invocationId`, and `duration` (milliseconds), with
severity based on status. Application logs and error responses do not expose
customer data, request bodies, URLs, query strings, exception messages, or stacks.
This describes application logging, not an assurance about independent host telemetry.

## Modules and deterministic seams

- [src/repositories/inMemoryOrderRepository.ts](src/repositories/inMemoryOrderRepository.ts):
  `InMemoryOrderRepository` implements [src/repositories/orderRepository.ts](src/repositories/orderRepository.ts).
  Inputs/outputs are detached deep copies; inserts reject duplicates; status
  read/modify/write runs synchronously in one process.
- [src/services/orderService.ts](src/services/orderService.ts): `OrderService`
  accepts a repository, `OrderIdGenerator` (`() => string`), and `Clock`
  (`() => Date`). Its `list(query)`, `get(orderId)`, `create(payload)`, and
  `updateStatus(orderId, payload)` validate unknown input using the canonical
  [src/domain/validation.ts](src/domain/validation.ts) schemas.
- [src/composition.ts](src/composition.ts): `createOrderService(options)` creates
  an independent instance with optional `repository`, `generateId`, and `clock`.
  Each default factory call owns an empty store. The exported `orderService` is
  initialized exactly once by the module and shared by all production handlers.
- [src/http/responses.ts](src/http/responses.ts): `jsonResponse`, `jsonError`,
  `handleError`, `readJsonBody`, and `withHttpHandling` centralize HTTP behavior.
- Injectable factories `createListOrdersHandler`, `createCreateOrderHandler`,
  `createGetOrderHandler`, and `createUpdateOrderStatusHandler` reside respectively
  in [src/functions/listOrders.ts](src/functions/listOrders.ts),
  [src/functions/createOrder.ts](src/functions/createOrder.ts),
  [src/functions/getOrder.ts](src/functions/getOrder.ts), and
  [src/functions/updateOrderStatus.ts](src/functions/updateOrderStatus.ts).
  Each takes `Pick<OrderService, "list" | "create" | "get" | "updateStatus">`
  narrowed to its single operation, not a concrete repository or global registry.
  Their returned handlers accept a request and invocation context. Importing a
  function module also calls `app.http`; isolated handler tests should mock that
  registration and pass their own service rather than modifying the shared instance.

## Verification

Available isolated checks (no running host, emulator, or Azure account required):

- `npm run build`: strict source compilation and generation of Functions entry points.
- `npm run typecheck`: source and test type-check without output.
- `npm run lint`: ESLint checks for production source, tests, and Vitest configuration.
- `npm run format:check`: Prettier checks for source, tests, configuration, scripts, and OpenAPI.
- `npm test`: 513 isolated repository/service/schema, handler, and contract tests.
- `npm run test:coverage`: the same suite with V8 coverage (100% statements,
  branches, functions, and lines across executable production source on 2026-10-26).
- `npm run validate:openapi`: validate the on-disk OpenAPI 3.0.3 document,
  exact four method/path pairs, and local server URL.

[scripts/validate-openapi.cjs](scripts/validate-openapi.cjs) uses the installed
Swagger Parser and resolves the contract relative to itself. It does not start
the host or assert that live responses conform to the document.

Tests use real Functions SDK requests/responses and invocation contexts, with only
`app.http` registration mocked. Each test owns isolated services, repositories,
clocks, and IDs. Request acceptance is compared with Zod and OpenAPI schemas;
actual serialized handler responses are checked against each operation/status
schema using Ajv. Coverage includes all 25 status transitions, permissive strings
and extra properties, failed-write atomicity, deep-copy isolation, generic 500s,
and allowlisted logging. Coverage is evidence, not a guarantee of correctness.

### Opt-in real-host smoke test

Run `npm run test:smoke` with Node 24 and current Core Tools selected. Unlike the
isolated suite, this builds and **starts its own host**, sends temporary requests,
restarts it to prove state loss, and stops its process tree afterward. Stop any
manual host first: it refuses an occupied port 3000 rather than using or killing
another process. The base URL is fixed to `http://localhost:3000`; URL arguments
and redirects are rejected. It never targets hosted/shared endpoints.

[scripts/smoke-test.mjs](scripts/smoke-test.mjs) resolves `func` from PATH, or uses
the executable path in `ORDER_API_FUNC` (not a URL). For this machine the verified
archive is in the home directory under `.local/share/softcon-tools/core-tools-4.16.0`;
select that directory on PATH for `npm start`, or its executable for `ORDER_API_FUNC`.
The runner requires [local.settings.json](local.settings.json) values matching the
HTTP-only [template](local.settings.example.json) and refuses inherited storage
or Application Insights connections. It does not overwrite local settings.

Integration passed **37 operation-specific contract-checked HTTP requests**:
empty list, two creations, unique IDs, lookup, every status and repeated update,
filters/totals, malformed/invalid bodies, missing IDs, and unchanged state after
failed writes. After restart the list was empty and an earlier ID returned 404.
Both owned hosts stopped and port 3000 was released. See
[.azure/integration-plan.md](.azure/integration-plan.md) for evidence and boundaries.

Build, source/test type checks, lint, format, OpenAPI, isolated tests, and smoke
checks passed; npm audit reported **0 vulnerabilities**. No database migrations,
startup data, frontend, provisioning, or deployment were needed or performed.
