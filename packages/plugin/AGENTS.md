# Plugin Package Guide

- The server SDK has two versions: Effect and Promise. `src/tui/` is the TUI SDK.
- In the Effect version, every domain must extend the corresponding Effect API client interface from `@opencode/client/effect/api`.
- Do not redefine functions that already exist on the Effect API client interface.
- Plugin domains add only the additional functions that make sense in the plugin context.
