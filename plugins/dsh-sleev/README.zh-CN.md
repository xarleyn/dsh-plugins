# dsh-sleev

[![CI](https://github.com/xarleyn/dsh-sleev/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-sleev/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-sleev.svg)](https://www.npmjs.com/package/@yadsh/dsh-sleev)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-sleev.svg)](https://www.npmjs.com/package/@yadsh/dsh-sleev)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-sleev.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · 简体中文

`dsh-sleev` 是一个早期阶段的 DeepSeek Harness 集成，用于观测经由外部
Sleev 上下文优化网关的提供商路由。

当前 M1 观测器不会改写提示词、不会实现压缩，也不会自行路由流量。路由需
配置为普通的 `@deepseek-ai/dsh-llm-pi-ai` 提供商配置；Host 会在
`llm/stream` 边界观测匹配的路由别名，browser 端则在标准插件页面提供观测
设置。

## 安装

从 npm 安装已发布的软件包：

```powershell
dsh plugin --profile web add @yadsh/dsh-sleev
```

也可以通过 GitHub package specifier 直接安装最新源码：

```powershell
dsh plugin --profile web add github:xarleyn/dsh-sleev
```

GitHub 依赖会从源码构建，因此 pnpm 可能要求批准本包的 `prepare` 脚本。
如果不希望授予安装时构建权限，建议使用已发布的 npm 包。

如果手动管理 profile 的 package，可以使用 `pnpm add @yadsh/dsh-sleev` 或
`pnpm add github:xarleyn/dsh-sleev`。

卸载插件：

```powershell
dsh plugin --profile web remove @yadsh/dsh-sleev
```

安装后，如新增 bundle 或 browser client 未被热更新加载，请重启 DeepSeek
Harness 宿主。

## 当前行为

- 观测精确匹配的路由和/或路由前缀（默认前缀为 `sleev-`）；
- 区分 agent、压缩、会话标题和一次性调用；
- 原样转发每一个流式数据块；
- 记录提供商 usage 和有效输入 token 数量；
- 在内存中保留有界且不含敏感信息的历史记录；
- 为每次完成的观测调用输出一条结构化日志；
- 在 Web UI 中提供观测匹配、保留数量和日志设置。

观测器不会存储提示词、请求 header、凭据或密钥。未匹配 Sleev 别名的直连
路由不会被观测。

## 插件设置卡片

打开 **设置 → 插件 → 插件配置 → Sleev**，可以编辑：

- 精确观测的提供商别名；
- 观测的提供商名称前缀；
- 内存中最近调用记录的上限；
- 结构化遥测日志级别（`off`、`info` 或 `debug`）。

修改会暂存到点击**保存**时才写入；只有表单存在实际变更时，保存按钮才会启用。
每个已覆盖的字段都可以单独恢复 composition 默认值，卡片也会标记未保存的修改。
保存后的值从下一次匹配调用开始生效，无需重启 Host。这些设置只决定插件观测
哪些请求；模型 endpoint 和 Sleev routing header 仍在 DSH model settings 的
`llm-pi-ai.providers` 下配置。

## 配置路由

将以下提供商配置合并到 `$DSH_HOME/settings.yaml` 的
`llm-pi-ai.providers` 下。凭据引用由 DSH 解析，请勿在配置中直接填写密钥。

已验证的 NeuralDeep 路由：

```yaml
llm-pi-ai:
  providers:
    sleev-neuraldeep:
      displayName: Sleev / neuraldeep
      apiKeyEnv: NEURALDEEP_API_KEY
      api: openai-completions
      baseURL: http://127.0.0.1:17321/v1
      headers:
        sleev-base-url: https://api.neuraldeep.ru/v1
        sleev-harness: pi
      models:
        - id: gpt-oss-20b
          name: GPT OSS 20B via Sleev
```

对于 Sleev 已知的提供商，可使用 `sleev-provider` 代替
`sleev-base-url`。同一路由中不要同时设置这两个 header。完整示例参见
[示例设置](docs/sample-settings.yml)。

Sleev 目前没有记录原生 DeepSeek Harness 标识符。示例中的
`sleev-harness: pi` 是明确的实验性兼容选择，并不代表官方一等支持。

## 要求

- Node.js `^22.19.0` 或 `>=24.0.0`；
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0`；
- Cordis `^4.0.1`；
- 对于真实模型调用，需要已配置并运行的 Sleev 网关。

## 开发

```powershell
pnpm install
pnpm check
```

构建并将当前 checkout 链接到 Web profile：

```powershell
pnpm build
dsh plugin --profile web add .
dsh --profile web --dump-config
```

本地开发时，可在首次构建后把仓库链接到 DSH web profile：

```powershell
dsh plugin --profile web add /absolute/path/to/dsh-sleev
```

然后确认该 profile 的 `dsh.profile.bundles` 列表包含 `dsh-sleev`。如果
bundle 热更新没有加载新插件，请重启宿主。

本地安装和冒烟测试的更多信息参见
[开发指南](docs/development.md)，当前已验证的版本和传输能力记录在
[兼容性矩阵](docs/compatibility.md)中。

真实 NeuralDeep smoke 依赖凭据、本地网关和外部提供商，因此不会作为必需
CI 检查运行。

## 兼容性状态

截至 2026-08-27，以下组合已验证：

| 组件             | 版本或路由                              | 结果                            |
| ---------------- | --------------------------------------- | ------------------------------- |
| DeepSeek Harness | `0.1.1-rc.2`                            | 支持                            |
| Cordis           | `4.0.1`                                 | 支持                            |
| Sleev CLI 与网关 | `1.7.7`                                 | 健康                            |
| DSH adapter      | `@deepseek-ai/dsh-llm-pi-ai@0.1.1-rc.2` | 支持                            |
| Sleev harness id | `pi`                                    | 可用，但并非已记录的原生 DSH id |
| 上游             | NeuralDeep / `gpt-oss-20b`              | 兼容性冒烟测试通过              |

完整链路已通过 `pnpm smoke:neuraldeep` 验证：

```text
DSH LlmRuntime
  -> llm-pi-ai (openai-completions)
  -> Sleev 127.0.0.1:17321
  -> https://api.neuraldeep.ru/v1
  -> streamed DSH chunks
```

测试覆盖普通文本流、usage 透传、流式工具调用及其 JSON 参数、工具结果续接，
以及 Sleev 路由与 NeuralDeep 直连路由并存。

最终 A/B 成功运行中，短提示词直连的有效提供商输入为 65 token，经 Sleev
则为 1,400 token；工具调用使用 1,431 token，工具结果续接使用 1,546
token。这种极短提示词对比预期不利，因为尚无可回收的旧历史，却已经包含网关
固定的优化指令。这些结果证明传输兼容性，并非 token 节省基准。仍需使用较长、
工具密集型会话来衡量 Sleev 的上下文压缩效果。

## 发布

推送带 `v` 前缀的 SemVer tag 会启动
[Release workflow](.github/workflows/release.yml)。流程会校验准确 tag、执行质量门、
把 tag 版本写入打包 manifest、测试干净 DSH profile 安装、生成校验和并发布
GitHub Release。也可以针对已有 tag 手动启动同一流程，并可选通过 trusted
publishing 将已测试的制品发布到 npm。

预发布 tag 使用 npm `next` dist-tag，稳定版本使用 `latest`。tag 推送不会发布到
npm，手动运行时 npm 发布也默认关闭；启用时需要 GitHub `npm` environment，
以及 npm 中针对 `release.yml` 配置的 trusted publisher。
