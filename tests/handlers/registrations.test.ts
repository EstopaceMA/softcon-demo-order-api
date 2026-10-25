import { readFile, readdir } from "node:fs/promises";
import { app } from "@azure/functions";
import { expect, it, vi } from "vitest";

it("registers exactly four function-auth operations on unprefixed routes", async () => {
  // Observe fresh module side effects inside the test, after mock lifecycle setup.
  vi.resetModules();
  vi.mocked(app.http).mockClear();
  await Promise.all([
    import("../../src/functions/createOrder"),
    import("../../src/functions/getOrder"),
    import("../../src/functions/listOrders"),
    import("../../src/functions/updateOrderStatus"),
  ]);
  const files = await readdir(new URL("../../src/functions/", import.meta.url));
  expect(files.filter((name) => name.endsWith(".ts")).sort()).toEqual([
    "createOrder.ts",
    "getOrder.ts",
    "listOrders.ts",
    "updateOrderStatus.ts",
  ]);
  const registrations = vi.mocked(app.http).mock.calls;
  expect(registrations).toHaveLength(4);
  expect(
    registrations.map(([name, options]) => ({
      name,
      methods: options.methods,
      route: options.route,
      authLevel: options.authLevel,
      handler: options.handler,
    })),
  ).toEqual(
    expect.arrayContaining([
      {
        name: "createOrder",
        methods: ["POST"],
        route: "orders",
        authLevel: "function",
        handler: expect.any(Function),
      },
      {
        name: "listOrders",
        methods: ["GET"],
        route: "orders",
        authLevel: "function",
        handler: expect.any(Function),
      },
      {
        name: "getOrder",
        methods: ["GET"],
        route: "orders/{orderId}",
        authLevel: "function",
        handler: expect.any(Function),
      },
      {
        name: "updateOrderStatus",
        methods: ["PATCH"],
        route: "orders/{orderId}/status",
        authLevel: "function",
        handler: expect.any(Function),
      },
    ]),
  );
  const host: unknown = JSON.parse(
    await readFile(new URL("../../host.json", import.meta.url), "utf8"),
  );
  expect(host).toMatchObject({ extensions: { http: { routePrefix: "" } } });
});
