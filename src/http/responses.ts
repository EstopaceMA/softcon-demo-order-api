import { performance } from "node:perf_hooks";
import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { ZodError } from "zod";
import { ApplicationError } from "../domain/errors";
import type { ErrorResponse } from "../domain/order";

export type OrderOperation =
  "listOrders" | "createOrder" | "getOrder" | "updateOrderStatus";

export type RequestHandler = (
  request: HttpRequest,
  context: InvocationContext,
) => HttpResponseInit | Promise<HttpResponseInit>;

export function jsonResponse<T>(status: number, body: T): HttpResponseInit {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    jsonBody: body,
  };
}

export function jsonError(
  status: 400 | 404 | 500,
  message: string,
): HttpResponseInit {
  return jsonResponse<ErrorResponse>(status, { error: message });
}

export function handleError(error: unknown): HttpResponseInit {
  if (error instanceof ApplicationError) {
    switch (error.code) {
      case "BAD_REQUEST":
        return jsonError(400, "Invalid request");
      case "NOT_FOUND":
        return jsonError(404, "Order not found");
    }
  }
  if (error instanceof ZodError) {
    return jsonError(400, "Invalid request");
  }
  // Never echo exception messages, validation inputs, or stack traces.
  return jsonError(500, "Internal server error");
}

export async function readJsonBody(request: HttpRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new ApplicationError(
        "BAD_REQUEST",
        "Request body must be valid JSON",
      );
    }
    // Stream, transport, and programming failures are not validation errors.
    throw error;
  }
}

export function withHttpHandling(
  operation: OrderOperation,
  handler: RequestHandler,
): (
  request: HttpRequest,
  context: InvocationContext,
) => Promise<HttpResponseInit> {
  return async (request, context) => {
    const startedAt = performance.now();
    let response: HttpResponseInit;
    try {
      response = await handler(request, context);
    } catch (error: unknown) {
      response = handleError(error);
    }

    const status = response.status ?? 200;
    // Allowlist only host/operation metadata. Duration is in milliseconds.
    const entry = {
      operation,
      status,
      invocationId: context.invocationId,
      duration: performance.now() - startedAt,
    };
    try {
      if (status >= 500) {
        context.error(entry);
      } else if (status >= 400) {
        context.warn(entry);
      } else {
        context.log(entry);
      }
    } catch {
      // Logging failure must not turn a committed write into a failed response.
    }
    return response;
  };
}
