---
name: kdb-battery-cli
description: Route natural-language Gen2/Gen3 battery queries, exports, non-OTA controls, and parameter operations to the KDB CLI. Use for battery status, readiness, working mode, commands, parameters, command receipts, and explicit-target batch operations.
---

# KDB Battery CLI

Run from this repository root:

```bash
npm run --silent kdb -- <arguments>
```

Require a battery ID for every single-battery operation. Use the `battery` command family (Chinese alias `电池`) for new natural-language routes. It defaults to `4g`; old `status`, `ready`, `command`, `parameter`, and `export` commands remain compatible. Never expose tokens, backend protocol frames, or API details. OTA, firmware upgrade, and system upgrade are never called.

## Intent routing

| User intent | Native CLI route | Output/interpretation |
| --- | --- | --- |
| Current state, online/offline, registration, faults, charge/discharge, latest report | `battery status -b <id>` | Concise JSON: ID, generation, 4G, registration, mode, fault, charge/discharge, latest report. Use `--detail` for full battery data and `--raw` for backend objects. |
| Can it receive a command now? | `battery ready -b <id> --json` | Report `canSendCommand`, 4G and registration. This is backend state, not a test command or physical-device probe. |
| Current mode / is it emergency? | `battery mode get -b <id>` | `normal/test/lock/emergency`, Chinese mode name, and source `workingModeStatus`. Gen2 may have no reported mode. |
| Find a parameter | `battery parameter find <keyword> -b <id>` | Use name, alias, ID, or keyword. Default output is value/definition summary; add `--detail` for full definition. |
| Read a parameter | `battery parameter get <name-or-alias-or-id> -b <id> [--channel 4g\|bluetooth]` | Default channel is 4G. `QUEUED_FOR_APP` means Bluetooth task queued, not read. |
| Change a parameter | `battery parameter set <parameter> <value> -b <id>` | First call is preview only; after explicit approval repeat exact request with `--confirm '<token>'`. |
| List/control a command | `battery command list -b <id>` / `battery command send <name-or-Chinese-alias> -b <id>` | Catalog includes canonical name, Chinese name, natural-language aliases, channel, and risk. |
| Query command receipt | `command result -b <id> --session-id <id>` (Gen3) or `command result -b <id> --command <name>` (Gen2) | See receipt status rules below. |
| Export realtime Excel | `battery export realtime -b <id> --start "..." --end "..." --output <file.xlsx>` | If no time range is given, CLI uses last 24 hours. Return the output path. |
| Batch status | `batch status --battery-file <txt-or-csv>` | Explicit IDs only; output each battery separately. |
| Batch 4G command | `batch command send <command> --battery-file <txt-or-csv>` | Preview every target; explicit confirmation is required. |
| Batch 4G parameter read/write | `batch parameter read <parameter> --battery-file <file>` / `batch parameter write <parameter> <value> --battery-file <file>` | Write preview binds target IDs, definitions, old values, and new value. |
| Batch realtime exports | `batch export realtime --battery-file <file> --output-dir <dir>` | Creates one `<batteryId>-realtime.xlsx` per explicit target. |

Chinese business aliases are native: `关机`, `重启`, `强启`, `清除故障`, `加热`, `锁电模式`, `应急模式`, `正常模式`, `测试模式`. Use `battery mode set 锁电模式` / `应急模式` for modes. The catalog is authoritative for each generation/channel; do not invent a command name.

For Gen2, `battery mode set 锁电模式` maps to lock and `正常模式` maps to unlock; Gen2 does not expose direct test/emergency mode settings, so report that limitation instead of guessing with a toggle command.

## Control and write safety

For every command or parameter write, perform the preview call first and present the returned targets, old/new values (when applicable), transport, and risk. Only after the user explicitly approves that exact preview may the same command be rerun with its `confirmationToken`:

```bash
# Preview: no command is sent
npm run --silent kdb -- battery command send 关机 -b <id>

# Confirmed execution
npm run --silent kdb -- battery command send 关机 -b <id> --confirm '<confirmationToken>'
```

For Bluetooth, use `--channel bluetooth` only when the user explicitly requests the phone-App-to-Bluetooth path. `QUEUED_FOR_APP` means the website queued a task for the App; it does not mean the battery executed it. 4G submission means the backend accepted a request after its readiness checks; it is not physical-effect verification.

Batch targets must be repeated explicit `--battery-id <id>` options or a local `--battery-file <txt/csv>` (one ID per line or comma-separated). Empty entries and duplicates are removed; maximum 100 IDs. Mixed Gen2/Gen3 batches, dynamic targets such as “all online batteries” or “all batteries of an agent”, and Bluetooth batches are rejected. If any target fails preview/recheck, batch control or write sends nothing. Never broaden a user’s requested target set.

## Result status meanings

- `PREVIEW`: no side effect; awaiting explicit confirmation.
- `SENT`: website/backend accepted a 4G request; physical device effect remains unverified.
- `ACKNOWLEDGED`: a protocol response was found; still verify by a fresh status/parameter read or on-site evidence when physical effect matters.
- `QUEUED_FOR_APP`: website queued a Bluetooth task; App connection/execution remains pending.
- `PENDING`: no matching result/receipt is available yet.

Do not describe any of these as “device definitely executed” unless a subsequent state or parameter read confirms the requested outcome.

## Defaults and follow-up questions

- If channel is absent, use 4G for the new `battery` routes.
- If battery ID is missing, ask for it. Do not infer a target from history unless the user explicitly identifies it as the same battery.
- If a write/control request has no explicit approval, stop after preview and ask for confirmation; never manufacture or reuse a token.
- For a user asking “all online” or another dynamic bulk control scope, ask them for explicit IDs or a local target file instead.
- Preserve timestamps and timezone offsets. If a time range is omitted for realtime export, state the 24-hour default.

## Compatibility and maintenance

The compatible legacy routes are `ready -b`, `status -b`, `export realtime`, `export <type>`, `command list`, `command send`, `parameter list`, `parameter read`, and `parameter write`. Export types are: `batteryBase`; Gen2 `latestBatteryTable`, `nettyLog`, `statusNettyLog`, `bluetoothCommandTasks`, `realtimeMsgLog`; Gen3 `reportBatteryLog`, `cycle01MsgLog`, `statusCommandLog`.

When CLI commands, aliases, defaults, output fields, or safety behaviour change, update this `SKILL.md` in the same change, update `README.md`, run typecheck/tests/CLI help, and verify every route above maps to a real native command.
