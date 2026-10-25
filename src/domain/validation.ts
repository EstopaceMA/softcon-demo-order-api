import { z } from "zod";
import { ORDER_STATUSES } from "./order";

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const orderItemSchema = z.object({
  name: z.string(),
  // Zod's int() adds a safe-integer upper bound absent from the contract.
  quantity: z.number().min(1).refine(Number.isInteger, "Must be an integer"),
});

// Unknown properties are accepted and stripped, never applied to server fields.
export const createOrderSchema = z.object({
  customerName: z.string(),
  items: z.array(orderItemSchema).min(1),
});

export const updateOrderStatusSchema = z.object({
  status: orderStatusSchema,
});

export const listOrdersQuerySchema = z.object({
  status: orderStatusSchema.optional(),
});

// IDs are opaque strings; no UUID format or additional length constraint.
export const orderIdParamsSchema = z.object({ orderId: z.string() });

export type CreateOrderRequest = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusRequest = z.infer<typeof updateOrderStatusSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
