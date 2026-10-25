export type ApplicationErrorCode = "BAD_REQUEST" | "NOT_FOUND";

/** Internal classification only: the public contract remains { error: string }. */
export class ApplicationError extends Error {
  constructor(
    public readonly code: ApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
