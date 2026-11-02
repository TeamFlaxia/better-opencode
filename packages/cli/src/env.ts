import { Config, Schema } from "effect"

// Every environment variable the CLI reads, in one place. Consumers yield
// these instead of touching process.env so the full surface stays visible,
// typed, and redacted where secret.

// The opencode server password: sent by clients connecting to an explicit
// --server, and adopted by a manually run or standalone server. The legacy
// name is still honored.
export const password = Config.Redacted("OPENCODE_PASSWORD").pipe(
  Config.orElse(() => Config.Redacted("OPENCODE_SERVER_PASSWORD")),
  Config.withDefault(undefined),
)

// Real-time deadlines of the managed service. Tests shorten them through the
// environment so they do not wait out the production values.
export const serviceBindRetryMs = Config.schema(Schema.NumberFromString, "OPENCODE_SERVICE_BIND_RETRY_MS").pipe(
  Config.withDefault(15_000),
)

export const serviceRegistrationIntervalMs = Config.schema(
  Schema.NumberFromString,
  "OPENCODE_SERVICE_REGISTRATION_INTERVAL_MS",
).pipe(Config.withDefault(5_000))

export function session() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "OPENCODE_PASSWORD" && entry[0] !== "OPENCODE_SERVER_PASSWORD",
    ),
  )
}

export * as Env from "./env"
