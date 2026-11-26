// CLI tests spawn real servers. Keep the fork's default external plugins out of
// them so startup stays offline and deterministic; cover the default separately
// with a config-layer test.
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"
