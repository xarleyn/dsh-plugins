# dsh-sleev

[![CI](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-sleev.svg)](https://www.npmjs.com/package/@yadsh/dsh-sleev)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-sleev.svg)](https://www.npmjs.com/package/@yadsh/dsh-sleev)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-sleev.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 Sleev 路由可观测能力。

`dsh-sleev` 用于观测经由外部 Sleev 上下文优化网关的提供商路由。当前观测器不会改写提示词、实现压缩或自行路由流量；路由仍由普通的 `@deepseek-ai/dsh-llm-pi-ai` 提供商配置负责。

[English](README.md) · [规范](dsh-sleev-spec-v0.1.md) · [开发指南](docs/development.md) · [兼容性说明](docs/compatibility.md)

## 安装

按名称安装已发布的 npm 包：

```bash
dsh plugin --profile web add @yadsh/dsh-sleev
```

卸载插件：

```bash
dsh plugin --profile web remove @yadsh/dsh-sleev
```

如果 bundle 热更新没有加载新安装的插件或 browser client，请重启 DeepSeek Harness Host。

## 当前功能

- 精确匹配路由及路由前缀，默认前缀为 `sleev-`；
- 区分 agent、压缩、会话标题和一次性调用；
- 原样转发每一个流式数据块；
- 记录提供商 usage 和有效输入 token 数量；
- 在内存中保留有界且不含敏感信息的调用历史；
- 为每次完成的观测调用输出一条结构化记录；
- 在 Web UI 中实时配置匹配、保留数量和日志级别。

观测器不会存储提示词、请求 header、凭据或密钥。未匹配已配置 Sleev 别名的直连路由不会被观测。

## 设置界面

打开 **设置 → 插件 → 插件配置 → Sleev**，可以编辑：

- 精确观测的提供商别名；
- 观测的提供商名称前缀；
- 最近调用历史的数量上限；
- `off`、`info` 或 `debug` 级别的结构化遥测日志。

修改会暂存到点击**保存**时才写入。卡片会标记未保存的修改，并允许每个已覆盖字段单独恢复 composition 默认值。保存后的值从下一次匹配调用开始生效，无需重启 Host。

这些设置只决定插件观测哪些请求。模型 endpoint 和 Sleev routing header 仍在 DSH model settings 的 `llm-pi-ai.providers` 下配置。

## 配置 Sleev 路由

将提供商配置合并到 `$DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers` 下。凭据引用由 DSH 解析；不要在路由配置中直接填写 API key。

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

对于 Sleev 已知的提供商，可使用 `sleev-provider` 代替 `sleev-base-url`；同一路由中不要同时设置两者。[示例设置](docs/sample-settings.yml)展示了这两种形式。

Sleev 目前没有记录原生 DeepSeek Harness 标识符。示例中的 `sleev-harness: pi` 是明确的实验性兼容选择，并不代表官方一等支持。

## 兼容性

完整的 DSH → llm-pi-ai → Sleev → NeuralDeep 流式链路已使用 DeepSeek Harness `0.1.1-rc.2`、Sleev `1.7.7` 和 NeuralDeep `gpt-oss-20b` 通过普通 completion、usage、工具调用和工具结果检查。

这证明了传输兼容性，而不是 token 节省效果。小型验证提示词会暴露 Sleev 的固定指令开销；要得到有意义的压缩基准，仍需使用较长且工具密集型的会话。确切证据见[兼容性说明](docs/compatibility.md)。

## 要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm 10.4.1（开发环境）
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0`
- Cordis `^4.0.1`
- 进行路由模型调用时，需要已配置并运行的 Sleev 网关

## 开发

在 monorepo 根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm --filter @yadsh/dsh-sleev check
```

构建并将 checkout 链接到 Web profile：

```bash
pnpm --filter @yadsh/dsh-sleev build
dsh plugin --profile web add ./plugins/dsh-sleev
dsh --profile web --dump-config
```

当凭据和本地网关可用时，可以单独运行需要账户的 NeuralDeep smoke：

```bash
pnpm --filter @yadsh/dsh-sleev smoke:neuraldeep
```

真实 provider smoke 依赖凭据、本地网关和外部提供商，因此不会作为必需 CI 检查运行。

## 发布

该包使用 monorepo 的独立 Nx Version Plans。通过 `pnpm release:plan` 添加计划；维护者通过共享的[发布流程](../../docs/RELEASING.md)发布已验证的 tarball。

## 贡献

欢迎提交 issue 和范围明确的 pull request。提交前请阅读 monorepo 的[贡献指南](../../CONTRIBUTING.md)并运行 package check。

## 许可证

[MIT](LICENSE)。这是一个独立的社区项目，与 DeepSeek 无隶属关系，也未获得其官方认可。
