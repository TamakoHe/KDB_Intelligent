---
name: kdb-battery-cli
description: Route natural-language Gen2/Gen3 battery queries, exports, non-OTA controls, parameters, and single-battery 4G OTA workflows to the KDB CLI. Use for status, readiness, modes, commands, command receipts, firmware inspection, OTA preview/start/result, and explicit-target batch operations.
---

# KDB Battery CLI

Run from this repository root:

```bash
npm run --silent kdb -- <arguments>
```

Require a battery ID for every single-battery operation. Use the `battery` command family (Chinese alias `电池`) for new natural-language routes. It defaults to `4g`; old `status`, `ready`, `command`, `parameter`, and `export` commands remain compatible. Never expose tokens, backend protocol frames, or API details. System upgrade, firmware upload, and unsupported OTA transports are never called.

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
| Current firmware version | `battery ota version -b <id>` | Returns Gen2 `battery_version` or Gen3 `app_version`. |
| OTA firmware candidates | `battery ota firmware list -b <id>` | Lists backend-managed firmware metadata; CLI never uploads firmware files. |
| Current firmware details | `battery ota firmware current -b <id>` | Matches the battery's reported version and series number to the full backend firmware record; distinguish `MATCHED`, `METADATA_MISMATCH`, `AMBIGUOUS`, and `NOT_FOUND`. `METADATA_MISMATCH` means the device version was found in a firmware name but differs from the backend `firmwareVersion` field. |
| Set firmware push status | `battery ota firmware status set -b <id> [--firmware-id <id>\|--firmware-version <version>\|--firmware-name <name>] --status 1\|2` | Preview first; `1` disables and `2` marks the push candidate. Requires explicit confirmation. |
| Firmware status history | `battery ota firmware status history [-b <id>]` | Reads persisted local status-change records. |
| Roll back firmware status | `battery ota firmware status rollback -b <id> [--operation-id <id>]` | Preview first; restores the selected operation's previous statuses only if current backend statuses still match. |
| OTA preflight | `battery ota inspect -b <id> --firmware-id <id>`, `--firmware-version <version>` or `--firmware-name <name>` | Checks version, series, Gen2 network-firmware type, 4G readiness, fault and Gen2 warranty rules; recent data is reported for diagnostics and is not a blocking condition. Exactly one selector is required; duplicate versions/names fail before any execution. |
| Start OTA | `battery ota start -b <id> --firmware-id <id>`, `--firmware-version <version>` or `--firmware-name <name>` | First call is `PREVIEW`; only explicit `--confirm` activates firmware selection and sends the generation-specific 4G OTA trigger. Exactly one selector is required; duplicate versions/names fail before any execution. |
| OTA result | `battery ota result -b <id> --session-id <id>` | Combines protocol result, OTA log (Gen3), and final version; only confirmed evidence is `SUCCEEDED`. |

Chinese business aliases are native: `关机`, `重启`, `强启`, `清除故障`, `加热`, `锁电模式`, `应急模式`, `正常模式`, `测试模式`. Use `battery mode set 锁电模式` / `应急模式` for modes. The catalog is authoritative for each generation/channel; do not invent a command name.

For Gen2, `battery mode set 锁电模式` maps to lock and `正常模式` maps to unlock; Gen2 does not expose direct test/emergency mode settings, so report that limitation instead of guessing with a toggle command.

## Single-battery 4G OTA

OTA is a separate, explicit workflow and is not a normal command alias:

```bash
npm run --silent kdb -- battery ota version -b <id>
npm run --silent kdb -- battery ota firmware list -b <id>
npm run --silent kdb -- battery ota inspect -b <id> --firmware-id <firmware-id>
npm run --silent kdb -- battery ota inspect -b <id> --firmware-version <version>
npm run --silent kdb -- battery ota inspect -b <id> --firmware-name "<固件名称>"
npm run --silent kdb -- battery ota start -b <id> --firmware-version <version>
npm run --silent kdb -- battery ota start -b <id> --firmware-name "<固件名称>"
npm run --silent kdb -- battery ota start -b <id> --firmware-version <version> --confirm '<confirmationToken>'
npm run --silent kdb -- battery ota result -b <id> --session-id <sessionId>
npm run --silent kdb -- battery ota result -b <gen2-id> --firmware-id <firmware-id> --target-version <version>
```

The first `start` call is a no-side-effect preview. Confirmation binds the battery, generation, current version, target firmware, series number and preflight snapshot. Confirmation rechecks the target before changing firmware push status or sending the OTA trigger. Gen2 uses the verified `sendbms` `msgType=4` path; Gen3 uses `sendCommand` with OTA enter `msgType=60`, `msgSubType=00`. Gen2 `warrantyStatus > 3` is a warning, not a local block; the website decides based on the backend account role (roleId 7 is restricted).

`--firmware-id`, `--firmware-version` and `--firmware-name` are mutually exclusive. Version/name selection is exact and must resolve to one backend firmware record. If multiple records share a version or name, the CLI stops before preview, status activation or OTA sending; use the ID returned by `firmware list`.

Firmware status changes are persisted to `out/ota-firmware-status-history.jsonl`. `rollback` defaults to the latest applied non-rollback operation for the specified battery; use `--operation-id` to select another record. It never overwrites a newer unrecorded backend change.

Interpret OTA status carefully: `SENT` means the backend accepted the trigger, `ACKNOWLEDGED` means only the OTA-enter protocol reply was found, `RUNNING` means an upgrade process is recorded, `SUCCEEDED` requires final version evidence (and the Gen3 OTA record where available), `PENDING` means no completion evidence yet, and `TIMEOUT` means the wait window expired. Never describe `SENT` or `ACKNOWLEDGED` as physical upgrade success.

The first phase supports only one battery and 4G. Do not call Bluetooth OTA, batch OTA, firmware upload, direct database SQL, or raw OTA protocol frames.

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
