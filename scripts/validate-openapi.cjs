const assert = require("node:assert/strict");
const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");

async function validateOpenApi() {
  const document = await SwaggerParser.validate(
    path.resolve(__dirname, "../openapi.yaml"),
    { resolve: { external: false } },
  );

  assert.equal(document.openapi, "3.0.3", "OpenAPI version must remain 3.0.3");
  assert.deepEqual(
    document.servers.map((server) => server.url),
    ["http://localhost:3000"],
    "The server must be the unprefixed local endpoint",
  );

  const methods = new Set([
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "options",
    "head",
    "trace",
  ]);
  const inventory = Object.entries(document.paths).flatMap(([route, item]) =>
    Object.keys(item)
      .filter((method) => methods.has(method))
      .map((method) => `${method.toUpperCase()} ${route}`),
  );
  assert.deepEqual(
    Object.keys(document.paths).sort(),
    ["/orders", "/orders/{orderId}", "/orders/{orderId}/status"].sort(),
    "Only the three approved paths are allowed",
  );
  assert.deepEqual(
    inventory.sort(),
    [
      "GET /orders",
      "POST /orders",
      "GET /orders/{orderId}",
      "PATCH /orders/{orderId}/status",
    ].sort(),
    "Exactly the four approved operations are required",
  );

  console.log(
    "OpenAPI 3.0.3 valid: exactly four operations at http://localhost:3000",
  );
}

validateOpenApi().catch((error) => {
  console.error("OpenAPI validation failed:", error);
  process.exitCode = 1;
});
