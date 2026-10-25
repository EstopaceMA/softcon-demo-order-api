import type { Order, OrderStatus } from "../domain/order";
import type { OrderRepository } from "./orderRepository";

/** Isolated process-local storage, with no mutable references escaping the Map. */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  list(status?: OrderStatus): Order[] {
    const orders = [...this.orders.values()].filter(
      (order) => status === undefined || order.status === status,
    );
    return structuredClone(orders);
  }

  findById(orderId: string): Order | undefined {
    const order = this.orders.get(orderId);
    return order === undefined ? undefined : structuredClone(order);
  }

  insert(order: Order): Order {
    const stored = structuredClone(order);
    if (this.orders.has(stored.orderId)) {
      // A generated-ID collision is an internal failure, never an overwrite.
      throw new Error("Order ID already exists");
    }

    const result = structuredClone(stored);
    this.orders.set(stored.orderId, stored);
    return result;
  }

  updateStatus(orderId: string, status: OrderStatus): Order | undefined {
    const current = this.orders.get(orderId);
    if (current === undefined) {
      return undefined;
    }

    const updated = { ...current, status };
    // Complete all fallible copying before the single synchronous commit.
    const result = structuredClone(updated);
    this.orders.set(orderId, updated);
    return result;
  }
}
