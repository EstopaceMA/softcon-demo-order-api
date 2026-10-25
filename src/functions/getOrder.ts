import { app } from "@azure/functions";
import { orderService } from "../composition";
import { orderIdParamsSchema } from "../domain/validation";
import { jsonResponse, withHttpHandling } from "../http/responses";
import type { OrderService } from "../services/orderService";

export function createGetOrderHandler(service: Pick<OrderService, "get">) {
  return withHttpHandling("getOrder", (request) => {
    const { orderId } = orderIdParamsSchema.parse(request.params);
    return jsonResponse(200, service.get(orderId));
  });
}

app.http("getOrder", {
  methods: ["GET"],
  route: "orders/{orderId}",
  authLevel: "function",
  handler: createGetOrderHandler(orderService),
});
