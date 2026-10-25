import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "../../src/domain/order";
import {
  createOrderSchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  updateOrderStatusSchema,
} from "../../src/domain/validation";
import {
  invalidCreateCases,
  invalidFilters,
  invalidUpdateCases,
  makePayload,
  validCreateCases,
} from "../helpers";

describe("canonical request validation", () => {
  it("keeps exactly the five documented statuses", () => {
    expect(ORDER_STATUSES).toEqual([
      "pending",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ]);
  });

  it.each(invalidCreateCases())("rejects create: $name", ({ payload }) => {
    expect(createOrderSchema.safeParse(payload).success).toBe(false);
  });

  it.each(validCreateCases())(
    "accepts create: $name",
    ({ payload, parsed }) => {
      expect(createOrderSchema.parse(payload)).toEqual(parsed);
    },
  );

  it.each([undefined, Number.NaN, Infinity, -Infinity])(
    "rejects non-JSON quantity %s at the service boundary",
    (quantity) => {
      expect(
        createOrderSchema.safeParse({
          ...makePayload(),
          items: [{ name: "Item", quantity }],
        }).success,
      ).toBe(false);
    },
  );

  it.each(invalidUpdateCases())("rejects update: $name", ({ payload }) => {
    expect(updateOrderStatusSchema.safeParse(payload).success).toBe(false);
  });

  it.each(ORDER_STATUSES)("accepts status %s and strips extras", (status) => {
    expect(
      updateOrderStatusSchema.parse({ status, customerName: "ignored" }),
    ).toEqual({ status });
    expect(listOrdersQuerySchema.parse({ status, ignored: true })).toEqual({
      status,
    });
  });

  it("allows absent filters and ignores unrelated query properties", () => {
    expect(listOrdersQuerySchema.parse({})).toEqual({});
    expect(listOrdersQuerySchema.parse({ ignored: true })).toEqual({});
  });

  it.each(
    [null, 1, true, [], {}, ...invalidFilters].map((status) => ({ status })),
  )("rejects invalid status filter $status", ({ status }) => {
    expect(listOrdersQuerySchema.safeParse({ status }).success).toBe(false);
  });

  it.each([null, 1, true, [], "pending"].map((query) => ({ query })))(
    "rejects non-object query $query",
    ({ query }) => {
      expect(listOrdersQuerySchema.safeParse(query).success).toBe(false);
    },
  );

  it.each(["", " ", "ORD-1001", "opaque:not-a-uuid", "日本語"])(
    "accepts opaque string ID %j",
    (orderId) => {
      expect(orderIdParamsSchema.parse({ orderId, extra: true })).toEqual({
        orderId,
      });
    },
  );

  it.each([undefined, null, 1, true, [], {}].map((orderId) => ({ orderId })))(
    "rejects non-string ID $orderId",
    ({ orderId }) => {
      expect(orderIdParamsSchema.safeParse({ orderId }).success).toBe(false);
    },
  );

  it("rejects absent create and update bodies", () => {
    expect(createOrderSchema.safeParse(undefined).success).toBe(false);
    expect(updateOrderStatusSchema.safeParse(undefined).success).toBe(false);
  });
});
