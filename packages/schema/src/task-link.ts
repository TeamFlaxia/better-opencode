export * as TaskLink from "./task-link.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

/** A TUI-created binding between a declared task and its VCS or workspace state. */
export interface Link extends Schema.Schema.Type<typeof Link> {}
export const Link = Schema.Struct({
  change: optional(Schema.String),
  bookmark: optional(Schema.String),
  workspace: optional(Schema.String),
  sessionID: optional(Schema.String),
  updatedAt: Schema.Number,
}).annotate({ identifier: "TaskLink.Link" })

export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "TaskLink.State" })

/**
 * Task links are client-written metadata. Declared task state stays in the taskwrite messages; this store only carries
 * the bindings a TUI action created (a new change, a bookmark, a workspace, or a linked session).
 */
export const Definition = Rpc.define({
  id: "opencode.tasklinks",
  methods: {
    get: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      output: Schema.toStandardSchemaV1(Schema.NullOr(State)),
    },
    set: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({
          sessionID: Schema.String,
          taskID: Schema.String,
          link: Link,
        }),
      ),
      output: Schema.toStandardSchemaV1(State),
    },
    remove: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, taskID: Schema.String })),
      output: Schema.toStandardSchemaV1(State),
    },
  },
  events: {
    changed: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, state: State })),
    },
  },
})
