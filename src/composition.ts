import { randomUUID } from "node:crypto";
import { InMemoryOrderRepository } from "./repositories/inMemoryOrderRepository";
import type { OrderRepository } from "./repositories/orderRepository";
import { OrderService } from "./services/orderService";
import type { Clock, OrderIdGenerator } from "./services/orderService";

export interface OrderServiceDependencies {
  repository?: OrderRepository;
  generateId?: OrderIdGenerator;
  clock?: Clock;
}

/** Each call owns an empty repository unless one is explicitly injected. */
export function createOrderService({
  repository = new InMemoryOrderRepository(),
  generateId = randomUUID,
  clock = () => new Date(),
}: OrderServiceDependencies = {}): OrderService {
  return new OrderService(repository, generateId, clock);
}

/** Module initialization runs once per worker process; all routes share this. */
export const orderService = createOrderService();
