import { describe, expect, it } from "vitest";
import { createCreateOrderHandler } from "../../src/functions/createOrder";
import {
  invoke,
  makeContext,
  makeHandlers,
  makePayload,
  makeRequest,
  required,
} from "../helpers";

describe("allowlisted invocation logging", () => {
  it.each([
    { scenario: "success", status: 201, level: "information" },
    { scenario: "validation", status: 400, level: "warning" },
    { scenario: "missing", status: 404, level: "warning" },
    { scenario: "unexpected", status: 500, level: "error" },
  ])(
    "logs only metadata for $scenario",
    async ({ scenario, status, level }) => {
      const handlers = makeHandlers();
      const { context, logs } = makeContext();
      const privateText = "PRIVATE_CUSTOMER_BODY_TOKEN_SETTINGS_STACK";
      const request = makeRequest("POST", `/orders?code=${privateText}`, {
        ...makePayload(),
        customerName: privateText,
        items: [
          { name: privateText, quantity: scenario === "validation" ? 0 : 1 },
        ],
        secret: privateText,
      });
      request.headers.set("authorization", `Bearer ${privateText}`);
      request.headers.set("x-functions-key", privateText);
      context.triggerMetadata = { privateText };
      let handler = handlers.create;
      let operation = "createOrder";
      let actualRequest = request;
      if (scenario === "unexpected") {
        handler = createCreateOrderHandler({
          create: () => {
            throw new Error(privateText);
          },
        });
      } else if (scenario === "missing") {
        handler = handlers.get;
        operation = "getOrder";
        actualRequest = makeRequest(
          "GET",
          `/orders/${privateText}?code=${privateText}`,
          undefined,
          { orderId: privateText },
        );
      }
      const response = await invoke(handler, actualRequest, context);
      expect(response.status).toBe(status);
      expect(logs).toHaveLength(1);
      expect(required(logs[0]).level).toBe(level);
      expect(required(logs[0]).args).toEqual([
        {
          operation,
          status,
          invocationId: context.invocationId,
          duration: expect.any(Number),
        },
      ]);
      const entry = required(logs[0]).args[0];
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("duration" in entry) ||
        typeof entry.duration !== "number"
      ) {
        throw new Error("Expected structured invocation metadata");
      }
      expect(typeof entry.duration).toBe("number");
      expect(Number.isFinite(entry.duration)).toBe(true);
      expect(entry.duration).toBeGreaterThanOrEqual(0);
      expect(Object.keys(entry).sort()).toEqual([
        "duration",
        "invocationId",
        "operation",
        "status",
      ]);
      expect(JSON.stringify(logs)).not.toContain(privateText);
      if (status >= 400)
        expect(JSON.stringify(response.body)).not.toContain(privateText);
    },
  );

  it("logger failures cannot invalidate committed create or status writes", async () => {
    const handlers = makeHandlers();
    const { context, logs } = makeContext(true);
    const created = await invoke(
      handlers.create,
      makeRequest("POST", "/orders", makePayload()),
      context,
    );
    expect(created.status).toBe(201);
    expect(handlers.service.get("ORD-1")).toEqual(created.body);
    const updated = await invoke(
      handlers.update,
      makeRequest(
        "PATCH",
        "/orders/ORD-1/status",
        { status: "shipped" },
        { orderId: "ORD-1" },
      ),
      context,
    );
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({
      ...handlers.service.get("ORD-1"),
      status: "shipped",
    });
    expect(handlers.service.get("ORD-1").status).toBe("shipped");
    expect(handlers.service.list().total).toBe(1);
    expect(logs).toHaveLength(2);
  });

  it("throwing warning and error loggers do not replace error responses", async () => {
    const { context } = makeContext(true);
    const handlers = makeHandlers();
    const invalid = await invoke(
      handlers.create,
      makeRequest("POST", "/orders", {}),
      context,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: "Invalid request" });
    const failure = await invoke(
      createCreateOrderHandler({
        create: () => {
          throw new Error("private");
        },
      }),
      makeRequest("POST", "/orders", makePayload()),
      context,
    );
    expect(failure.status).toBe(500);
    expect(failure.body).toEqual({ error: "Internal server error" });
  });
});
