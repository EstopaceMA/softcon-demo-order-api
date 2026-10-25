import { ApplicationError } from "../domain/errors";
import type { ListOrdersResponse, Order } from "../domain/order";
import {
  createOrderSchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  updateOrderStatusSchema,
} from "../domain/validation";
import type { OrderRepository } from "../repositories/orderRepository";

export type OrderIdGenerator = () => string;
export type Clock = () => Date;

export class OrderService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly generateId: OrderIdGenerator,
    private readonly clock: Clock,
  ) {}

  list(query: unknown = {}): ListOrdersResponse {
    const { status } = listOrdersQuerySchema.parse(query);
    const orders = this.repository.list(status);
    return { orders, total: orders.length };
  }

  get(orderId: unknown): Order {
    const params = orderIdParamsSchema.parse({ orderId });
    const order = this.repository.findById(params.orderId);
    if (order === undefined) {
      throw new ApplicationError("NOT_FOUND", "Order not found");
    }
    return order;
  }

  create(payload: unknown): Order {
    const request = createOrderSchema.parse(payload);
    return this.repository.insert({
      orderId: this.generateId(),
      customerName: request.customerName,
      items: request.items,
      status: "pending",
      createdAt: this.clock().toISOString(),
    });
  }

  updateStatus(orderId: unknown, payload: unknown): Order {
    const params = orderIdParamsSchema.parse({ orderId });
    const { status } = updateOrderStatusSchema.parse(payload);
    const order = this.repository.updateStatus(params.orderId, status);
    if (order === undefined) {
      throw new ApplicationError("NOT_FOUND", "Order not found");
    }
    return order;
  }
}
