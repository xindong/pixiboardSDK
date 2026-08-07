# MCP transport audit evidence

本次只交付新 SDK 的 MCP transport 验收，不引入 Tauri、产品 UI 或旧 plugin v2。

- `@pixi-board/mcp-host` 只依赖 `@pixi-board/agent-tools`；host 负责 JSON envelope、abort/close、stdio newline framing 与 HTTP `Request`/`Response` 适配。
- `canvas.read`/`canvas.write` 的校验、默认 `origin: agent:canvas`、compact DTO、ChangeSet、revision、错误 mapping 全部复用 `createPixiBoardAgentTools` 与 `BoardCapabilities`。
- `packages/mcp-host/src/contract.test.ts` 用同一输入分别执行 direct Agent、stdio MCP、HTTP MCP，严格比较 document、revision、ChangeSet/event、history、一次 persistence schedule、requestId，以及成功 `canvas.read` 和 read-domain error mapping。
- 测试覆盖真正 pending request：external abort 后无 document/change/persistence，host close 后无 stdio late response/write；同步 capability commit 的边界也在实现注释中明确为不可由 transport 回滚。
- stdio 测试使用可控 line endpoint，等待 `ready`/`completed`，覆盖两帧顺序、空行、invalid JSON 和 close；`host.handle` 对 malformed method/params 返回标准 JSON-RPC `-32600/-32601/-32602`。
- `combineSignals` 在每次请求结束时显式移除监听器；facade 生命周期错误由 capabilities 正式 `BoardDestroyedError` 类型向上游统一映射，不依赖错误名字字符串特判。

定向命令：

```bash
pnpm --filter @pixi-board/mcp-host test
```

按仓库协作约定，本次不执行 build 或 `tsc`。
