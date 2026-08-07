# MCP transport audit evidence

本次只交付新 SDK 的 MCP transport 验收，不引入 Tauri、产品 UI 或旧 plugin v2。

- `@pixi-board/mcp-host` 只依赖 `@pixi-board/agent-tools`；host 负责 JSON envelope、abort/close、stdio newline framing 与 HTTP `Request`/`Response` 适配。
- `canvas.read`/`canvas.write` 的校验、默认 `origin: agent:canvas`、compact DTO、ChangeSet、revision、错误 mapping 全部复用 `createPixiBoardAgentTools` 与 `BoardCapabilities`。
- `packages/mcp-host/src/contract.test.ts` 用同一输入分别执行 direct Agent、stdio MCP、HTTP MCP，严格比较 document、revision、ChangeSet、history、一次 persistence schedule、requestId 和 INVALID_INPUT/ABORTED mapping。
- close/abort 后 host 拒绝请求；测试也在请求已进入后销毁 board，断言 `BOARD_DESTROYED` 且 persistence 不发生迟到写入。

定向命令：

```bash
pnpm --filter @pixi-board/mcp-host test
```

按仓库协作约定，本次不执行 build 或 `tsc`。
