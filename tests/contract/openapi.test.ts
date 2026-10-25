import SwaggerParser from "@apidevtools/swagger-parser";
import { HttpRequest } from "@azure/functions";
import type { OpenAPIV3 } from "openapi-types";
import { beforeAll, describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "../../src/domain/order";
import {
  createOrderSchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  updateOrderStatusSchema,
} from "../../src/domain/validation";
import { createCreateOrderHandler } from "../../src/functions/createOrder";
import { createGetOrderHandler } from "../../src/functions/getOrder";
import { createListOrdersHandler } from "../../src/functions/listOrders";
import { createUpdateOrderStatusHandler } from "../../src/functions/updateOrderStatus";
import {
  invalidCreateCases,
  invalidFilters,
  invalidUpdateCases,
  invoke,
  makeHandlers,
  makePayload,
  makeRequest,
  required,
  transitions,
  validCreateCases,
} from "../helpers";
import {
  contractPath,
  loadContract,
  operations,
  resolved,
  schema,
} from "./openapi";

let contract: Awaited<ReturnType<typeof loadContract>>;

beforeAll(async () => {
  contract = await loadContract();
});

describe("OpenAPI structure", () => {
  it("validates as OpenAPI and keeps exactly four local operations", async () => {
    await expect(SwaggerParser.validate(contractPath)).resolves.toBeDefined();
    expect(contract.document.openapi).toBe("3.0.3");
    expect(contract.document.servers?.map((server) => server.url)).toEqual([
      "http://localhost:3000",
    ]);
    expect(contract.document.security).toEqual([]);
    expect(Object.keys(contract.document.paths).sort()).toEqual([
      "/orders",
      "/orders/{orderId}",
      "/orders/{orderId}/status",
    ]);
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
    const actual = Object.entries(contract.document.paths).flatMap(
      ([path, item]) =>
        Object.keys(required(item))
          .filter((method) => methods.has(method))
          .map((method) => `${method} ${path}`),
    );
    expect(actual.sort()).toEqual(
      operations.map(({ path, method }) => `${method} ${path}`).sort(),
    );
    for (const { path, method, id, statuses } of operations) {
      const operation = contract.operation(path, method);
      expect(operation.operationId).toBe(id);
      expect(Object.keys(operation.responses).sort()).toEqual(
        statuses.map(String).sort(),
      );
    }
  });

  it("uses real YAML booleans for request/parameter required flags", () => {
    for (const method of ["post", "patch"] as const) {
      const path = method === "post" ? "/orders" : "/orders/{orderId}/status";
      const body = resolved<OpenAPIV3.RequestBodyObject>(
        contract.operation(path, method).requestBody,
      );
      expect(body.required).toBe(true);
      expect(typeof body.required).toBe("boolean");
    }
    const filter = resolved<OpenAPIV3.ParameterObject>(
      contract.operation("/orders", "get").parameters?.[0],
    );
    expect(filter).toMatchObject({
      name: "status",
      in: "query",
      required: false,
    });
    expect(typeof filter.required).toBe("boolean");
    for (const path of ["/orders/{orderId}", "/orders/{orderId}/status"]) {
      const parameter = resolved<OpenAPIV3.ParameterObject>(
        contract.document.paths[path]?.parameters?.[0],
      );
      expect(parameter).toMatchObject({
        name: "orderId",
        in: "path",
        required: true,
      });
      expect(typeof parameter.required).toBe("boolean");
      expect(schema(parameter.schema)).toEqual({ type: "string" });
    }
  });

  it("keeps required arrays, enum, cardinality and quantity constraints", () => {
    const schemas = required(contract.document.components?.schemas);
    const requirements: Record<string, string[]> = {
      OrderItem: ["name", "quantity"],
      CreateOrder: ["customerName", "items"],
      UpdateOrderStatus: ["status"],
      Order: ["orderId", "customerName", "items", "status", "createdAt"],
      OrderList: ["orders", "total"],
      Error: ["error"],
    };
    for (const [name, fields] of Object.entries(requirements)) {
      const definition = schema(schemas[name]);
      expect(Array.isArray(definition.required)).toBe(true);
      expect(definition.required).toEqual(fields);
      expect(definition.additionalProperties).not.toBe(false);
    }
    expect(schema(schemas.OrderStatus)).toEqual({
      type: "string",
      enum: [...ORDER_STATUSES],
    });
    const create = schema(schemas.CreateOrder);
    const item = schema(schemas.OrderItem);
    const items = schema(create.properties?.items);
    expect(items.type).toBe("array");
    expect(items.minItems).toBe(1);
    if (items.type !== "array") throw new Error("Expected array schema");
    expect(schema(items.items)).toEqual(item);
    expect(schema(item.properties?.quantity)).toEqual({
      type: "integer",
      minimum: 1,
    });
    expect(schema(item.properties?.name)).toEqual({ type: "string" });
    expect(schema(create.properties?.customerName)).toEqual({ type: "string" });
    expect(schema(schema(schemas.Order).properties?.createdAt)).toEqual({
      type: "string",
      format: "date-time",
    });
  });
});

describe("operation-level request validation and actual HTTP emissions", () => {
  it.each(validCreateCases())(
    "accepts create in OpenAPI, Zod and HTTP: $name",
    async ({ payload, parsed }) => {
      const validate = contract.ajv.compile(
        contract.requestSchema("/orders", "post"),
      );
      expect(validate(payload), contract.ajv.errorsText(validate.errors)).toBe(
        true,
      );
      expect(createOrderSchema.parse(payload)).toEqual(parsed);
      const handlers = makeHandlers();
      const response = await invoke(
        handlers.create,
        makeRequest("POST", "/orders", payload),
      );
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        ...parsed,
        orderId: "ORD-1",
        status: "pending",
        createdAt: "2026-10-26T03:04:05.678Z",
      });
      contract.assertResponse("/orders", "post", response);
    },
  );

  it.each(invalidCreateCases())(
    "rejects create in OpenAPI, Zod and HTTP: $name",
    async ({ payload }) => {
      const validate = contract.ajv.compile(
        contract.requestSchema("/orders", "post"),
      );
      expect(validate(payload)).toBe(false);
      expect(createOrderSchema.safeParse(payload).success).toBe(false);
      const handlers = makeHandlers();
      handlers.service.create(makePayload());
      const before = handlers.service.list();
      const response = await invoke(
        handlers.create,
        makeRequest("POST", "/orders", payload),
      );
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid request" });
      contract.assertResponse("/orders", "post", response);
      expect(handlers.service.list()).toEqual(before);
    },
  );

  it.each(invalidUpdateCases())(
    "rejects update in OpenAPI, Zod and HTTP: $name",
    async ({ payload }) => {
      const validate = contract.ajv.compile(
        contract.requestSchema("/orders/{orderId}/status", "patch"),
      );
      expect(validate(payload)).toBe(false);
      expect(updateOrderStatusSchema.safeParse(payload).success).toBe(false);
      const handlers = makeHandlers();
      const order = handlers.service.create(makePayload());
      const before = handlers.service.list();
      const response = await invoke(
        handlers.update,
        makeRequest("PATCH", `/orders/${order.orderId}/status`, payload, {
          orderId: order.orderId,
        }),
      );
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid request" });
      contract.assertResponse("/orders/{orderId}/status", "patch", response);
      expect(handlers.service.list()).toEqual(before);
    },
  );

  it.each(transitions)(
    "accepts the full update contract: $from → $to",
    async ({ from, to }) => {
      const payload = {
        status: to,
        customerName: "ignored",
        orderId: "ignored",
        items: [],
        createdAt: "ignored",
      };
      const validate = contract.ajv.compile(
        contract.requestSchema("/orders/{orderId}/status", "patch"),
      );
      expect(validate(payload)).toBe(true);
      expect(updateOrderStatusSchema.parse(payload)).toEqual({ status: to });
      const handlers = makeHandlers();
      const created = handlers.service.create(makePayload());
      const before = handlers.service.updateStatus(created.orderId, {
        status: from,
      });
      const response = await invoke(
        handlers.update,
        makeRequest("PATCH", `/orders/${created.orderId}/status`, payload, {
          orderId: created.orderId,
        }),
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ...before, status: to });
      contract.assertResponse("/orders/{orderId}/status", "patch", response);
    },
  );

  it.each([...ORDER_STATUSES, ...invalidFilters])(
    "query schema agrees with HTTP filter %j",
    async (status) => {
      const parameter = resolved<OpenAPIV3.ParameterObject>(
        contract.operation("/orders", "get").parameters?.[0],
      );
      const validate = contract.ajv.compile(schema(parameter.schema));
      const accepted = listOrdersQuerySchema.safeParse({ status }).success;
      expect(validate(status)).toBe(accepted);
      const handlers = makeHandlers();
      const order = handlers.service.create(makePayload());
      const response = await invoke(
        handlers.list,
        makeRequest("GET", `/orders?status=${encodeURIComponent(status)}`),
      );
      expect(response.status).toBe(accepted ? 200 : 400);
      if (!accepted)
        expect(response.body).toEqual({ error: "Invalid request" });
      else
        expect(response.body).toEqual(
          status === "pending"
            ? { orders: [order], total: 1 }
            : { orders: [], total: 0 },
        );
      contract.assertResponse("/orders", "get", response);
    },
  );

  it.each(["", " ", "opaque:not-a-uuid", "ORD-1001"])(
    "path schema accepts opaque ID %j",
    (orderId) => {
      const parameter = resolved<OpenAPIV3.ParameterObject>(
        contract.document.paths["/orders/{orderId}"]?.parameters?.[0],
      );
      const validate = contract.ajv.compile(schema(parameter.schema));
      expect(validate(orderId)).toBe(true);
      expect(orderIdParamsSchema.parse({ orderId })).toEqual({ orderId });
    },
  );

  it("validates empty, populated and lookup response bodies", async () => {
    const handlers = makeHandlers();
    const empty = await invoke(handlers.list, makeRequest("GET"));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ orders: [], total: 0 });
    contract.assertResponse("/orders", "get", empty);
    const order = handlers.service.create(makePayload());
    const populated = await invoke(handlers.list, makeRequest("GET"));
    expect(populated.status).toBe(200);
    expect(populated.body).toEqual({ orders: [order], total: 1 });
    contract.assertResponse("/orders", "get", populated);
    const found = await invoke(
      handlers.get,
      makeRequest("GET", `/orders/${order.orderId}`, undefined, {
        orderId: order.orderId,
      }),
    );
    expect(found.status).toBe(200);
    expect(found.body).toEqual(order);
    contract.assertResponse("/orders/{orderId}", "get", found);
  });

  it("validates both actual missing-ID 404 responses", async () => {
    const handlers = makeHandlers();
    const get = await invoke(
      handlers.get,
      makeRequest("GET", "/orders/missing", undefined, { orderId: "missing" }),
    );
    const update = await invoke(
      handlers.update,
      makeRequest(
        "PATCH",
        "/orders/missing/status",
        { status: "shipped" },
        { orderId: "missing" },
      ),
    );
    expect(get.status).toBe(404);
    expect(update.status).toBe(404);
    expect(get.body).toEqual({ error: "Order not found" });
    expect(update.body).toEqual({ error: "Order not found" });
    contract.assertResponse("/orders/{orderId}", "get", get);
    contract.assertResponse("/orders/{orderId}/status", "patch", update);
  });

  it.each(["post", "patch"] as const)(
    "validates malformed JSON and stream errors on %s",
    async (method) => {
      const handlers = makeHandlers();
      const order = handlers.service.create(makePayload());
      const handler = method === "post" ? handlers.create : handlers.update;
      const path = method === "post" ? "/orders" : "/orders/{orderId}/status";
      const badJson = new HttpRequest({
        method: method.toUpperCase(),
        url: "http://localhost:3000/orders",
        params: { orderId: order.orderId },
        body: { string: "{" },
      });
      const invalid = await invoke(handler, badJson);
      expect(invalid.status).toBe(400);
      expect(invalid.body).toEqual({ error: "Invalid request" });
      contract.assertResponse(path, method, invalid);
      const stream = makeRequest(
        method === "post" ? "POST" : "PATCH",
        "/orders",
        makePayload(),
        { orderId: order.orderId },
      );
      await required(stream.body).cancel(
        new Error("private transport details"),
      );
      const failure = await invoke(handler, stream);
      expect(failure.status).toBe(500);
      expect(failure.body).toEqual({ error: "Internal server error" });
      contract.assertResponse(path, method, failure);
      expect(handlers.service.list()).toEqual({ orders: [order], total: 1 });
    },
  );

  it.each(operations)(
    "validates generic500 for $id's exact response schema",
    async ({ path, method, id }) => {
      const fail = () => {
        throw new Error("private dependency failure");
      };
      const handlers = {
        createOrder: createCreateOrderHandler({ create: fail }),
        listOrders: createListOrdersHandler({ list: fail }),
        getOrder: createGetOrderHandler({ get: fail }),
        updateOrderStatus: createUpdateOrderStatusHandler({
          updateStatus: fail,
        }),
      };
      const request = makeRequest(
        method === "post" ? "POST" : method === "patch" ? "PATCH" : "GET",
        "/orders",
        method === "post"
          ? makePayload()
          : method === "patch"
            ? { status: "shipped" }
            : undefined,
        { orderId: "opaque" },
      );
      const response = await invoke(handlers[id], request);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal server error" });
      contract.assertResponse(path, method, response);
    },
  );

  it("Ajv actually rejects missing response fields and invalid date-time formats", () => {
    const order = makeHandlers().service.create(makePayload());
    expect(() =>
      contract.assertResponse("/orders", "post", {
        status: 201,
        body: { ...order, createdAt: "not-a-date" },
      }),
    ).toThrow();
    expect(() =>
      contract.assertResponse("/orders/{orderId}", "get", {
        status: 200,
        body: { status: "pending" },
      }),
    ).toThrow();
    expect(() =>
      contract.assertResponse("/orders", "get", {
        status: 400,
        body: { error: { message: "wrong envelope" } },
      }),
    ).toThrow();
  });
});
