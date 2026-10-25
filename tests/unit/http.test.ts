import { HttpResponse } from "@azure/functions";
import { describe, expect, it } from "vitest";
import { ApplicationError } from "../../src/domain/errors";
import { createOrderSchema } from "../../src/domain/validation";
import {
  handleError,
  jsonError,
  jsonResponse,
  readJsonBody,
  withHttpHandling,
} from "../../src/http/responses";
import { makeContext, makePayload, makeRequest, required } from "../helpers";

describe("HTTP response helpers", () => {
  it("serializes JSON bodies and the exact content type", async () => {
    const response = new HttpResponse(jsonResponse(201, { hello: "world" }));
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await response.json()).toEqual({ hello: "world" });
    expect(
      await new HttpResponse(jsonError(400, "Invalid request")).json(),
    ).toEqual({ error: "Invalid request" });
  });

  it.each([
    {
      error: new ApplicationError("BAD_REQUEST", "private"),
      status: 400,
      message: "Invalid request",
    },
    {
      error: new ApplicationError("NOT_FOUND", "private"),
      status: 404,
      message: "Order not found",
    },
    {
      error: createOrderSchema.safeParse({}).error,
      status: 400,
      message: "Invalid request",
    },
    ...[
      new Error("private"),
      "private",
      null,
      undefined,
      { secret: "private" },
    ].map((error) => ({
      error,
      status: 500,
      message: "Internal server error",
    })),
  ])(
    "maps errors to $status without leaking details",
    async ({ error, status, message }) => {
      const response = new HttpResponse(handleError(error));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    },
  );

  it("reads real JSON and preserves stream failures as internal errors", async () => {
    expect(
      await readJsonBody(makeRequest("POST", "/orders", makePayload())),
    ).toEqual(makePayload());
    const request = makeRequest("POST", "/orders", makePayload());
    await required(request.body).cancel();
    await expect(readJsonBody(request)).rejects.toBeInstanceOf(TypeError);
  });

  it("classifies missing JSON as BAD_REQUEST rather than a stream error", async () => {
    await expect(readJsonBody(makeRequest("POST"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("logs the implicit 200 response status", async () => {
    const { context, logs } = makeContext();
    const wrapped = withHttpHandling("listOrders", () => ({ jsonBody: {} }));
    const response = new HttpResponse(
      await wrapped(makeRequest("GET"), context),
    );
    expect(response.status).toBe(200);
    expect(logs).toEqual([
      {
        level: "information",
        args: [
          {
            operation: "listOrders",
            status: 200,
            invocationId: context.invocationId,
            duration: expect.any(Number),
          },
        ],
      },
    ]);
  });
});
