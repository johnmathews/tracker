# Each API log line once

2026-11-02. The first Ask question in production showed every API log line twice:
`INFO:  tracker_api.ask ask round=1 …`, then the same text bare.

- **Cause.** The MCP SDK's server (`MCPServer`, built by `mcp_server.build_mcp` since #54) calls
  `logging.basicConfig(format="%(message)s")`, which gives the root logger a plain handler. The
  `tracker_api` logger has its own handler (`create_app_from_env`, for uvicorn) and also passed
  each line on to the root. So since #54, every API line printed twice: the backup, mail and Ask
  lines alike. No line held anything private, so nothing leaked. The logs were just twice as
  long.
- **Fix.** `create_app_from_env` sets `propagate = False` on the `tracker_api` logger. The SDK's
  own lines still reach its root handler. Leaving `basicConfig` to the SDK was simpler than
  undoing it, and it is what the SDK expects.
- **Test.** `test_each_line_is_logged_once_beside_the_mcp_sdks_root_handler` puts a handler on
  the root, as the SDK does, and checks that a line reaches the package's handler and not the
  root's. It failed before the fix and passes after. The `api_logger` fixture now restores
  `propagate` too.
- **Seen once.** Run through the entry point, each probe line printed once
  (`INFO:  tracker_api.ask probe line`).
