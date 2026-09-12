# 领域专家

为你产品的某一部分配备它自己的专家智能体：一个人格、一个范围、一个记忆命名
空间、一套工具策略 —— 在 DSH Web UI 中配置，并作为普通的 DeepSeek Harness
子智能体执行。

```text
Main agent
    │  domain_expert(domain="payments", task="…")
    ▼
Payments expert  ── domain_expert(domain="inventory", …) ──▶  Inventory expert
    │
    └── scoped tools, scoped memory, scoped paths
```

领域专家不是提示词预设。它是一条持久化记录，把人格、文件系统与知识范围、记忆
命名空间、工具策略、委托策略和模型策略绑定在一起 —— 并且插件会针对每一项限制
告诉你，它是由代码 **enforced** 的，还是仅仅 **advisory**。

## 特性

- **任意领域。** 想建多少就建多少 —— `payments`、`inventory`、`platform`，什么
  都行。插件对你的产品领域一无所知。
- **组合式人格。** 固定的基础策略加上你的指令；基础策略（证据等级、冲突上报、
  不猜测陌生领域）不会被意外替换。
- **范围受限的记忆。** 每位专家都有私有的读写命名空间和只读的共享命名空间。
  私有边界是一种存储键布局，而不是提示词里的一句话。
- **范围受限的工具。** 所选工具是专家唯一能看见或执行的工具；被过滤掉的工具会
  拒绝运行。
- **诚实的强制执行说明。** 每条文件系统规则、每个记忆命名空间和每个委托目标都
  标注为 `enforced` 或 `advisory`，并且只有当所选 worker 真正应用该限制时，路径
  限制才会被认为是强制执行的。
- **跨领域委托。** 访问外部领域要经由它们自己的专家（默认 `expert-only`），并
  带有明确的模式、目标列表和深度上限；委托链在审计环中可见。
- **扩展点。** 其他插件通过 `ctx.domainExperts` 注册范围提供方、记忆后端和
  worker，而无需导入插件内部实现。
- **诊断。** 已解析范围检查器和专家测试界面会准确展示子智能体将收到什么，
  包括降级后的配置。

## 安装

```bash
dsh plugin add @yadsh/dsh-domain-experts
```

然后打开 `Settings → Plugins → Domain Experts`。

## 工具

本插件注册三个面向智能体的工具。

| 工具 | 用途 |
| --- | --- |
| `domain_expert` | 请某个领域的专家去调查、回答或评审某件事。从专家内部调用时即为委托，由调用方的跨领域策略决定是否允许。 |
| `domain_experts_list` | 已启用领域的标识符、名称和一句话描述。范围、记忆和策略不会进入模型视野。 |
| `domain_memory` | 读取和写入调用专家自身的记忆。只有从持久化定义中解析出的命名空间可达，且只有私有命名空间接受写入。 |

`domain_delegate` 被接受为 `domain_expert` 的工具策略别名，因此按设计词汇表编写
的配置不会被报告为降级。

## 配置

插件设置位于 `domain-experts` 命名空间中，在
`Settings → Plugins → Configurable` 中编辑（领域本身则在
`Settings → Plugins → Domain Experts` 中编辑）。改动会应用到后续操作。

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 注册面向智能体的工具并提供管理界面。 |
| `subagentProvider` | string | `spawn` | 用于派生专家子智能体的 `ctx.subagents` 提供方。 |
| `defaultMaxDepth` | number | `3` | 新建领域时预填的委托深度上限。 |
| `defaultMaxParallel` | number | `3` | 当调用方自身不是专家时，每个调用会话允许的并行专家数量。 |
| `defaultCrossDomainMode` | string | `expert-only` | 新建领域时预填的跨领域模式：`disabled`、`expert-only` 或 `direct-read`。 |
| `defaultMemoryProvider` | string | `builtin` | 每位专家使用的记忆提供方 id。 |
| `recallLimit` | number | `5` | 召回并注入专家人格的记忆条目数。 |
| `auditLimit` | number | `200` | 保留在内存中并镜像到日志的执行审计条目数。 |

领域定义**不是**插件配置：它们是插件自身存储域中的持久记录，在 Domain Experts
标签页中编辑。这样，任意规模的专家目录都不会进入 `cordis.yml`。

## 强制执行模型

DSH 的工具过滤是能力范围限定，而不是操作系统级沙箱，因此本插件从不宣称超出其
实际能力的隔离。每项限制都会以两个级别之一报告：

| 限制 | 典型级别 | 强制执行的原因 |
| --- | --- | --- |
| 工具策略 | `enforced` | harness 会从子智能体的视野中移除该工具，*并且*拒绝执行它。 |
| 记忆命名空间 | `enforced` | 存储键布局使其他命名空间不可触及；读写只经过已解析的命名空间。 |
| 委托策略 | `enforced` | 插件会拒绝调用方的模式或目标列表所禁止的委托。 |
| 文件系统范围 | 当所选 worker 声明其应用该范围时为 `enforced`，否则为 `advisory` | 真正限制路径访问的 worker（`DomainWorker.enforces`）。 |
| 人格措辞 | 始终为 `advisory` | 仅靠模型自身的遵从。 |

已解析范围检查器会按资源渲染这些信息，而降级部分则列出领域所要求、但部署无法
提供的内容（`SCOPE_PROVIDER_MISSING`、`MEMORY_PROVIDER_MISSING`、
`WORKER_UNAVAILABLE`、`TOOL_UNVERIFIED`、`DELEGATION_TARGET_MISSING`）。

路径约束只实现一次，位于 `decidePath`/`resolveWithinRoot`：拒绝优先于任何允许；
没有任何规则归类的路径会被拒绝；`..`、绝对路径、NUL 字节和符号链接逃逸都会在
尝试匹配之前被拒绝。

> **注意。** 一个能触达整台机器的通用 shell 工具不会受人格约束。文件系统限制
> 只有通过消费已解析范围的 worker 才会真正生效 —— 这正是检查器要说明这一点的
> 原因。

## 兼容性

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0`（已针对 `0.1.5-rc.2` 测试）
- Node `^22.19.0 || >=24.0.0`
- 浏览器端需要 `settings.plugins.tab` 插槽

机器可读形式见 [compatibility.json](./compatibility.json)。

## 开发

```bash
pnpm install
pnpm --filter @yadsh/dsh-domain-experts typecheck
pnpm --filter @yadsh/dsh-domain-experts test
pnpm --filter @yadsh/dsh-domain-experts build
pnpm --filter @yadsh/dsh-domain-experts verify
pnpm --filter @yadsh/dsh-domain-experts check     # lint, typecheck, test, build, verify
```

`docs/architecture.md` 描述了各模块；[SPEC.md](./SPEC.md) 是产品契约；最初的
设计说明位于 `docs/superpowers/specs/2026-09-13-domain-experts-design.md`。

## 许可证

MIT
