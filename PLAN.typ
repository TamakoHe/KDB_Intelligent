#set text(size: 15pt, font: ("Times New Roman","Source Han Serif SC"))
#set heading(numbering: "1.")
= 需要实现的功能
- 电池数据导出；
- 电池管理状态查询；
- 电池命令控制；
- 电池参数读取、设置；
- 电池ota升级；
= 规划层级
因为有二代和三代两种库，那么需要都兼容
```
kdb-api/
├── docs/
│   ├── architecture.md
│   ├── gen2-api.md
│   ├── gen3-api.md
│   ├── cli-spec.md
│   └── skill-spec.md
├── src/
│   ├── core/
│   │   ├── auth/
│   │   │   ├── auth-service.ts
│   │   │   └── token-store.ts
│   │   ├── http/
│   │   │   ├── http-client.ts
│   │   │   ├── request-builder.ts
│   │   │   └── response-normalizer.ts
│   │   ├── config/
│   │   │   ├── env.ts
│   │   │   ├── runtime-config.ts
│   │   │   └── routing-config.ts
│   │   ├── errors/
│   │   │   ├── base-error.ts
│   │   │   ├── auth-error.ts
│   │   │   ├── api-error.ts
│   │   │   └── validation-error.ts
│   │   ├── confirm/
│   │   │   ├── confirm-gate.ts
│   │   │   └── confirm-message.ts
│   │   ├── pagination/
│   │   │   └── paginator.ts
│   │   ├── export/
│   │   │   ├── file-writer.ts
│   │   │   └── export-result.ts
│   │   └── utils/
│   │       ├── battery-routing.ts
│   │       ├── parameter-name-resolver.ts
│   │       └── redact.ts
│   ├── domain/
│   │   ├── gen2/
│   │   │   ├── status/
│   │   │   │   ├── battery-status-service.ts
│   │   │   │   └── status-types.ts
│   │   │   ├── export/
│   │   │   │   ├── export-service.ts
│   │   │   │   └── export-types.ts
│   │   │   ├── command/
│   │   │   │   ├── command-service.ts
│   │   │   │   └── command-types.ts
│   │   │   ├── parameter/
│   │   │   │   ├── parameter-service.ts
│   │   │   │   ├── parameter-workflow.ts
│   │   │   │   └── parameter-types.ts
│   │   │   ├── ota/
│   │   │   │   ├── ota-service.ts
│   │   │   │   └── ota-types.ts
│   │   │   ├── logs/
│   │   │   │   ├── logs-service.ts
│   │   │   │   └── logs-types.ts
│   │   │   └── index.ts
│   │   ├── gen3/
│   │   │   ├── status/
│   │   │   │   ├── battery-status-service.ts
│   │   │   │   └── status-types.ts
│   │   │   ├── export/
│   │   │   │   ├── export-service.ts
│   │   │   │   └── export-types.ts
│   │   │   ├── command/
│   │   │   │   ├── command-service.ts
│   │   │   │   └── command-types.ts
│   │   │   ├── parameter/
│   │   │   │   ├── parameter-service.ts
│   │   │   │   ├── parameter-workflow.ts
│   │   │   │   └── parameter-types.ts
│   │   │   ├── ota/
│   │   │   │   ├── ota-service.ts
│   │   │   │   └── ota-types.ts
│   │   │   └── index.ts
│   │   └── shared-types/
│   │       ├── common-types.ts
│   │       └── operation-types.ts
│   ├── application/
│   │   ├── status/
│   │   │   ├── query-battery-status.ts
│   │   │   └── query-battery-overview.ts
│   │   ├── export/
│   │   │   ├── export-battery-data.ts
│   │   │   └── export-operation-result.ts
│   │   ├── command/
│   │   │   ├── send-battery-command.ts
│   │   │   └── confirm-command.ts
│   │   ├── parameter/
│   │   │   ├── resolve-parameter.ts
│   │   │   ├── read-parameter.ts
│   │   │   ├── write-parameter.ts
│   │   │   └── read-before-write.ts
│   │   ├── ota/
│   │   │   ├── query-ota-version.ts
│   │   │   ├── start-ota-upgrade.ts
│   │   │   └── finish-ota-upgrade.ts
│   │   └── routing/
│   │       ├── resolve-generation.ts
│   │       └── resolve-environment.ts
│   ├── interfaces/
│   │   ├── cli/
│   │   │   ├── commands/
│   │   │   │   ├── auto/
│   │   │   │   ├── gen2/
│   │   │   │   ├── gen3/
│   │   │   │   └── common/
│   │   │   ├── formatters/
│   │   │   ├── parsers/
│   │   │   └── cli.ts
│   │   ├── sdk/
│   │   │   ├── client.ts
│   │   │   └── index.ts
│   │   └── skill/
│   │       ├── skill-router.ts
│   │       └── skill-prompts.ts
│   └── index.ts
├── test/
│   ├── unit/
│   ├── integration/
│   ├── contract/
│   └── e2e/
├── fixtures/
│   ├── gen2/
│   └── gen3/
├── scripts/
│   ├── smoke/
│   └── build/
├── SKILL.md
├── README.md
├── package.json
└── tsconfig.json
```
