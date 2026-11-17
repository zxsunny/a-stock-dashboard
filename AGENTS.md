# AGENTS.md — 项目协作指令（AI 自动加载）

> 适用平台：WorkBuddy / Trae / Cursor / Claude 等任何在本仓库工作的 AI。
> 目标：保证每次运行工具/开始任务时，先核对需求与未解决问题，完工后同步状态。

---

## 每次开始任务前（必做）

1. 读取并解析 `docs/STATUS.json`：
   - 确认 `lastChecked` 日期；
   - 找出所有 `status` 为 `open` 或 `pending_eval` 的 `issues`，这些是待办重点；
   - 以 JSON 中的状态为准，**不要凭空假设**功能已完成。
2. 按需读取背景文档（位于仓库 `docs/` 目录）：
   - `docs/需求文档.md` — 项目定位、功能边界、启动方式、合规底线；
   - `docs/问题与修改历史.md` — 问题细节、证据位置、历史改动记录。
3. 若用户要求改动投资建议/评级相关输出，先回顾合规底线（见下）。

## 每次完成任务后（必做）

1. 更新 `docs/STATUS.json`：
   - 已修复的问题 `status` 改为 `fixed` 并填 `fixedAt`（当天日期）；
   - 新发现的问题追加到 `issues` 数组，并同步到 `improvements`（如属改进项）；
   - 将顶部 `lastChecked` 更新为当天日期。
2. 在 `docs/问题与修改历史.md` 的「二、修改历史」末尾追加一条：
   - 日期 + 目标 + 逐文件改动清单 + 验证方式 + 遗留/待办。
3. 如功能状态变化，同步更新 `docs/需求文档.md` 中的「功能模块」或「演进规划」表格。
4. 保持 `STATUS.json` 为**合法 JSON**，字段含义见其 `statusValues` 与注释。

## 项目速览

- **性质**：个人学习向 A 股分析工具，**本地运行，不对外提供服务**。
- **结构**：
  - 前端：`a-stock-dashboard.html` + `assets/app.js`（纯静态，零构建）；
  - 后端：`multi_agent_stock_analysis.py`（5-Agent 投研分析引擎）；
  - 本地服务：`server.py`（标准库 `http.server`，托管前端 + 暴露 `/api/analyze`）。
- **启动**：双击 `start-server.bat`（即 `python server.py 8888`），浏览器开 `http://localhost:8888/a-stock-dashboard.html`。⚠️ 此处原写 8765，与 `start-server.bat:4` 及 `server.py:125` 的实际 8888 不符，已于 2026-10-17 更正；详见下方「运行手册」第 2 节。
- **「AI 深度分析」按钮必须经本地服务器访问**；若用 `file://` 直接打开 HTML，会提示需通过服务器。

## 运行手册

> 用途：让 AI 每次接手都能正确跑起本项目，并自己确认「真的跑起来了」，不必回头问你。
> ⚠️ 本节由 agent 于 2026-10-17 扫描代码归纳；标「未实测」的项 = **只做了静态阅读、未实际执行**。

### 1 启动
```bash
pip install -r requirements.txt     # requests, tabulate
python server.py 8888               # 端口参数可省略，默认即 8888
# ⚠️ 实测：本项目需 Python >= 3.10（PEP 604 联合类型），3.9 会 import 就崩
```
- 浏览器打开 `http://localhost:8888/a-stock-dashboard.html`
- Windows 另有 `start-server.bat`（内含 `python server.py 8888`）

### 2 端口
- 本项目：**8888**（`server.py:125` 默认值；`start-server.bat:4` 显式传 8888）
- ⚠️ **旧文「项目速览」一节原写「即 `python server.py 8765`」与实际启动器不符，已按实际更正为 8888。** 若你本意确为 8765，需改 `start-server.bat:4` 并同步本节

### 3 启动前必须完成
- `pip install -r requirements.txt`（`requests` 用于拉行情数据）

### 4 怎么算跑起来了
- `http://localhost:8888/a-stock-dashboard.html` 能打开且显示行情数据
- 点「AI 深度分析」能返回结果 —— **必须经本地服务器访问**；用 `file://` 直接打开 HTML 会提示需通过服务器
- ⚠️ 未实测（需外网行情）

### 5 停止
- Ctrl+C

### 6 数据在哪
- 任务与问题状态：`docs/STATUS.json` —— **动手前必读**，看 `lastChecked` 日期与所有 `status` 为 `open` / `pending_eval` 的 `issues`
- 前端 `a-stock-dashboard.html` + `assets/app.js`（纯静态零构建）；分析引擎 `multi_agent_stock_analysis.py`


### 7 实测记录（2026-10-17 第二轮：装依赖后全量实测）
✅ **通过 —— 抓到一个真 bug**
- **🔴 真 bug**：`multi_agent_stock_analysis.py:100` 用了 PEP 604 联合类型 `headers: Dict[str, str] | None`，**Python 3.9.6 下 import 阶段就崩**：
  ```
  TypeError: unsupported operand type(s) for |: '_GenericAlias' and 'NoneType'
  ```
  → **本项目实际需 Python ≥ 3.10，但 `requirements.txt` 未声明任何 Python 版本**
- **换 3.13 完全正常**：`~/.local/venvs/ex03-stock313/bin/python server.py 8888`
  - `/a-stock-dashboard.html` → **200**，28355 B，标题「A股智能分析看板」，含「AI 深度分析」按钮
  - `GET /api/analyze?code=600519` → **200**，16538 B，**拉到贵州茅台实时数据并产出 5-Agent 分析报告**
- **真实数据抽样**：最新价 **1329.00 / +1.22%**，总市值 16613.6 亿，PE-TTM **18.7**，PB 6.61，ROE **35.4%**；综合评分 **+5.90 → BUY**；五维评分 估值6/财报9/产业9/技术7/安全10；入场区间 1247.94~1461.90，止损 1186.16
- **接口是 GET 不是 POST**（先试 POST 得到 501 才查清）：`/api/analyze?code=600519`
- ⚠️ 小瑕疵（未深查）：报告中「营收正增长」「净利稳健增长」两项显示 `+0.0%`


---
---

## 硬性约束

- **合规底线**：生成的一切评级 / 目标价 / 仓位均为**演示与学习用途，不构成投资建议**。凡改动涉及投资建议输出（评级、目标价、止损、仓位），必须保留或补充醒目免责说明。
- **数据源**：依赖非官方公开接口（东方财富 / 腾讯），可能随时改字段、加 CORS、限频；代码已做多层 fallback，但**不能作为稳定生产工具**。非交易时间部分实时数据为空，分析引擎可能报"数据采集失败"。
- **文档约定**：新增说明性文档统一放 `docs/`；状态以 `docs/STATUS.json` 为机器权威源，两份 `.md` 为人类可读叙事与历史。

---

<!-- 用户强制规则：数据与事实（v1 · 由 Agent 批量写入，勿手工删） -->

## 强制：数据与事实（用户明确要求 · 不可协商）

1. **工作中的所有信息和数据都需要有依据，且必须经过核实。不要做任何没有依据的回答。**
2. **回答的内容里，严禁编造数据。如果有不确定的内容，必须向用户提问。**
3. **只有在用户允许后，才能使用假设数据。并且假设的数据必须在醒目位置注明。**

**执行方式：**

- 说「某东西不存在 / 没有 / 不能」之前必须先核实，并在回答里给出核实结果（查了哪个路径、跑了哪条命令、返回什么）；只查了一部分，就不能说"没有"。
- 依据写不出来 → 必须向用户提问，不给结论，不许用"大概 / 应该"当结论。
- 用假设数据必须经用户允许，并在醒目位置标注「（假设数据）」。

---

<!-- 用户强制规则：四件套自检（v2 · 由 Agent 批量写入，勿手工删） -->

## 强制：四件套自检（用户明确要求 · 不可协商）

4. **智能体建立项目时，必须建立 `AGENTS.md`、`RULES.md`、`memory.md`、`工作日志.md`；任何一个缺失，必须立即向用户弹出提示，并自动补建默认文件。**

**核心原则：（信息）来源有依据，万事皆可循。**

- 检查时机：项目建立时、每次进入新阶段工作前。
- 命名：`AGENTS.md` / `RULES.md` / `memory.md` / `工作日志.md` 文件名比较**不区分大小写**；出现大小写不同的同名或重复文件时，合并内容只保留最完整最新的一个，删除其余。
