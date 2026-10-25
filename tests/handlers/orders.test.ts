import { HttpRequest, InvocationContext } from "@azure/functions";
import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "../../src/domain/order";
import { createCreateOrderHandler } from "../../src/functions/createOrder";
import { createGetOrderHandler } from "../../src/functions/getOrder";
import { createListOrdersHandler } from "../../src/functions/listOrders";
import { createUpdateOrderStatusHandler } from "../../src/functions/updateOrderStatus";
import type { RequestHandler } from "../../src/http/responses";
import {
  CREATED_AT,
  invalidCreateCases,
  invalidFilters,
  invalidUpdateCases,
  invoke,
  makeContext,
  makeHandlers,
  makePayload,
  makeRequest,
  makeService,
  required,
  transitions,
  validCreateCases,
} from "../helpers";

describe("real-SDK order handlers with per-test services", () => {
  it("uses real request/context objects and emits an empty JSON list", async () => {
    const { list } = makeHandlers();
    const request = makeRequest("GET");
    const { context } = makeContext();
    expect(request).toBeInstanceOf(HttpRequest);
    expect(context).toBeInstanceOf(InvocationContext);
    const response = await invoke(list, request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.body).toEqual({ orders: [], total: 0 });
  });

  it.each(validCreateCases())(
    "creates 201 with server fields: $name",
    async ({ payload, parsed }) => {
      const handlers = makeHandlers();
      const first = await invoke(
        handlers.create,
        makeRequest("POST", "/orders", payload),
      );
      const expected = {
        ...parsed,
        orderId: "ORD-1",
        status: "pending",
        createdAt: CREATED_AT,
      };
      expect(first.status).toBe(201);
      expect(first.body).toEqual(expected);
      const second = await invoke(
        handlers.create,
        makeRequest("POST", "/orders", payload),
      );
      expect(second.status).toBe(201);
      expect(second.body).toEqual({ ...expected, orderId: "ORD-2" });
      const found = await invoke(
        handlers.get,
        makeRequest("GET", "/orders/ORD-1", undefined, { orderId: "ORD-1" }),
      );
      expect(found.status).toBe(200);
      expect(found.body).toEqual(expected);
    },
  );

  it.each(ORDER_STATUSES)(
    "filters %s, including no matches and exact totals",
    async (status) => {
      const handlers = makeHandlers();
      const request = () => makeRequest("GET", `/orders?status=${status}`);
      expect((await invoke(handlers.list, request())).body).toEqual({
        orders: [],
        total: 0,
      });
      const other = handlers.service.create(makePayload());
      const different = required(
        ORDER_STATUSES.find((value) => value !== status),
      );
      handlers.service.updateStatus(other.orderId, { status: different });
      expect((await invoke(handlers.list, request())).body).toEqual({
        orders: [],
        total: 0,
      });
      const expected = Array.from({ length: 2 }, () => {
        const order = handlers.service.create(makePayload());
        return handlers.service.updateStatus(order.orderId, { status });
      });
      const filtered = await invoke(handlers.list, request());
      expect(filtered.status).toBe(200);
      expect(filtered.body).toEqual({
        orders: expect.arrayContaining(expected),
        total: 2,
      });
      expect(filtered.body).toMatchObject({
        orders: [expect.any(Object), expect.any(Object)],
      });
      const all = await invoke(
        handlers.list,
        makeRequest("GET", "/orders?ignored=anything"),
      );
      expect(all.status).toBe(200);
      expect(all.body).toEqual({
        orders: expect.arrayContaining([
          ...expected,
          handlers.service.get(other.orderId),
        ]),
        total: 3,
      });
      expect(all.body).toMatchObject({
        orders: [expect.any(Object), expect.any(Object), expect.any(Object)],
      });
    },
  );

  it.each(transitions)(
    "PATCH permits $from → $to with only status changed",
    async ({ from, to }) => {
      const handlers = makeHandlers();
      const created = handlers.service.create(makePayload());
      const previous = handlers.service.updateStatus(created.orderId, {
        status: from,
      });
      const response = await invoke(
        handlers.update,
        makeRequest(
          "PATCH",
          `/orders/${created.orderId}/status`,
          {
            status: to,
            orderId: "client-id",
            customerName: "client-name",
            items: [],
            createdAt: "client-date",
            extra: "ignored",
          },
          { orderId: created.orderId },
        ),
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ...previous, status: to });
      expect(handlers.service.get(created.orderId)).toEqual(response.body);
    },
  );

  it.each(invalidCreateCases())(
    "create 400 without mutation: $name",
    async ({ payload }) => {
      const handlers = makeHandlers();
      handlers.service.create(makePayload());
      const before = handlers.service.list();
      const response = await invoke(
        handlers.create,
        makeRequest("POST", "/orders", payload),
      );
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid request" });
      expect(handlers.service.list()).toEqual(before);
    },
  );

  it.each(invalidUpdateCases())(
    "update 400 without mutation: $name",
    async ({ payload }) => {
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
      expect(handlers.service.list()).toEqual(before);
    },
  );

  it.each(invalidFilters)("invalid filter %j produces 400", async (status) => {
    const handlers = makeHandlers();
    handlers.service.create(makePayload());
    const before = handlers.service.list();
    const response = await invoke(
      handlers.list,
      makeRequest("GET", `/orders?status=${encodeURIComponent(status)}`),
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid request" });
    expect(handlers.service.list()).toEqual(before);
  });

  it.each(["POST", "PATCH"] as const)(
    "malformed or absent JSON yields %s 400",
    async (method) => {
      const handlers = makeHandlers();
      const order = handlers.service.create(makePayload());
      const before = handlers.service.list();
      for (const text of [
        "",
        " ",
        "{",
        '{"status":',
        '{"customerName":"x",}',
        "not JSON",
      ]) {
        const request = new HttpRequest({
          method,
          url: "http://localhost:3000/orders",
          params: { orderId: order.orderId },
          body: { string: text },
        });
        const response = await invoke(
          method === "POST" ? handlers.create : handlers.update,
          request,
        );
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Invalid request" });
        expect(handlers.service.list()).toEqual(before);
      }
    },
  );

  it("both opaque missing-ID operations return 404 and preserve state", async () => {
    const handlers = makeHandlers();
    handlers.service.create(makePayload());
    const before = handlers.service.list();
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
    for (const response of [get, update]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Order not found" });
    }
    expect(handlers.service.list()).toEqual(before);
  });

  it("missing path parameters are rejected before service execution", async () => {
    const handlers = makeHandlers();
    handlers.service.create(makePayload());
    const before = handlers.service.list();
    const responses = [
      await invoke(handlers.get, makeRequest("GET")),
      await invoke(
        handlers.update,
        makeRequest("PATCH", "/orders", { status: "shipped" }),
      ),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid request" });
    }
    expect(handlers.service.list()).toEqual(before);
  });

  it.each(["POST", "PATCH"] as const)(
    "cancelled body stream produces generic %s 500, not 400",
    async (method) => {
      const handlers = makeHandlers();
      const order = handlers.service.create(makePayload());
      const before = handlers.service.list();
      const request = makeRequest(
        method,
        "/orders",
        method === "POST" ? makePayload() : { status: "shipped" },
        { orderId: order.orderId },
      );
      await required(request.body).cancel(new Error("private stream details"));
      const response = await invoke(
        method === "POST" ? handlers.create : handlers.update,
        request,
      );
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal server error" });
      expect(handlers.service.list()).toEqual(before);
    },
  );

  it.each(["create", "list", "get", "update"] as const)(
    "%s hides unexpected dependency errors",
    async (operation) => {
      const fail = () => {
        throw new Error("customer secret, connection string, stack details");
      };
      const handlers: Record<typeof operation, RequestHandler> = {
        create: createCreateOrderHandler({ create: fail }),
        list: createListOrdersHandler({ list: fail }),
        get: createGetOrderHandler({ get: fail }),
        update: createUpdateOrderStatusHandler({ updateStatus: fail }),
      };
      const requests = {
        create: makeRequest("POST", "/orders", makePayload()),
        list: makeRequest("GET"),
        get: makeRequest("GET", "/orders/opaque", undefined, {
          orderId: "opaque",
        }),
        update: makeRequest(
          "PATCH",
          "/orders/opaque/status",
          { status: "shipped" },
          { orderId: "opaque" },
        ),
      };
      const { context, logs } = makeContext();
      const response = await invoke(
        handlers[operation],
        requests[operation],
        context,
      );
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal server error" });
      const names = {
        create: "createOrder",
        list: "listOrders",
        get: "getOrder",
        update: "updateOrderStatus",
      };
      expect(logs).toEqual([
        {
          level: "error",
          args: [
            {
              operation: names[operation],
              status: 500,
              invocationId: context.invocationId,
              duration: expect.any(Number),
            },
          ],
        },
      ]);
    },
  );

  it.each(["ID throws", "clock throws", "invalid clock", "duplicate ID"])(
    "create maps %s to 500 without changing existing state",
    async (failure) => {
      let attempts = 0;
      const service = makeService({
        generateId: () => {
          attempts++;
          if (attempts > 1 && failure === "ID throws")
            throw new Error("ID secret");
          return failure === "duplicate ID" ? "same-id" : `id-${attempts}`;
        },
        clock: () => {
          if (attempts > 1 && failure === "clock throws")
            throw new Error("clock secret");
          return new Date(
            attempts > 1 && failure === "invalid clock"
              ? Number.NaN
              : CREATED_AT,
          );
        },
      });
      service.create(makePayload());
      const before = service.list();
      const response = await invoke(
        createCreateOrderHandler(service),
        makeRequest("POST", "/orders", makePayload()),
      );
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal server error" });
      expect(service.list()).toEqual(before);
    },
  );
});
