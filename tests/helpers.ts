import { HttpRequest, HttpResponse, InvocationContext } from "@azure/functions";
import type { HttpMethod, LogLevel } from "@azure/functions";
import { createOrderService } from "../src/composition";
import type { OrderServiceDependencies } from "../src/composition";
import { ORDER_STATUSES } from "../src/domain/order";
import type { Order } from "../src/domain/order";
import type { CreateOrderRequest } from "../src/domain/validation";
import { createCreateOrderHandler } from "../src/functions/createOrder";
import { createGetOrderHandler } from "../src/functions/getOrder";
import { createListOrdersHandler } from "../src/functions/listOrders";
import { createUpdateOrderStatusHandler } from "../src/functions/updateOrderStatus";
import type { RequestHandler } from "../src/http/responses";

export const CREATED_AT = "2026-10-26T03:04:05.678Z";

export function makeService(dependencies: OrderServiceDependencies = {}) {
  let nextId = 0;
  return createOrderService({
    generateId: () => `ORD-${++nextId}`,
    clock: () => new Date("2026-10-26T11:04:05.678+08:00"),
    ...dependencies,
  });
}

export function makePayload(): CreateOrderRequest {
  return {
    customerName: "Test customer",
    items: [{ name: "Test item", quantity: 2 }],
  };
}

export function makeOrder(orderId = "opaque-order"): Order {
  return {
    ...makePayload(),
    orderId,
    status: "pending",
    createdAt: CREATED_AT,
  };
}

export function makeHandlers(service = makeService()) {
  return {
    service,
    list: createListOrdersHandler(service),
    create: createCreateOrderHandler(service),
    get: createGetOrderHandler(service),
    update: createUpdateOrderStatusHandler(service),
  };
}

export function makeRequest(
  method: HttpMethod,
  path = "/orders",
  payload?: unknown,
  params: Record<string, string> = {},
): HttpRequest {
  const text = JSON.stringify(payload);
  return new HttpRequest({
    method,
    url: `http://localhost:3000${path}`,
    headers: { "Content-Type": "application/json" },
    params,
    ...(text === undefined ? {} : { body: { string: text } }),
  });
}

export function makeContext(throwOnLog = false) {
  const logs: { level: LogLevel; args: unknown[] }[] = [];
  const context = new InvocationContext({
    invocationId: "isolated-invocation",
    functionName: "isolated-function",
    logHandler: (level, ...args) => {
      logs.push({ level, args });
      if (throwOnLog) {
        throw new Error("Log sink unavailable");
      }
    },
  });
  return { context, logs };
}

export async function invoke(
  handler: RequestHandler,
  request: HttpRequest,
  context = makeContext().context,
) {
  const response = new HttpResponse(await handler(request, context));
  const body: unknown = await response.json();
  return { status: response.status, headers: response.headers, body };
}

export function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) {
    throw new Error("Expected a value to exist in this test");
  }
  return value;
}

export function mutateOrder(order: Order): void {
  order.orderId = "changed-id";
  order.customerName = "changed-customer";
  order.status = "cancelled";
  order.createdAt = "2000-01-01T00:00:00.000Z";
  const item = required(order.items[0]);
  item.name = "changed-item";
  item.quantity = 99;
  order.items.push({ name: "added-item", quantity: 3 });
}

export const transitions = ORDER_STATUSES.flatMap((from) =>
  ORDER_STATUSES.map((to) => ({ from, to })),
);

export const invalidFilters = [
  "",
  "unknown",
  "PENDING",
  " pending",
  "pending ",
  "pending,shipped",
];

export function invalidCreateCases(): { name: string; payload: unknown }[] {
  const cases: { name: string; payload: unknown }[] = [
    { name: "null body", payload: null },
    { name: "array body", payload: [] },
    { name: "string body", payload: "text" },
    { name: "number body", payload: 7 },
    { name: "boolean body", payload: true },
    { name: "empty object", payload: {} },
    { name: "missing customer", payload: { items: makePayload().items } },
    { name: "missing items", payload: { customerName: "Test" } },
    { name: "empty items", payload: { customerName: "Test", items: [] } },
    {
      name: "missing item name",
      payload: { customerName: "Test", items: [{ quantity: 1 }] },
    },
    {
      name: "missing quantity",
      payload: { customerName: "Test", items: [{ name: "Item" }] },
    },
    {
      name: "invalid second item",
      payload: {
        customerName: "Test",
        items: [{ name: "Item", quantity: 1 }, {}],
      },
    },
  ];
  for (const value of [null, 7, true, [], {}]) {
    cases.push({
      name: `customer type ${JSON.stringify(value)}`,
      payload: { ...makePayload(), customerName: value },
    });
    cases.push({
      name: `item name type ${JSON.stringify(value)}`,
      payload: { customerName: "Test", items: [{ name: value, quantity: 1 }] },
    });
  }
  for (const value of [null, "text", 7, true, {}]) {
    cases.push({
      name: `items type ${JSON.stringify(value)}`,
      payload: { customerName: "Test", items: value },
    });
  }
  for (const value of [null, "text", 7, true, [], {}]) {
    cases.push({
      name: `item type ${JSON.stringify(value)}`,
      payload: { customerName: "Test", items: [value] },
    });
  }
  for (const value of [null, 0, -1, 1.5, "1", "text", false, [], {}]) {
    cases.push({
      name: `quantity ${JSON.stringify(value)}`,
      payload: {
        customerName: "Test",
        items: [{ name: "Item", quantity: value }],
      },
    });
  }
  return cases;
}

export function validCreateCases(): {
  name: string;
  payload: unknown;
  parsed: CreateOrderRequest;
}[] {
  const blank = { customerName: "", items: [{ name: "", quantity: 1 }] };
  const whitespace = {
    customerName: " \t\n ",
    items: [{ name: " \t ", quantity: 1 }],
  };
  const large = {
    customerName: "Large quantity",
    items: [{ name: "Item", quantity: Number.MAX_SAFE_INTEGER + 1 }],
  };
  const multiple = {
    customerName: "Several items",
    items: [
      { name: "First", quantity: 1 },
      { name: "Second", quantity: 3 },
    ],
  };
  return [
    { name: "ordinary request", payload: makePayload(), parsed: makePayload() },
    { name: "empty names", payload: blank, parsed: blank },
    { name: "untrimmed whitespace", payload: whitespace, parsed: whitespace },
    { name: "above MAX_SAFE_INTEGER", payload: large, parsed: large },
    { name: "multiple items", payload: multiple, parsed: multiple },
    {
      name: "unknown and server-owned properties",
      payload: {
        ...makePayload(),
        orderId: "client-id",
        status: "delivered",
        createdAt: "client-date",
        secret: "not-an-order-field",
        items: [{ ...required(makePayload().items[0]), extra: true }],
      },
      parsed: makePayload(),
    },
  ];
}

export function invalidUpdateCases(): { name: string; payload: unknown }[] {
  return [
    ...[null, [], "pending", 7, true, {}].map((payload) => ({
      name: `body ${JSON.stringify(payload)}`,
      payload,
    })),
    ...[null, 7, true, [], {}, ...invalidFilters].map((status) => ({
      name: `status ${JSON.stringify(status)}`,
      payload: { status },
    })),
  ];
}
