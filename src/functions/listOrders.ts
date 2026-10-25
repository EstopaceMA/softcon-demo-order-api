import { app } from "@azure/functions";
import { orderService } from "../composition";
import { listOrdersQuerySchema } from "../domain/validation";
import { jsonResponse, withHttpHandling } from "../http/responses";
import type { OrderService } from "../services/orderService";

export function createListOrdersHandler(service: Pick<OrderService, "list">) {
  return withHttpHandling("listOrders", (request) => {
    const query = listOrdersQuerySchema.parse({
      status: request.query.get("status") ?? undefined,
    });
    return jsonResponse(200, service.list(query));
  });
}

app.http("listOrders", {
  methods: ["GET"],
  route: "orders",
  authLevel: "function",
  handler: createListOrdersHandler(orderService),
});
