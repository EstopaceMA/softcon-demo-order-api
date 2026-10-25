# Order API conventions

- The approved [.azure/project-plan.md](../.azure/project-plan.md) and confirmed
  requirements govern scope; [.azure/integration-plan.md](../.azure/integration-plan.md)
  records pending verification and actual toolchain facts.
- Keep one root-level TypeScript Functions v4 package, Node 24 LTS, npm 11.
  Build with `npm run build`; source emits to `dist/functions/*.js`.
- Preserve exactly four unprefixed order operations on localhost port 3000 and
  `authLevel: "function"`; no UI, login, health/docs endpoints, persistence, or IaC.
- All application errors use `{error: string}`; validation is 400, not 422.
- Inject repository, ID generator and clock. Orders start empty, live only in one
  process, and must not leak mutable repository references.
- Zod schemas are canonical request types. Do not add trimming, nonempty strings,
  quantity caps, UUID-only IDs, status-transition rules, or strict extra properties.
- Keep real local settings ignored. Never add customer bodies or secrets to logs.
- Check build, typecheck, lint, format, OpenAPI, and applicable tests before completion.
  `npm test` is isolated; `npm run test:smoke` owns and stops a fresh localhost:3000
  host and verifies empty restart state. Never point smoke writes at shared hosts.