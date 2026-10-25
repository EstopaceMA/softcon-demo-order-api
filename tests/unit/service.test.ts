import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createOrderService } from "../../src/composition";
import { ApplicationError } from "../../src/domain/errors";
import { ORDER_STATUSES } from "../../src/domain/order";
import { InMemoryOrderRepository } from "../../src/repositories/inMemoryOrderRepository";
import {
  CREATED_AT,
  invalidCreateCases,
  invalidFilters,
  invalidUpdateCases,
  makePayload,
  makeService,
  mutateOrder,
  required,
  transitions,
  validCreateCases,
} from "../helpers";

describe("OrderService and isolated composition", () => {
  it("starts empty and does not share default repositories", () => {
    const first = createOrderService();
    const second = createOrderService();
    expect(first.list()).toEqual({ orders: [], total: 0 });
    expect(second.list()).toEqual({ orders: [], total: 0 });
    first.create(makePayload());
    expect(second.list()).toEqual({ orders: [], total: 0 });
    expect(createOrderService().list()).toEqual({ orders: [], total: 0 });
  });

  it("uses deterministic unique IDs and converts the injected clock to UTC", () => {
    const service = makeService();
    const first = service.create(makePayload());
    const second = service.create(makePayload());
    expect(first).toEqual({
      ...makePayload(),
      orderId: "ORD-1",
      status: "pending",
      createdAt: CREATED_AT,
    });
    expect(second.orderId).toBe("ORD-2");
    expect(second.createdAt).toBe(CREATED_AT);
    expect(service.get(first.orderId)).toEqual(first);
    expect(service.list().total).toBe(2);
    expect(service.list().orders).toEqual(
      expect.arrayContaining([first, second]),
    );
  });

  it("default generators produce unique opaque IDs and real UTC timestamps", () => {
    const service = createOrderService();
    const before = Date.now();
    const orders = Array.from({ length: 20 }, () =>
      service.create(makePayload()),
    );
    const after = Date.now();
    expect(new Set(orders.map((order) => order.orderId)).size).toBe(
      orders.length,
    );
    for (const order of orders) {
      expect(typeof order.orderId).toBe("string");
      expect(order.createdAt.endsWith("Z")).toBe(true);
      expect(Date.parse(order.createdAt)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(order.createdAt)).toBeLessThanOrEqual(after);
    }
  });

  it.each(validCreateCases())(
    "preserves permissive create: $name",
    ({ payload, parsed }) => {
      const service = makeService();
      expect(service.create(payload)).toEqual({
        ...parsed,
        orderId: "ORD-1",
        status: "pending",
        createdAt: CREATED_AT,
      });
    },
  );

  it.each(ORDER_STATUSES)(
    "returns exact totals for %s and no matches",
    (status) => {
      const service = makeService();
      expect(service.list({ status })).toEqual({ orders: [], total: 0 });
      const different = required(
        ORDER_STATUSES.find((value) => value !== status),
      );
      const other = service.create(makePayload());
      service.updateStatus(other.orderId, { status: different });
      expect(service.list({ status })).toEqual({ orders: [], total: 0 });
      const expected = Array.from({ length: 2 }, () => {
        const order = service.create(makePayload());
        return service.updateStatus(order.orderId, { status });
      });
      const filtered = service.list({ status });
      expect(filtered.total).toBe(2);
      expect(filtered.orders).toHaveLength(filtered.total);
      expect(filtered.orders).toEqual(expect.arrayContaining(expected));
      expect(service.list().total).toBe(3);
    },
  );

  it.each(transitions)(
    "permits $from → $to, including same status",
    ({ from, to }) => {
      let idCalls = 0;
      let clockCalls = 0;
      const service = makeService({
        generateId: () => `opaque-${++idCalls}`,
        clock: () => {
          clockCalls++;
          return new Date(CREATED_AT);
        },
      });
      const created = service.create(makePayload());
      const previous = service.updateStatus(created.orderId, { status: from });
      const updated = service.updateStatus(created.orderId, {
        status: to,
        orderId: "client-id",
        customerName: "client-name",
        items: [],
        createdAt: "client-date",
        extra: true,
      });
      expect(updated).toEqual({ ...previous, status: to });
      expect(service.get(created.orderId)).toEqual(updated);
      expect(idCalls).toBe(1);
      expect(clockCalls).toBe(1);
    },
  );

  it.each(invalidCreateCases())(
    "rejects create atomically: $name",
    ({ payload }) => {
      const repository = new InMemoryOrderRepository();
      const existing = makeService({ repository }).create(makePayload());
      let dependencyCalls = 0;
      const service = makeService({
        repository,
        generateId: () => {
          dependencyCalls++;
          return "unused";
        },
        clock: () => {
          dependencyCalls++;
          return new Date(CREATED_AT);
        },
      });
      expect(() => service.create(payload)).toThrow(ZodError);
      expect(repository.list()).toEqual([existing]);
      expect(dependencyCalls).toBe(0);
    },
  );

  it.each(invalidUpdateCases())(
    "rejects update atomically: $name",
    ({ payload }) => {
      const service = makeService();
      const order = service.create(makePayload());
      const before = service.list();
      expect(() => service.updateStatus(order.orderId, payload)).toThrow(
        ZodError,
      );
      expect(service.list()).toEqual(before);
    },
  );

  it.each(invalidFilters)("rejects filter %j without mutations", (status) => {
    const service = makeService();
    service.create(makePayload());
    const before = service.list();
    expect(() => service.list({ status })).toThrow(ZodError);
    expect(service.list()).toEqual(before);
  });

  it("returns the missing-order application error for both item operations", () => {
    const service = makeService();
    service.create(makePayload());
    const before = service.list();
    for (const action of [
      () => service.get("missing"),
      () => service.updateStatus("missing", { status: "shipped" }),
    ]) {
      expect(action).toThrow(ApplicationError);
      expect(action).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    }
    expect(service.list()).toEqual(before);
  });

  it.each([undefined, null, 1, true, [], {}].map((id) => ({ id })))(
    "rejects non-string ID $id",
    ({ id }) => {
      const service = makeService();
      service.create(makePayload());
      const before = service.list();
      expect(() => service.get(id)).toThrow(ZodError);
      expect(() => service.updateStatus(id, { status: "shipped" })).toThrow(
        ZodError,
      );
      expect(service.list()).toEqual(before);
    },
  );

  it.each(["", " ", "opaque:not-a-uuid"])(
    "does not impose ID format %j",
    (id) => {
      const service = makeService({ generateId: () => id });
      const order = service.create(makePayload());
      expect(service.get(id)).toEqual(order);
      expect(service.updateStatus(id, { status: "delivered" })).toEqual({
        ...order,
        status: "delivered",
      });
    },
  );

  it.each(["ID throws", "clock throws", "invalid clock", "duplicate ID"])(
    "leaves all state unchanged when %s",
    (failure) => {
      const repository = new InMemoryOrderRepository();
      makeService({ repository }).create(makePayload());
      const before = repository.list();
      const problem = new Error("private dependency details");
      const service = makeService({
        repository,
        generateId: () => {
          if (failure === "ID throws") throw problem;
          return failure === "duplicate ID" ? "ORD-1" : "new-id";
        },
        clock: () => {
          if (failure === "clock throws") throw problem;
          return new Date(
            failure === "invalid clock" ? Number.NaN : CREATED_AT,
          );
        },
      });
      expect(() => service.create(makePayload())).toThrow();
      expect(repository.list()).toEqual(before);
    },
  );

  it("does not expose repository references through service inputs or outputs", () => {
    const service = makeService();
    const payload = makePayload();
    const created = service.create(payload);
    const expected = structuredClone(created);
    required(payload.items[0]).name = "mutated input";
    mutateOrder(created);
    mutateOrder(service.get(expected.orderId));
    const list = service.list({ status: "pending" });
    mutateOrder(required(list.orders[0]));
    list.orders.length = 0;
    mutateOrder(service.updateStatus(expected.orderId, { status: "pending" }));
    expect(service.list()).toEqual({ orders: [expected], total: 1 });
  });
});
