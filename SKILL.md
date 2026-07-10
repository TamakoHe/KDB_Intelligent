---
name: kdb-battery-cli
description: Use the KDB CLI to query Gen2/Gen3 battery status, determine whether a battery can currently receive a command, and export battery data or logs to Excel. Use when a user asks in Chinese or English about battery online/offline/registration state, command readiness, current battery state, exporting realtime data for a time range, or exporting supported KDB tables and logs by battery ID.
---

# KDB Battery CLI

Run commands from this repository root. Prefer an installed `kdb` executable when available; otherwise run:

```bash
npm run --silent kdb -- <arguments>
```

Require `config/kdb.local.toml` with valid Gen2 and Gen3 tokens. Never print tokens or configuration secrets.

## Route natural-language requests

### Determine whether a command can be sent now

For requests such as “这块电池现在能否下发命令”, run:

```bash
npm run --silent kdb -- ready -b <battery-id> --json
```

Interpret exit code `0` as ready, `2` as not ready/offline/not found/unknown, and `1` as a CLI, configuration, authentication, or request error. Report `canSendCommand`, the reason, network state, and registration state. Do not claim that this performs a live probe: it reads the backend-maintained 4G state, and the backend rechecks the Netty channel during actual command delivery.

### Query current battery status

For requests about current state, online state, latest report, or battery details, run:

```bash
npm run --silent kdb -- status -b <battery-id>
```

Read `summary` for normalized cross-generation state, `details` for the complete battery-base row, `detailFieldLabels` for field-to-Chinese-header mappings, and `latestReport` for the newest report row. Both Gen2 and Gen3 `details` objects cover every website-exportable battery-base column; fields omitted by the backend are present as `null`. When the user asks for a brief status, summarize the important fields; when they ask for all information, return the complete `details` object with `detailFieldLabels` and do not drop null-valued or unfamiliar backend fields.

### Export realtime data to Excel

For requests such as “导出这块电池某个时间段的实时数据”, run:

```bash
npm run --silent kdb -- export realtime \
  -b <battery-id> \
  --start "YYYY-MM-DD HH:mm:ss" \
  --end "YYYY-MM-DD HH:mm:ss" \
  -o <output.xlsx>
```

If the user omits both start and duration, use the default last 24 hours and state that assumption. If the user supplies a duration, use `--hours <number>`. Omit `-o` unless the user requests a path or filename. Return the final output path.

### Export other supported data

Use `npm run --silent kdb -- export <type>` with these types:

- Both generations: `batteryBase`
- Gen2: `latestBatteryTable`, `nettyLog`, `statusNettyLog`, `bluetoothCommandTasks`, `realtimeMsgLog`
- Gen3: `reportBatteryLog`, `cycle01MsgLog`, `statusCommandLog`

Pass a battery with `-b <battery-id>`. Use `--generation gen2|gen3` only when no battery ID is available or to validate an explicit user choice. Repeat `--query key=value` for top-level filters and `--param key=value` for `params[key]` filters. Do not invent backend filter names; inspect the CLI help or repository backend code when necessary.

## Apply routing and safety rules

- Let the CLI infer generation from battery ID: prefixes `4`/`6` are Gen3 and `5`/`8`/`9` are Gen2.
- Ask for a battery ID when the requested operation requires one and none is provided.
- Treat status checks and exports as read-only. Explain that exports create a local file.
- Never simulate command readiness by sending a test command.
- Never execute an unsupported write, command-control, parameter-write, or OTA operation. State that the current CLI does not expose it.
- Preserve user-provided time zones or offsets. For timezone-free timestamps, use the runtime local timezone.
- On an API failure, report the concise error and do not silently switch generations or environments.

## Discover exact syntax

Run this before guessing an option:

```bash
npm run --silent kdb -- --help
```

## Keep this skill synchronized

When changing CLI commands, aliases, options, defaults, output fields, exit codes, supported export types, generation routing, or safety behavior:

1. Update this `SKILL.md` in the same change.
2. Update `README.md` when user-facing usage changes.
3. Run `npm run typecheck`, `npm test`, and the CLI help command.
4. Ensure natural-language examples still map to valid commands.
