export const ORDER_STATUSES = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderItem {
  name: string;
  quantity: number;
}

export interface Order {
  orderId: string;
  customerName: string;
  items: OrderItem[];
  status: OrderStatus;
  createdAt: string;
}

export interface ListOrdersResponse {
  orders: Order[];
  total: number;
}

export interface ErrorResponse {
  error: string;
}
