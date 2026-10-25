import { app } from "@azure/functions";
import { orderService } from "../composition";
import { createOrderSchema } from "../domain/validation";
import {
  jsonResponse,
  readJsonBody,
  withHttpHandling,
} from "../http/responses";
import type { OrderService } from "../services/orderService";

export function createCreateOrderHandler(
  service: Pick<OrderService, "create">,
) {
  return withHttpHandling("createOrder", async (request) => {
    const payload = createOrderSchema.parse(await readJsonBody(request));
    return jsonResponse(201, service.create(payload));
  });
}

app.http("createOrder", {
  methods: ["POST"],
  route: "orders",
  authLevel: "function",
  handler: createCreateOrderHandler(orderService),
});
