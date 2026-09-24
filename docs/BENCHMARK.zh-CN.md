# 实测对比

把工作委派给 dsh 到底值不值、慢在哪、怎么调快。数据来自单机实测（Apple Silicon / macOS，2026-09），**每个数字都是单次运行**——足够指导怎么用，不足以当基准数据对外引用。英文版：[BENCHMARK.md](BENCHMARK.md)。

## 结论速览

1. **关掉模型的 reasoning 阶段是最大杠杆**，省 34%~73%，且调研与写代码两种任务上**质量都没有下降**。用 `DSH_STAFF_THINKING=off`。
2. **委派的开销是 23%，不是倍数**——前提是关掉 reasoning。开着时同一组对比会显示 3.4 倍，那个数字会把人引向错误的决策。
3. **委派买的是上下文隔离与并行，不是速度**。最优配置下仍是 184s vs 直跑 150s。
4. **模型选择依赖端点，必须测你自己的**。同两个模型家族，换一个中转，结论从"无差异"变成"差 2.5 倍"。
5. **全局安装 dsh**，别走 npx，每次调用省约 1.9s。

## 怎么用

- **先设 `DSH_STAFF_THINKING=off`，再去判断任何事。** 拿开着 reasoning 的数字做决策，是在用错误的数字。需要模型做判断的步骤再打开。
- **日常"让另一个模型看一眼"直接换 `-c model=`**，不必委派。宿主端点若同时供多个模型家族，换模型家族只是一个参数，没有插件、没有后台作业、没有固定开销。委派在这件事上只多给一样东西：**独立的上下文**——当你不希望复审者看到编排者的推理过程时才需要。
- **任务小、且有唯一正确答案时，直接干。** 委派的固定开销（进程启动、作业派发、轮询）不随任务变小。最小探针（回一个 "pong"）是 9s vs 32s。
- **调研规模大到会吃光编排者上下文时，委派。** 这是唯一确证的收益：一次调研任务下编排者侧 57.4k vs 自己干 70.6k，**省 19%**，且随搜索规模增长。
- **需要同时推进多件独立的事时，委派。** dsh 作业是独立进程可并行，单个 Codex / Claude Code 会话是串行的。属结构性事实，本次未测。
- **不要为了提速而委派。**

## 任务与配置

| 编号 | 类型 | 任务 |
|---|---|---|
| T1 | 代码理解 | 说明 one-shot runner 如何在新建与恢复 session 之间决策、session id 如何回到调用方，并给出文件、函数、环境变量 |
| T2 | 幻觉陷阱 | "reviewer persona 默认用什么模型、强制什么 JSON schema？"——**该 persona 根本不存在**，前提是假的 |
| T3 | 实现 | 加一个 `version` 子命令读 package.json 打印版本，并注册进分发与 usage 文本 |

| 组 | 编排者 | 模型 | 干活的是谁 |
|---|---|---|---|
| **A** | Codex | GPT | Codex 自己 |
| **B** | Codex | DeepSeek | 经 dsh-staff 委派给 dsh |
| **C** | Codex | DeepSeek | Codex 自己 |
| **D** | dsh-staff companion | DeepSeek | dsh |

**C 是对照组**：编排者与 A 相同、模型与 B/D 相同，用来把「模型差异」和「框架差异」分开。

语料是本仓库自身源码。代码写于测试当天，任何模型的训练数据里都不可能有，因此测的是理解而非记忆；每道题的正确答案事先已知，下文的引用核对才有意义。

## 速度

所有组同一端点、同一任务（T1 调研）：

| 组 | 配置 | 墙钟 | 编排者侧 token |
|---|---|---|---|
| A | Codex + GPT | **61s** | 61.4k |
| C | Codex + DeepSeek 直跑 | 150s | 51.7k |
| B | Codex → dsh，reasoning **关** | 184s | 49.6k |
| B | Codex → dsh，reasoning **开** | 515s | 56.3k |
| D | dsh 单跑，reasoning **关** | 133s | — |
| D | dsh 单跑，reasoning **开** | 489s | — |

**委派的差距主要来自 reasoning，不是往返轮次。** 关掉后委派 184s vs 直跑 150s（+23%）；开着时是 515s vs 150s（3.4 倍）。轮次一次没少：T1 上 dsh 跑了 50 次工具调用、32 次模型往返，Codex 只用 28 次 shell 调用。**轮次是乘数，reasoning 是被乘的那个量**——每轮都付一次完整思考，单轮差距才放大成倍数。减少轮次仍然值得做，但不是第一优先。

## reasoning 开关

同端点受控实验，唯一变量是 `thinking`，两种任务形态都测：

| 任务 | 路径 | reasoning 开 | reasoning 关 | 降幅 |
|---|---|---|---|---|
| T1 调研 | dsh 单跑 | 489s | **133s** | −73% |
| T1 调研 | Codex 委派 | 515s | **184s** | −64% |
| T3 实现 | dsh 单跑 | 209s | **103s** | −51% |
| T3 实现 | Codex 委派 | 189s | **124s** | −34% |

**两种任务形态下质量都没掉，包括最该出问题的那一种。** T3 是写代码，对规划的依赖是调研任务没有的。四个 T3 组全部产出了可用的 `version` 子命令（exit 0、输出正确）、只改一个文件、header 文档与 usage 字符串都更新、抽成了符合文件约定的 `cmdVersion()` 函数、带 `die()` 错误处理。关掉 reasoning 的产出并不更单薄：dsh 单跑关 reasoning 时改了 22 行、开着时 18 行，关掉的那次还多提了 `PACKAGE_JSON` 常量，并写明 manifest 相对脚本而非调用方 cwd 解析——那正是这道题唯一的陷阱。T1 上委派组开关 reasoning 给出完全相同的 24 处 file:line 引用。

机理在端点侧直接可见：给一个 agent 型 prompt、1200 token 预算，开 reasoning 时**整个预算全部用于思考、一个答案都没产出**；关掉后 165 token 给出答案，首 token 延迟 1.21s。

配置在 `llm-deepseek` 的 `thinking` 选项上（该字段归它所有，注册成请求扩展会报冲突）。默认不开：reasoning 正是模型用来规划的东西，而这里每个格子都是单次运行。

## 端点的影响大于模型

同样两个模型家族、同一编排者、同一任务，换一个中转，结论完全反转：

| 中转 | A: Codex+GPT | C: Codex+DeepSeek |
|---|---|---|
| 甲 | 89s | 88s |
| 乙 | 61s | 150s |

原因在端点不在模型。直连实测同一个 DeepSeek 模型：

| 端点 / 模型 | TTFT | 吞吐 |
|---|---|---|
| 甲 / DeepSeek | 1.66s | 240–297 tok/s |
| 乙 / DeepSeek | 3.83s | 102 tok/s |
| 乙 / GPT | 3.39s | 41.7 tok/s |

agent 循环会把 TTFT 乘上往返次数，2.2 秒的 TTFT 差距就是几分钟。**别拿别人的数字（包括本文的）选模型，先测你自己的端点。**

另一个佐证：直连吞吐 297 tok/s，但 dsh 上一次任务产出 6002 token 用了 266s，**有效吞吐仅 22.6 tok/s**。13 倍差距全是轮次开销，生成速度从来不是瓶颈。

## 启动开销

| | 实测 |
|---|---|
| `npx -y @deepseek-ai/dsh --version` | 首次 5231ms，之后约 3100ms |
| 全局安装的 `dsh --version` | 约 90ms |

经 companion 端到端，用最短路径任务（`ask`，无工具，各 3 次）：

| | 中位数 | 区间 |
|---|---|---|
| npx | 3589ms | 2898–4651ms |
| 全局安装 | **1723ms** | 1642–3048ms |

**每次调用省约 1.9 秒，对这种短任务约等于快一倍。** 这笔开销在任何工作开始前就要付，每次前台调用付一次、每个后台作业再付一次。但它对长任务可忽略——同一任务在相同配置下跑出过 163s 和 269s，运行间方差远大于这点差异。

## 质量

质量没有像速度那样拉开差距。

- **T1 代码理解**——所有配置都答对。行号引用逐条核对源码：各组 24~35 处，**抽查全部精确，没有任何一组编造引用**。
- **T2 幻觉陷阱**——全部识破了假前提，没有编造当前的 reviewer 配置。委派组与 dsh 单跑组更进一步，从 git 历史里还原了真实的历史取值，并明确标注为历史。
- **T3 实现**——所有组代码都能跑。差别在贴合度：Codex+GPT 在 `switch` 里内联 5 行、无错误处理，还把文档行插进了 `setup` 的两行说明中间把它拆断了；Codex 直跑 DeepSeek 只改 8 行但漏了 header 文档；dsh 的三个组都抽成了函数并带错误处理。T3 唯一的陷阱——必须相对脚本自身（`path.dirname(SELF)`）而非调用方 cwd 去找 package.json——各组全部避开。

## 未证实

**裁剪工具集。** dsh 默认挂载 bash、文件系统、搜索、web、todo、goal、skill、subagent、workflow 全套，每次请求都要带上它们的 schema；假设是缩小目录能同时减少轮次和单轮开销。禁用 9 个本地代码调研用不到的工具后测得 184s，基线 269s——**但同一个基线任务此前已经跑出过 163s 和 269s，184s 落在噪声区间内，等于什么也没测出来。** 一次未受控的尝试曾显示 71s（看似 3.7 倍提升），那次绕过了 companion 的 research 模板、模型回答的是一个小得多的问题，**不能作为证据**。

要严肃验证需要两臂各重复多次。`--patch` 机制支持按 persona 配置工具集，一旦有证据支持，改动成本很低。

## 前作：本 fork 所替代的 agy

dsh-staff fork 自 agy-staff（驱动 Google Antigravity CLI）。那套框架的实测（语料是一个生产 Go 代码库，与本文不同，**不是受控对比**）：

| | agy | Claude | Codex |
|---|---|---|---|
| 审查 | 184s | 57s | 127s |
| 实现 | **566s**，status=ERROR，撞输出上限（13.5 万 output token） | 55s | 97s |
| 调研 | 339s | 96s | 722s |

当时记录的失败模式是**编造细节**（把错误码 `0404701` 报成 `42007`）和实现类任务撞输出上限，结论是只能当第二意见、且它给的具体值必须复核。

dsh 在这两点上表现不同：慢得稳定（三项任务一致落在 Codex 的 1.75~1.85 倍，而 agy 在 0.47~5.8 倍之间摆动），实现任务没有撞任何上限，本次抽查的引用全部精确、没有编造。语料与任务都不同，能说的只是：当年对 agy 那条"每个细节都要复核"的告诫，在本次没有复现。

## 局限

- **每个格子都是单次运行**，没有重复。同一任务在相同配置下跑出过 163s 和 269s，方差就这么大。
- **一处反常如实记下**：T3 上开着 reasoning 时委派组反而快于单跑组（189s vs 209s），这是 T1 数据预测不到的。是方差的可能性不低于是信号。
- **并行与"异模型第二意见"两项收益未测到**：本文每道题都有唯一可验证答案，恰恰是测不出这类收益的题型。
- 要拿到可对外引用的硬结论，每组需重复 5 次以上。

## 复现

```bash
export DEEPSEEK_API_KEY=<key>
export DEEPSEEK_BASE_URL=https://<endpoint>/v1   # 路径前缀必须带
export DSH_STAFF_DEFAULT_MODEL=<该端点提供的模型 id>

# D —— dsh 单跑（加 DSH_STAFF_THINKING=off 测关 reasoning 一臂）
node companion/dsh-companion.mjs research --prompt "<task>"

# B —— Codex 委派给 dsh（dsh 无法在沙箱内运行）
codex exec --dangerously-bypass-approvals-and-sandbox \
  "Use the dsh researcher skill to delegate this task, wait for the job, then report its findings. Task: <task>"

# C —— Codex 直接驱动同一个模型
codex exec --dangerously-bypass-approvals-and-sandbox \
  -c model_provider=custom \
  -c 'model_providers.custom={name="custom",base_url="https://<endpoint>/v1",wire_api="responses",requires_openai_auth=false,env_key="DEEPSEEK_API_KEY"}' \
  -c model="<model id>" "<task>"
```

Codex 0.156 已不支持 `wire_api = "chat"`，端点必须提供 `/v1/responses`。
