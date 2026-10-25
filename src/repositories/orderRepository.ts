import type { Order, OrderStatus } from "../domain/order";

/** Process-local repository. All inputs and outputs must be detached copies. */
export interface OrderRepository {
  list(status?: OrderStatus): Order[];
  findById(orderId: string): Order | undefined;
  insert(order: Order): Order;
  updateStatus(orderId: string, status: OrderStatus): Order | undefined;
}
