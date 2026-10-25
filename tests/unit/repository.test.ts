import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "../../src/domain/order";
import type { Order } from "../../src/domain/order";
import { InMemoryOrderRepository } from "../../src/repositories/inMemoryOrderRepository";
import { makeOrder, mutateOrder, required, transitions } from "../helpers";

describe("InMemoryOrderRepository", () => {
  it("starts empty, with independent instances and missing reads/updates", () => {
    const repository = new InMemoryOrderRepository();
    expect(repository.list()).toEqual([]);
    expect(repository.findById("missing")).toBeUndefined();
    expect(repository.updateStatus("missing", "shipped")).toBeUndefined();
    expect(repository.list()).toEqual([]);
    repository.insert(makeOrder());
    expect(new InMemoryOrderRepository().list()).toEqual([]);
  });

  it("detaches both the inserted input and returned value deeply", () => {
    const repository = new InMemoryOrderRepository();
    const input = makeOrder();
    const expected = structuredClone(input);
    const output = repository.insert(input);
    expect(output).toEqual(expected);
    expect(output).not.toBe(input);
    expect(output.items).not.toBe(input.items);
    expect(output.items[0]).not.toBe(input.items[0]);
    mutateOrder(input);
    expect(repository.findById(expected.orderId)).toEqual(expected);
    mutateOrder(output);
    expect(repository.findById(expected.orderId)).toEqual(expected);
  });

  it.each(["findById", "list", "filtered list", "updateStatus"])(
    "detaches every nested value returned by %s",
    (surface) => {
      const repository = new InMemoryOrderRepository();
      const expected = makeOrder();
      repository.insert(expected);
      let results: Order[];
      if (surface === "findById") {
        results = [required(repository.findById(expected.orderId))];
      } else if (surface === "updateStatus") {
        results = [
          required(repository.updateStatus(expected.orderId, "pending")),
        ];
      } else {
        results = repository.list(
          surface === "filtered list" ? "pending" : undefined,
        );
      }
      const output = required(results[0]);
      expect(output).toEqual(expected);
      mutateOrder(output);
      results.splice(0, results.length);
      results.push(makeOrder("extra"));
      expect(repository.list()).toEqual([expected]);
    },
  );

  it("successive reads and writes do not alias earlier returned values", () => {
    const repository = new InMemoryOrderRepository();
    const inserted = repository.insert(makeOrder());
    const read = required(repository.findById(inserted.orderId));
    const listed = required(repository.list()[0]);
    const updated = required(
      repository.updateStatus(inserted.orderId, "shipped"),
    );
    expect(inserted.status).toBe("pending");
    expect(read.status).toBe("pending");
    expect(listed.status).toBe("pending");
    for (const earlier of [inserted, read, listed]) {
      expect(updated.items).not.toBe(earlier.items);
      expect(updated.items[0]).not.toBe(earlier.items[0]);
    }
    mutateOrder(updated);
    expect(inserted).toEqual(makeOrder());
    expect(read).toEqual(makeOrder());
    expect(listed).toEqual(makeOrder());
    expect(repository.findById(inserted.orderId)).toEqual({
      ...makeOrder(),
      status: "shipped",
    });
  });

  it("rejects duplicate IDs without replacing or mutating existing orders", () => {
    const repository = new InMemoryOrderRepository();
    repository.insert(makeOrder());
    repository.insert(makeOrder("other"));
    const before = repository.list();
    const duplicate = { ...makeOrder(), customerName: "replacement" };
    expect(() => repository.insert(duplicate)).toThrow(
      "Order ID already exists",
    );
    mutateOrder(duplicate);
    expect(repository.list()).toEqual(before);
  });

  it.each(ORDER_STATUSES)(
    "filters %s without touching unrelated orders",
    (status) => {
      const repository = new InMemoryOrderRepository();
      expect(repository.list(status)).toEqual([]);
      for (const value of ORDER_STATUSES) {
        repository.insert({ ...makeOrder(value), status: value });
      }
      repository.insert({ ...makeOrder("second-match"), status });
      expect(repository.list(status)).toHaveLength(2);
      expect(
        repository.list(status).every((order) => order.status === status),
      ).toBe(true);
      expect(repository.list()).toHaveLength(6);
    },
  );

  it.each(transitions)("changes only status: $from → $to", ({ from, to }) => {
    const repository = new InMemoryOrderRepository();
    const initial = { ...makeOrder(), status: from };
    const unrelated = makeOrder("unrelated");
    repository.insert(initial);
    repository.insert(unrelated);
    const updated = repository.updateStatus(initial.orderId, to);
    expect(updated).toEqual({ ...initial, status: to });
    expect(repository.findById(initial.orderId)).toEqual(updated);
    expect(repository.findById(unrelated.orderId)).toEqual(unrelated);
  });
});
