import type * as Functions from "@azure/functions";
import { vi } from "vitest";

// Keep the SDK's real request, response, and invocation classes. Only prevent
// module-level registrations from talking to a Functions worker during tests.
vi.mock("@azure/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof Functions>();
  return {
    ...actual,
    app: { ...actual.app, http: vi.fn<typeof actual.app.http>() },
  };
});
