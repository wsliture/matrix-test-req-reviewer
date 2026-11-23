# 外部 HTTP 工具对接接口文档

本文定义 End 与外部 HTTP 工具之间的启动、停止、进度回调和结果回调接口，以及任务标识、结果校验和生命周期要求。

## 1. 对接约定

- 全部接口使用 `POST`、`Content-Type: application/json`、UTF-8；回调接口不配置鉴权。
- 四个接口响应统一为框架 `success/message/code/result` 格式，业务字段都在 `result` 下；请求中的 toolId/runId 必填。
- End 调用工具启动、停止接口；工具异步执行，向 End 回调进度及结果。排队和并发由工具管理。
- **任务唯一标识为 `(toolId, runId)`**，两个值必须原样保存并回传，不得自行生成 runId。同一批次多个工具共享 runId，以 toolId 区分；同一会话下一轮使用新的 runId。
- `projectId`、`sessionId` 均为字符串。启动时必填；停止、结果回调中可选携带，仅用于审计，不替代上述任务标识。

工具标识如下，HTTP 请求统一使用字段名 `toolId`（工具登记标识为 `tool_id`）：

| 工具 | `toolId` |
|---|---|
| 静态分析 | `static-analysis` |
| 单元测试 | `unit-test` |
| 测试策划 | `planning` |

工具必须原样保存启动请求中的 `toolId` 和 `runId`，并用于停止处理、进度回调及结果回调。

联调时双方确认以下地址和工具标识：

| 配置 | 示例 / 说明 |
|---|---|
| 工具标识 | `static-analysis`（静态分析） |
| 工具服务地址 | `http://<TOOL_HOST>:8086` |
| 工具启动路径 | `/api/start`，由工具提供，登记到 End |
| 工具停止路径 | `/api/stop`，由工具提供，登记到 End |
| End 回调基地址 | `http://<END_HOST>:8080/jeecg-boot`，由 End 方提供 |

下文以 `/api/start`、`/api/stop` 为例。回调地址应能从工具所在机器访问，跨主机部署时不要填写 `localhost`。回调地址由双方配置约定，不在启动请求中下发。

## 2. 接口1：启动工具（End → 工具）

`POST {工具服务地址}/api/start`

以下字段全部必填，类型均为 string：

| 字段 | 说明 |
|---|---|
| `toolId` | 工具标识 |
| `runId` | End 生成的批次标识 |
| `projectId` | 项目 ID |
| `projectName` | 项目名称 |
| `projectVersion` | 项目版本，最多100字符；未填写时传 `""` |
| `langType` | 源代码语言，可选值为 `C` / `C++` / `JAVA` / `PYTHON` / `VHDL` / `Verilog`；未填写时传 `""` |
| `sessionId` | 会话 ID |
| `codePackageBase64` | 代码 ZIP 的标准 Base64，无 Data URI 前缀 |
| `docPackageBase64` | 文档 ZIP 的标准 Base64；无文档时传空字符串 `""` |

请求示例（Base64 为示意，联调时须替换为实际 ZIP 编码）：

```json
{
  "toolId": "static-analysis",
  "runId": "r-20261118-0001",
  "projectId": "131",
  "projectName": "嵌入式软件测试项目",
  "projectVersion": "v1.0.0",
  "langType": "C",
  "sessionId": "900108",
  "codePackageBase64": "UEsDBAoAAAAA...",
  "docPackageBase64": ""
}
```

工具受理后立即返回 **HTTP 200**，随后异步执行：

```json
{"success": true, "message": "", "code": 200, "result": {"accepted": true, "jumpUrl": "/report/r-20261118-0001"}}
```

响应外层采用框架标准格式，成功时 `success=true`、`code=200`；业务对象在 `result` 下，必填 `result.accepted=true`、`result.jumpUrl`。接口1响应无需返回 runId，End 不校验响应中的 runId；接口1请求和后续回调必须携带 runId。其中 **jumpUrl 只返回后半截路径**，可带查询参数或片段，允许有或没有开头的 `/`，不能返回完整 URL 或 `//host/path`。

End 按 **工具地址 + 配置跳转路径 + result.jumpUrl** 拼接，直接连接各段，不自动添加、删除或合并 `/`，所需分隔符由用户配置及工具返回值保证。例如工具地址 `http://192.168.4.145:8086`、可选跳转路径 `/ui`、返回 `/report/r-20261118-0001`，保存 `http://192.168.4.145:8086/ui/report/r-20261118-0001`。跳转路径由 End 的全局工具配置页维护（jumpPath），可不填；为空则直接保存 `http://192.168.4.145:8086/report/r-20261118-0001`。工具返回的 jumpUrl 不要重复包含已配置的中间路径。例如跳转路径为 `/ui/`、返回 `report/abc`，得到 `/ui/report/abc`；跳转路径为 `/ui/`、返回 `/report/abc`，则保留为 `/ui//report/abc`；缺少分隔符也不会自动补齐。完整地址最长1000字符。前端从 End 获取完整地址并跳转。HTTP 200 下以 `result.accepted=true` 表示受理，执行结束仍需接口4回调。

未受理（例如参数错误）同样返回 **HTTP 200**，通过 `result.accepted=false` 区分，必须填写 `result.reason` 具体错误信息，`field` 可选，此时不要求 jumpUrl：

```json
{"success": true, "message": "", "code": 200, "result": {"accepted": false, "field": "codePackageBase64", "reason": "代码包无法解码或解压"}}
```

接口1仅使用 HTTP 200 或 5xx。End优先显示 result.reason，缺失时尝试外层message，均为空则显示“工具拒绝启动请求（accepted=false），未提供具体错误信息”。

并发已满时工具自行排队并返回 200，不以过载为由返回 429/503。End 启动请求的响应等待上限为30分钟，超时或 5xx 不自动重发。排队、执行期间都必须能按 `(toolId, runId)` 响应停止。

## 3. 接口2：停止工具（End → 工具）

`POST {工具服务地址}/api/stop`

接口2响应采用框架标准结构，业务字段位于 `result` 下。HTTP 200 时仅以 `result.accepted` 判断停止是否受理。请求中的 `toolId`、`runId` 必填；`projectId`、`sessionId` 可选，均为 string。

请求示例：

```json
{
  "toolId": "static-analysis",
  "runId": "r-20261118-0001",
  "projectId": "131",
  "sessionId": "900108"
}
```

受理停止请求时返回 **HTTP 200**，End立即将工具标记为 CANCELLED 并结束停止处理：

```json
{"success": true, "message": "", "code": 200, "result": {"accepted": true}}
```

未受理停止请求时同样返回 **HTTP 200**。工具可通过 `result.reason` 返回原因，该字段非必填：

```json
{"success": true, "message": "", "code": 200, "result": {"accepted": false, "reason": "正在保存数据，请稍后重试"}}
```

| 响应字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `result.accepted` | boolean | 是 | true 表示已受理，End立即按取消收尾；false 表示未受理，继续有界停止 |
| `result.reason` | string | 否 | accepted=false时的原因，建议工具提供 |

接口2只返回 **HTTP 200 或 5xx**。HTTP 200 时只读取 `result.accepted`，它必须是 JSON 布尔值；字符串 `"true"` 或数字 `1` 不作为取消信号。外层 success/code 不构成额外取消门槛。其他字段不参与停止判定。

`accepted=false` 时，End记录工具提供的 reason 并继续有界停止；reason缺失或为空时尝试外层message，仍为空则使用“工具未受理停止请求（accepted=false），未提供具体原因”。缺少reason不影响停止流程。

单次停止请求的响应等待上限为30秒。工具侧负责受理后的实际停止；End本地已取消不表示远端进程已经退出。非200、超时、无法解析响应或accepted未提供布尔true时继续有界停止，耗尽后在本地收尾。停止操作应保持幂等。

## 4. 接口3：进度回调（工具 → End）

`POST {End回调基地址}/matrix/internal/tools/progress`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `toolId` | string | 是 | 与启动请求一致 |
| `runId` | string | 是 | 与启动请求一致 |
| `percent` | integer | 是 | 0～100 |
| `text` | string | 否 | 进度说明，最多 500 字符 |

请求示例：

```json
{
  "toolId": "static-analysis",
  "runId": "r-20261118-0001",
  "percent": 70,
  "text": "正在匹配规则"
}
```

采纳时返回 **HTTP 200**：

```json
{"success": true, "message": "", "code": 200, "result": {"ack": true, "state": "RUNNING"}}
```

percent为当前环节的进度，允许降低、升高或保持不变；End按当前回调更新百分比和文本，不要求整次任务递增。终态后忽略进度，例如返回 **HTTP 200**：

```json
{"success": true, "message": "", "code": 200, "result": {"ack": false, "state": "COMPLETED", "reason": "已终态，进度已忽略"}}
```

`percent=100` 不等于执行结束，仍须调用接口4。

## 5. 接口4：结果回调（工具 → End）

`POST {End回调基地址}/matrix/internal/tools/result`

接口4响应使用框架标准 `success/message/code/result` 结构，业务回执读取 `result.ack`、`result.state`、`result.reason`。请求体保持以下字段直接位于顶层，不把请求包进 result。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `toolId` | string | 是 | 与启动请求一致 |
| `runId` | string | 是 | 与启动请求一致 |
| `status` | string | 是 | 小写 `completed` 或 `failed` |
| `resultJson` | object | 成功时必填 | 建议不超过 1MB；失败可省略 |
| `errorCode` | string | 否 | 失败错误码，最多 64 字符，例如 `tool_internal_error` |
| `errorMessage` | string | 否 | 失败原因，最多 2000 字符，建议失败时提供 |
| `projectId` / `sessionId` | string | 否 | 可选审计字段 |

### 5.1 静态分析成功示例

```json
{
  "toolId": "static-analysis",
  "runId": "r-20261118-0001",
  "status": "completed",
  "resultJson": {
    "summary": {
      "issueCount": 54,
      "falsePositiveCount": 12
    },
    "warnings": []
  }
}
```

| 静态分析统计字段 | 含义 |
|---|---|
| `summary.issueCount` | AI 识别的缺陷数量 |
| `summary.falsePositiveCount` | AI 识别错误的数量 |

两个字段在静态分析成功结果中均必填，必须为 **0～2147483647 的 JSON 整数**，不得使用字符串、小数、负数或 null。其他结果字段可自行扩展。End 在概览页展示这两个数字，详情打开由接口1的路径与工具配置拼接出的完整链接。接口4请求不包含 jumpUrl。

采纳时返回 **HTTP 200**：

```json
{"success": true, "message": "", "code": 200, "result": {"ack": true, "state": "COMPLETED"}}
```

### 5.2 单元测试成功示例

工具标识为 `unit-test`。`resultJson.summary` 提供执行量、执行通过量、执行通过率、语句覆盖率、分支覆盖率和 MCDC 覆盖率。

```json
{
  "toolId": "unit-test",
  "runId": "r-20261118-0001",
  "status": "completed",
  "resultJson": {
    "summary": {
      "executionCount": 160,
      "passedCount": 152,
      "passRate": 95.0,
      "statementCoverage": 98.2,
      "branchCoverage": 96.8,
      "mcdcCoverage": 95.66
    }
  }
}
```

| 单元测试统计字段 | 类型 | 含义与要求 |
|---|---|---|
| `summary.executionCount` | integer | 执行量，即实际执行的测试用例数量 |
| `summary.passedCount` | integer | 执行通过量，即执行通过的测试用例数量，不得大于执行量 |
| `summary.passRate` | number | 执行通过率；执行量大于0时为 `passedCount / executionCount × 100` |
| `summary.statementCoverage` | number | 语句覆盖率 |
| `summary.branchCoverage` | number | 分支覆盖率 |
| `summary.mcdcCoverage` | number | MCDC（修正条件/判定）覆盖率 |

上述六项均由工具提供。两项数量为0～2147483647的 JSON 整数；四项百分比为0～100的 JSON 数值，允许小数。例如95%填写 `95.0`，不得填写 `0.95`、`"95%"` 或其他字符串。执行量为0时的通过率口径，以及覆盖率的统计范围和不可计算情况，由工具方说明并与平台侧确认。

采纳时返回 **HTTP 200**：

```json
{"success": true, "message": "", "code": 200, "result": {"ack": true, "state": "COMPLETED"}}
```

### 5.3 测试策划成功示例

工具标识为 `planning`。成功结果的 `resultJson.summary` 必须提供需求数量和生成需求对原始需求的覆盖率，两项均由工具统计并给出。

```json
{
  "toolId": "planning",
  "runId": "r-20261118-0001",
  "status": "completed",
  "resultJson": {
    "summary": {
      "requirementCount": 100,
      "requirementCoverage": 96.5
    }
  }
}
```

| 测试策划统计字段 | 类型 | 含义与要求 |
|---|---|---|
| `summary.requirementCount` | integer | 生成的需求数量；0～2147483647的 JSON 整数 |
| `summary.requirementCoverage` | number | 生成需求对原始需求的覆盖率，即被生成需求覆盖的原始需求数量占原始需求总数的百分比；0～100的 JSON 数值，允许小数 |

覆盖率由工具根据生成需求与原始需求的对应关系计算，平台展示指标对应“生成需求对原始需求的覆盖率”。原始需求总数大于0时，计算公式为 `被生成需求覆盖的原始需求数量 / 原始需求总数 × 100`，同一条原始需求被多条生成需求覆盖时只计一次。数值不带 `%`，例如96.5%填写 `96.5`，不得填写 `0.965` 或 `"96.5%"`。原始需求总数为0时的处理方式及展示精度，由工具方说明并与平台侧确认。

采纳时返回 **HTTP 200**：

```json
{"success": true, "message": "", "code": 200, "result": {"ack": true, "state": "COMPLETED"}}
```

### 5.4 失败示例

```json
{
  "toolId": "static-analysis",
  "runId": "r-20261118-0001",
  "status": "failed",
  "errorCode": "tool_internal_error",
  "errorMessage": "规则引擎异常退出"
}
```

采纳时返回 **HTTP 200**：

```json
{"success": true, "message": "", "code": 200, "result": {"ack": true, "state": "FAILED"}}
```

### 5.5 结果校验与失败处理

请求必须是可解析的 JSON，`toolId/runId` 必须为非空字符串且能定位当前工具，`status` 必须有非空值。满足这些条件的首次结束回调按以下规则处理：

- `status=completed` 但 `resultJson` 缺失、不是对象，或静态分析 summary 两项计数不符合上述要求时，工具按 `FAILED` 结束；不保存无效结果。
- 其他已知字段格式不合法（例如 errorMessage 为对象、errorMessage 超过2000字符、errorCode 超过64字符），或 status 有值但不是 completed/failed，也按失败收尾。
- 保存 `errorCode=tool_result_validation_failed`，errorMessage 为“工具已结束，但结果校验未通过：具体原因”。界面展示失败状态和该原因；保留接口1保存的跳转链接，记录结束耗时并推送 SSE。
- 采纳时 HTTP 200，`result.ack=true`、`result.state=FAILED`，`result.reason` 返回同一校验失败原因。这表示结束回调已处理，不代表工具执行成功。
- 整批 Run 在所有工具终态后汇总，其中含此类失败即为 FAILED。
- 已终态工具的重复或迟到回调保留原终态和结果，返回 `ack=false`。静态分析成功后的统计更新若校验失败，保留原成功状态和结果，返回 `ack=false`。旧轮回调无法定位当前任务时返回 UNKNOWN。
- 缺少有效路由字段、缺少/空 status 或请求 JSON 无法解析时，返回参数错误，不能安全结束任何工具；找不到当前任务仍返回 UNKNOWN。

例如 `completed` 回调缺少结果时，采纳响应为：

```json
{"success": true, "message": "", "code": 200, "result": {"ack": true, "state": "FAILED", "reason": "工具已结束，但结果校验未通过：completed 结果的 resultJson 不能为空"}}
```

### 5.6 人工审查后更新统计

静态分析已经 `COMPLETED` 后，人工审查改变统计数字，继续向接口4发送同一 `toolId + runId` 的完整成功结果，例如：

```json
{
  "toolId": "static-analysis",
  "runId": "r-20261118-0001",
  "status": "completed",
  "resultJson": {
    "summary": {
      "issueCount": 48,
      "falsePositiveCount": 18
    },
    "warnings": []
  }
}
```

- 每次发送**完整最新结果**，两个数量可以增加或减少，按替换处理，不是累加；接口4请求不包含 jumpUrl。
- 结果变化：HTTP 200，`{"success": true, "message": "", "code": 200, "result": {"ack": true, "state": "COMPLETED"}}`。
- 未变化：HTTP 200，`{"success": true, "message": "", "code": 200, "result": {"ack": false, "state": "COMPLETED", "reason": "结果未变化，已忽略"}}`。
- 更新保留接口1的链接，不改变执行状态、耗时或整批结果，不重新执行工具。请顺序发送，避免旧统计晚到后覆盖新统计；接口不提供结果版本号。
- 仅静态分析成功后允许这样更新。已失败、已取消的任务及其他工具，不接受终态后覆盖；已成功任务也不能改为 failed。
- 若同一会话新一轮已替换该工具的 runId，旧 runId 返回 UNKNOWN，不会覆盖新一轮。

## 6. 回执与生命周期要点

四个接口的响应均为框架标准结构，业务字段位于 `result` 下。框架响应还会自动携带 `timestamp`，示例省略动态时间戳。接口3/4均读取 `result.ack/state/reason`，请求体不增加外层包装。

| 场景 | HTTP | 回执 |
|---|---|---|
| 接口3/4 找不到任务 | 200 | `{"success": true, "message": "", "code": 200, "result": {"ack": false, "state": "UNKNOWN", "reason": "run not found"}}` |
| 普通重复或迟到的结果 | 200 | 例如 `{"success": true, "message": "", "code": 200, "result": {"ack": false, "state": "COMPLETED", "reason": "重复或迟到结果已忽略"}}`；state 返回实际当前终态，也可能为 FAILED/CANCELLED |
| 接口4可定位当前工具且status非空，但结果或其他字段校验失败 | 200 | 首次采纳：`ack=true/state=FAILED/reason=具体校验失败原因`；已终态工具保留原状态和结果，重复/迟到返回 `ack=false` |
| 接口4路由字段缺失/类型错误或status缺失/空 | 400 | 框架响应 `success=false/code=400`，message 返回错误原因；不结束工具 |
| 接口3字段校验失败；请求 JSON 无法解析 | 200（应用参数错误响应） | 框架响应 `success=false/code=500`，message 返回错误原因；没有采纳回调，不结束工具。工具须同时检查HTTP状态及外层success/code，不能将其视为受理成功 |

接口3/4的 `result.ack=false` 表示未被采纳；也要检查框架的 `success/code/message`，不能仅凭 HTTP 200 或 success=true 判断采纳成功；UNKNOWN、终态及无变化回执不应触发同一请求的无限重试。

工具在 `CANCELLING` 时上报最终结果，End 仍可能采纳；已 `CANCELLED` 后忽略迟到结果。一个工具结束不等于整批结束，所有工具进入终态后整批才结束：包含任一失败为 FAILED；无失败但有取消（包括完成与取消混合）为 CANCELLED；全部完成为 COMPLETED。End 从发起启动请求时开始计算 72 小时兜底窗口；工具仍须负责自己的排队、执行、取消及资源清理。
