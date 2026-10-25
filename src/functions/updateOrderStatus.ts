import { app } from "@azure/functions";
import { orderService } from "../composition";
import {
  orderIdParamsSchema,
  updateOrderStatusSchema,
} from "../domain/validation";
import {
  jsonResponse,
  readJsonBody,
  withHttpHandling,
} from "../http/responses";
import type { OrderService } from "../services/orderService";

export function createUpdateOrderStatusHandler(
  service: Pick<OrderService, "updateStatus">,
) {
  return withHttpHandling("updateOrderStatus", async (request) => {
    const { orderId } = orderIdParamsSchema.parse(request.params);
    const payload = updateOrderStatusSchema.parse(await readJsonBody(request));
    return jsonResponse(200, service.updateStatus(orderId, payload));
  });
}

app.http("updateOrderStatus", {
  methods: ["PATCH"],
  route: "orders/{orderId}/status",
  authLevel: "function",
  handler: createUpdateOrderStatusHandler(orderService),
});
