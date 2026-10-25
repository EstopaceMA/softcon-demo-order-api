import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { OpenAPIV3 } from "openapi-types";
import { expect } from "vitest";
import { required } from "../helpers";

export const contractPath = fileURLToPath(
  new URL("../../openapi.yaml", import.meta.url),
);

export const operations = [
  {
    path: "/orders",
    method: "get",
    id: "listOrders",
    statuses: [200, 400, 500],
  },
  {
    path: "/orders",
    method: "post",
    id: "createOrder",
    statuses: [201, 400, 500],
  },
  {
    path: "/orders/{orderId}",
    method: "get",
    id: "getOrder",
    statuses: [200, 404, 500],
  },
  {
    path: "/orders/{orderId}/status",
    method: "patch",
    id: "updateOrderStatus",
    statuses: [200, 400, 404, 500],
  },
] as const;

export type Method = (typeof operations)[number]["method"];

export function resolved<T extends object>(
  value: T | OpenAPIV3.ReferenceObject | undefined,
): T {
  const object = required(value);
  if ("$ref" in object) {
    throw new Error("Expected SwaggerParser to dereference the object");
  }
  return object;
}

export function schema(
  value: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined,
): OpenAPIV3.SchemaObject {
  return resolved<OpenAPIV3.SchemaObject>(value);
}

export async function loadContract() {
  const loaded = await SwaggerParser.dereference(contractPath);
  if (!("openapi" in loaded) || loaded.openapi !== "3.0.3") {
    throw new Error("Expected the approved OpenAPI 3.0.3 contract");
  }
  const document = loaded as OpenAPIV3.Document;
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const responses = new Map<string, ValidateFunction<unknown>>();
  const operation = (path: string, method: Method) =>
    required(document.paths[path]?.[method]);
  const responseKey = (path: string, method: Method, status: number) =>
    `${method} ${path} ${status}`;

  // Compile each declared status against its own operation's response schema,
  // rather than accepting every body against one shared success/error schema.
  for (const { path, method } of operations) {
    for (const [status, definition] of Object.entries(
      operation(path, method).responses,
    )) {
      const response = resolved<OpenAPIV3.ResponseObject>(definition);
      const body = schema(response.content?.["application/json"]?.schema);
      responses.set(
        responseKey(path, method, Number(status)),
        ajv.compile<unknown>(body),
      );
    }
  }

  const requestSchema = (path: string, method: Method) => {
    const body = resolved<OpenAPIV3.RequestBodyObject>(
      operation(path, method).requestBody,
    );
    return schema(body.content["application/json"]?.schema);
  };

  return {
    document,
    ajv,
    operation,
    requestSchema,
    assertResponse(
      path: string,
      method: Method,
      response: { status: number; body: unknown },
    ) {
      const key = responseKey(path, method, response.status);
      const validate = required(responses.get(key));
      expect(
        validate(response.body),
        `${key}: ${ajv.errorsText(validate.errors)}`,
      ).toBe(true);
    },
  };
}
