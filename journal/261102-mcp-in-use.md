# 2026-11-02 — The MCP endpoint in use, and the API's memory limit at 192m

Follows `261101-mcp-server.md`. All times are CET.

## What happened

1. John minted a `laptop` write token on the home server at 19:52 and connected Claude Code to
   `https://tracker.itsa-pizza.com/api/mcp`, as `docs/mcp.md` §2 and §4.1 say. Asked "how much
   exercise did i do last week?", it called the tracker and answered for the week of 26 October:
   8 exercises over Monday to Thursday, back extensions' goal met, and no day at the daily target
   of 3. The totals agree with each other (2 a day on four days). John has not yet compared them
   with the app's screen. Confirmed: the endpoint answered a real token; `token list` shows its
   last use at 19:53.
2. The home server's `fitness-api` limit went from 160m to 192m (home-server #326), deployed at
   08:18 and still 192 MiB at 19:55.

## Changes

- `docs/deployment.md` and the README's compose example now give `mem_limit: 192m`. 160m holds
  the measured peak of 126 MiB, but one first start read 140 MiB, and 192m leaves room for that.

## What is deliberately not done

- No new memory measurement. Ask (#58) shipped after the 2026-11-01 figures and may change them.
- `decisions.md` P8 still says 160m. It records the decision as made on 2026-10-24 and is not
  rewritten.
