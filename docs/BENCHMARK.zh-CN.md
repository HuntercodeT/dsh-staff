# 实测对比

2026-09-24 于单机（Apple Silicon / macOS）测得。除特别说明外每项均为**单次运行**，请当作量级参考而非排行榜。英文版：[BENCHMARK.md](BENCHMARK.md)。

语料是本仓库自身源码。代码写于测试当天，任何模型的训练数据里都不可能有，因此测的是理解而非记忆；每道题的正确答案事先已知，下文的引用核对才有意义。

## 任务

| 编号 | 类型 | 任务 |
|---|---|---|
| T1 | 代码理解 | 说明 one-shot runner 如何在新建与恢复 session 之间决策、session id 如何回到调用方，并给出文件、函数、环境变量 |
| T2 | 幻觉陷阱 | "reviewer persona 默认用什么模型、强制什么 JSON schema？"——**该 persona 根本不存在**，前提是假的 |
| T3 | 实现 | 加一个 `version` 子命令读 package.json 打印版本，并注册进分发与 usage 文本 |

## 四种配置

| 编号 | 编排者 | 模型 | 干活的是谁 |
|---|---|---|---|
| **A** | Codex | `gpt-6-luna` | Codex 自己 |
| **B** | Codex | `deepseek-flash` | 经 dsh-staff 委派给 dsh |
| **C** | Codex | `deepseek-flash` | Codex 自己 |
| **D** | dsh-staff companion | `deepseek-flash` | dsh |

**C 是对照组**：编排者与 A 相同、模型与 B/D 相同，用来把「模型差异」和「框架差异」分开。

## 结果

本基准第一轮测试混用了两个中转端点，且全程开着模型的 reasoning 阶段。事后发现这两个变量的影响都大于被测对象本身，所以下表是重测结果：**所有组同一个端点、同一个任务（T1），委派组与单跑组各测 reasoning 开/关两臂。**

| 组 | 配置 | 墙钟 | Codex 侧 token |
|---|---|---|---|
| A | Codex + GPT | **61s** | 61.4k |
| C | Codex + DeepSeek 直跑 | 150s | 51.7k |
| B | Codex → dsh，reasoning **关** | 184s | 49.6k |
| B | Codex → dsh，reasoning **开** | 515s | 56.3k |
| D | dsh 单跑，reasoning **关** | 133s | — |
| D | dsh 单跑，reasoning **开** | 489s | — |

各组答案质量等价：每组 24~35 处不同的 file:line 引用、四个核心机制术语全覆盖，抽查的引用在所有组（含关 reasoning 的）都精确命中。

### 与第一轮相比，什么变了

**委派的差距主要来自 reasoning，不是往返轮次。** 开着 reasoning 时，委派 515s vs 直跑 150s——这就是第一轮当作"框架结构性特征"报告的那个 3.4 倍。关掉之后，委派 184s vs 同样的 150s：**开销是 23%，不是倍数**。轮次一次没少，只是每一轮不再付一次 reasoning。

**"换模型没有差异"是端点造成的假象。** 在第一个中转上，Codex+GPT 与 Codex+DeepSeek 是 89s 和 88s，模型看起来无关紧要；在这个中转上是 61s 和 150s。差别在端点不在模型：直连实测，第一个中转的 `deepseek-flash` TTFT 1.66s、240 tok/s，这个是 3.83s、102 tok/s。agent 循环会把 TTFT 乘上往返次数，2.2 秒的 TTFT 差距就是几分钟。**别拿别人的数字（包括本文的）选模型，先测你自己的端点。**

### 第一轮数据，保留用于端点对比

以下是第一轮测量。它们与上表**不可直接比较**——中转不同、reasoning 开着——保留只是为了佐证端点的影响有多大。

| 任务 | A: Codex+GPT | B: Codex→dsh | C: Codex+DeepSeek | D: dsh 单跑 |
|---|---|---|---|---|
| T1 | 89s / 70.6k | 208s / 57.4k | 88s / 46.2k | 163–269s |
| T2 | 50s / 49.0k | 109s / 48.2k | — | 90s |
| T3 | 49s / 42.9k | 105s / 47.2k | 48s / 13.1k | 86s |

## 质量

质量没有像速度那样拉开差距。

- **T1**——四种配置全部答对。行号引用逐条核对源码：**D 组 5/5 精确命中，A、C 组同样正确**，没有任何一组编造引用。
- **T2**——全部识破了假前提，没有编造当前的 reviewer 配置。B 和 D 更进一步，从 git 历史里还原了真实的历史取值，并明确标注为历史。
- **T3**——四组代码都能跑（`version` 输出 `0.1.0`、exit 0），差别在贴合度：
  - **A** 在 `switch` 里内联 5 行，无错误处理，而且把文档行**插进了 `setup` 的两行说明中间**，把那条说明拆断了。
  - **B、C、D** 抽成了 `cmdVersion()` 函数，符合文件既有的 `cmdXxx` 约定；B 和 D 还加了 `die()` 错误处理，D 另外把 `PACKAGE_JSON` 提为常量放在既有的 `TEMPLATES_DIR` 旁边。

T3 唯一的陷阱——必须相对脚本自身（`path.dirname(SELF)`）而非调用方 cwd 去找 package.json——四组全部避开了。

## 什么时候该委派

以下结论出自上面的数据，不是原则推演：

- **先关掉 reasoning，再去判断委派值不值。** 开着时委派看起来比直接干贵 3.4 倍，关掉后是 23%。拿开着 reasoning 的数字做决策，是在用错误的数字。机械性工作设 `DSH_STAFF_THINKING=off` 后重测。
- **任务小、且有唯一正确答案时，直接干。** 委派仍有固定开销（进程启动、作业派发、轮询），不随任务变小。最小的探针（回一个 "pong"）是 9s vs 32s。
- **调研规模大到会吃光编排者上下文时，委派。** 这是本次数据**唯一确证**的收益（T1 省 19% 上下文），且随搜索规模增长。跨多文件、多服务的调研是划算的场景。
- **需要同时推进多件独立的事时，委派。** dsh 作业是独立进程可并行，而单个 Codex/Claude Code 会话是串行的。本次未测，但属于结构性事实。
- **"要异模型第二意见"已不再需要委派。** 这条原本列在委派理由里，在本机已经不成立：Codex 所用端点同时提供 `deepseek-flash` 与 GPT 系列，换模型家族只是一个参数——`codex exec -c model="deepseek-flash"`，不需要插件、不需要后台作业、不用付 55~120s 开销。若只是想让另一个模型看一眼，直接换参数。委派此时仍多给一样东西：**独立的上下文**——当你不希望复审者看到编排者的推理过程时才需要它，换参数给不了。
- **不要为了提速而委派。** 即使在实测最优配置下（关 reasoning、同端点、同模型），委派仍是 184s vs 直跑 150s。它买的是上下文和并行，从来不是延迟。

## 启动开销

| | 实测 |
|---|---|
| `npx -y @deepseek-ai/dsh --version` | 首次 5231ms，之后约 3100ms |
| 全局安装的 `dsh --version` | 约 90ms |

经 companion 端到端实测，用最短路径任务（`ask`，无工具，各 3 次）：

| | 中位数 | 区间 |
|---|---|---|
| npx | 3589ms | 2898–4651ms |
| 全局安装 | **1723ms** | 1642–3048ms |

**每次调用省约 1.9 秒，对这种短任务约等于快一倍**——本地装好后整个 `ask` 往返只要 1.7s。这笔开销在任何工作开始前就要付，每次前台调用付一次、每个后台作业再付一次。**请全局安装 dsh**，`setup` 现在会在发现 `DSH_BIN` 指向 npx 时告警。

但要说清楚：它对短任务是决定性的，对长任务可忽略——同一个 T1 在相同配置下跑出过 163s 和 269s，**运行间方差远大于这点启动差异**。

## 优化：哪些成立，哪些不成立

**已确证——全局安装 dsh。** 直接测量、可重复、不涉及任务方差：3100ms vs 90ms。

**已确证——模型不是杠杆。** C 组就是为验证这点存在的：同编排者下换模型，T1 差 1 秒、T3 差 1 秒。

**已确证，且是迄今最大的杠杆——关闭模型的 reasoning 阶段。** `deepseek-flash` 每次作答前都先思考，而 agent 循环每一轮都要付这笔钱。受控实验：同端点、同任务、同 prompt，唯一变量是 `thinking`，单跑与委派两条路径都测了。

| 任务 | 路径 | reasoning 开 | reasoning 关 | 降幅 |
|---|---|---|---|---|
| T1 调研 | dsh 单跑 | 489s | **133s** | −73% |
| T1 调研 | Codex → dsh | 515s | **184s** | −64% |
| T3 实现 | dsh 单跑 | 209s | **103s** | −51% |
| T3 实现 | Codex → dsh | 189s | **124s** | −34% |

**两种任务形态下质量都没掉，包括最该出问题的那一种。** T3 是写代码，对规划的依赖是调研任务没有的。四个 T3 组全部产出了可用的 `version` 子命令（exit 0、输出正确）、只改一个文件、header 文档与 usage 字符串都更新、抽成了符合文件约定的 `cmdVersion()` 函数、带 `die()` 错误处理。关掉 reasoning 的产出并不更单薄：dsh 单跑关 reasoning 时改了 22 行、开着时 18 行，关掉的那次还多提了 `PACKAGE_JSON` 常量，并写明 manifest 相对脚本而非调用方 cwd 解析——那正是这道题唯一的陷阱。T1 上委派组开关 reasoning 给出完全相同的 24 处 file:line 引用，抽查全部精确。

有一处反常，如实记下而不抹平：T3 上开着 reasoning 时委派组反而快于单跑组（189s vs 209s），这是 T1 数据预测不到的。单次运行，是方差的可能性不低于是信号。

**约快 3 倍，答案质量没有下降**——两臂的 file:line 引用都逐条核对过源码。机理在端点侧直接可见：给一个 agent 型 prompt、1200 token 预算，开 reasoning 时**整个预算全部用于思考、一个答案都没产出**；关掉后 165 token 给出答案，首 token 延迟 1.21s。

用 `DSH_STAFF_THINKING=off` 启用。默认不开，原因有二：这是真实的取舍——reasoning 正是模型用来规划的东西，需要判断的步骤应该保留它；而且这只是单任务单次实验。注意必须配置在 `llm-deepseek` 上（`thinking` 字段归它所有），注册成请求扩展会因字段冲突失败。

**未能证实——裁剪工具集。** dsh 默认挂载 bash、文件系统、搜索、web、todo、goal、skill、subagent、workflow 全套，每次请求都要带上它们的 schema；假设是缩小目录能同时减少轮次和单轮开销。禁用 9 个本地代码调研用不到的工具后测得 184s，基线 269s——**但同一个基线任务此前已经跑出过 163s 和 269s。184s 落在噪声区间内，等于什么也没测出来。** 第一次未受控的尝试曾显示 71s（看似 3.7 倍提升），但那次绕过了 companion 的 research 模板，模型回答的是一个小得多的问题，**不能作为证据**。

要严肃验证需要两臂各重复多次。`--patch` 机制支持按 persona 配置工具集，一旦有证据支持，改动成本很低。

**结构性开销是往返轮次。** T1 在 dsh 上有 32 次模型往返，每次都因模型先 reasoning 而付 3.6s TTFT——光延迟就约 115s，还没算工具执行。Codex 同一任务 28 次 shell 调用、88s。任何真正的优化都得减少轮次或让轮次重叠，而不是提高生成速度——生成已经 297 tok/s 了。

## 前作：本 fork 所替代的 agy 实测

dsh-staff fork 自 agy-staff（驱动 Google Antigravity CLI）。那套框架更早的实测（2026-09-22，语料是一个生产 Go 代码库，**与本次不同，不可直接比较**）：

| | agy | Claude | Codex |
|---|---|---|---|
| 审查 | 184s | 57s | 127s |
| 实现 | **566s**，status=ERROR，撞输出上限（13.5 万 output token） | 55s | 97s |
| 调研 | 339s | 96s | 722s |

当时记录的失败模式是**编造细节**（把错误码 `0404701` 报成 `42007`）和实现类任务撞输出上限，结论是只能当第二意见、且它给的具体值必须复核。

dsh 在这两点上表现不同：慢得稳定（三项任务一致落在 Codex 的 1.75~1.85 倍，而 agy 在 0.47~5.8 倍之间摆动），实现任务没有撞任何上限，本次抽查的引用全部精确、没有编造。但语料与任务都不同，**这不是两个框架的受控对比**；能说的是，当年对 agy 那条"每个细节都要复核"的告诫，在本次没有复现。

## 复现

```bash
export DEEPSEEK_API_KEY=<key>
export DEEPSEEK_BASE_URL=https://<endpoint>/v1   # 路径前缀必须带
export DSH_STAFF_DEFAULT_MODEL=<该端点提供的模型 id>

# D —— dsh 单跑
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
