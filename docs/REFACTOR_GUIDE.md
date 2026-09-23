# DXASCalc 审查与重构执行指南

> 历史基线：本文记录 2026-09-22 审查当时的问题与实施要求。此后工作区已有修改；文中的“当前”、行号、测试数量和未修复状态均指审查当日，不能用于判断最新代码。交付前应重新检查源码、测试和文档。

> 审查日期：2026-09-22（America/Chicago）。对象：当前工作区，包括已有未提交修改。
> 用户确认的主要用户：**有经验的 XAS 研究人员，以桌面工作台为主**。
> 本次任务仅审查并编写本文档，没有重构应用。本文是后续模型的实施依据，不代表已经实施或验证了建议方案。

## 1. 结论与实施方向

保留现有 **geometry-first 光路工作台 + 右侧参数 inspector** 的产品方向。暖白背景、淡紫动作色、蓝紫光线、直接操作 p/q 和可检查的晶体响应曲线，都适合这个应用。后端的不可变数据模型、纯几何计算和隔离的 XOP enrichment 已有清晰边界，没必要整体重写。

下一轮最重要的工作是建立可信的“输入—请求—结果”对应关系，并修复物理比例图的真实性。当前存在能使研究人员误读结果的已确认问题：新输入可能配上旧结果并显示 `Calculation ready`；缺失分辨率在比较表中变成零；物理比例图会悄悄截断角度和距离。先处理这些，再整理 UI 和代码结构。

视觉改进应让用户更容易完成这条工作流：**选配置 → 改关键参数 → 确认结果是否最新 → 看能量覆盖、束宽、采样和估计分辨率 → 比较已计算的配置 → 保存可复用输入**。不要把它重做成营销页面，也不要因为用户是专家就压缩到看不清数值。

### 优先级总览

| 编号 | 优先级 | 事项 | 证据等级 |
| --- | --- | --- | --- |
| F01 | P1 | 请求期间编辑输入，旧响应清除新草稿的 stale 状态 | 浏览器复现 + 源码回调测试 |
| F02 | P1 | 连续修改图中 p/q，取消旧请求会回滚后续有效输入 | 源码回调测试 |
| F03 | P1 | `null` 分辨率变成零和虚假的负差值 | 实际 formatter 执行 |
| F04 | P1 | Physical scale 截断角度、距离，图与数值不一致 | 浏览器 + 几何函数验证 |
| F05 | P2 | 有限输入经 enrichment 溢出为非法 JSON `Infinity` | Flask test client + 严格 JSON 验证 |
| F06 | P2 | 暂时 XOP 失败后的 fallback 被长期缓存 | mock 故障恢复验证 |
| F07 | P2 | Compare、Replace、Save 的快照语义不清楚 | 浏览器 + 源码 |
| F08 | P2 | 数值控件过窄，隐藏真实输入的尾数 | 浏览器截图 + DOM 尺寸 |
| F09 | P2 | 错误定位、单位朗读与菜单键盘语义不完整 | 源码审查；需后续辅助技术验收 |
| U01–U05 | P2/P3 | 信息层级、字号、画布高度、比较位置、响应式流程 | 本轮视觉审查与设计建议 |
| M01–M03 | 单独科学议题 | 模型适用范围、卷积资源限制、材料常数来源 | 已确认行为；不能由 UI 重构自行决定 |

P1 表示应在下一轮功能或视觉扩展前解决；P2 表示需要安排的可靠性或工作流问题；P3 表示后续整理。本轮未发现需要宣称为 P0 的问题。

## 2. 审查基线与证据范围

### 2.1 审查对象

- Git HEAD：`6f019494a5d9c441f4fc5adf9190623221b80bb8`，**不是干净 checkout**。
- 已有修改包括 `README.md`、`dxascalc/web_api.py`、`frontend/AGENTS.md`、`App.jsx`、`ComparisonPanel.jsx`、`OpticsCanvas.jsx`、`opticsGeometry.js`、`styles.css` 及相关测试；已有未跟踪文件包括 `configurationFile.js`、`energyUnits.js` 和它们的测试。
- 实施模型必须先重新读 `git status` 和当前 diff。不要 reset、覆盖、批量格式化这些已有工作，也不要把历史 HEAD 当作本次审查的全部内容。
- 阅读了 `README.md`、`frontend/AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/SCIENTIFIC_MODEL.md`、`design-qa.md`，以及主要前后端实现和测试。
- 实际访问本地 `http://localhost:5002`；监听进程的 cwd 是本仓库。未修改或重启用户原有服务。
- 当前源码另行构建到 `/tmp/dxas-audit-build-20260922`。生成的两个 JS 文件与现有 `frontend/dist` SHA-256 一致，避免使用旧前端截图审查新源码。页面入口为 `index-CHZnpG99.js`，Plotly chunk 为 `PlotlyFigure-CTTb30Wk.js`。
- 检查了 1440×1000、1280×800 和 390×844 的实际页面。窄屏是降级检查，桌面是本轮优先对象。

以下行号是审查时的位置；后续代码变化后，应按函数名和行为定位。

### 2.2 已执行验证

| 验证 | 结果 | 可以证明什么 |
| --- | --- | --- |
| `.venv/bin/python -m unittest discover -s tests -v` | 52 项：51 通过、1 项 opt-in 跳过 | 现有几何、API 和数值单元回归通过 |
| `DXASCALC_RUN_XOP_INTEGRATION=1 .venv/bin/python -m unittest discover -s tests -p test_reflectivity.py -v` | 21 项全部通过 | 包含六个真实 XOP 参考案例；与上一行有重叠，不能相加为独立覆盖数 |
| `npm test --prefix frontend` | 13 项通过 | 单位转换、配置文件、部分绘图几何工具通过 |
| `npm run build --prefix frontend -- --outDir /tmp/dxas-audit-build-20260922` | 通过 | 当前前端可构建；没有改写仓库的 dist |
| 浏览器交互 | Bragg/Laue 预设、Cu K 边、计算、比较、无效半径、比例切换、菜单与响应式检查 | 支撑本文明确列出的界面观察 |
| 有针对性的代码验证 | 延迟响应、null formatter、几何范围、enrichment 边界、fallback 恢复 | 支撑对应缺陷，不等于完整浏览器自动化回归 |

真实 XOP fixture 覆盖对称 Si(111)/(220)/(311)、Bragg/Laue、8 keV、+2 m、unpolarized，容差为 1%。它不是实验验证，也不能代表 Ge、非零 α、所有厚度/曲率和单一偏振都经过外部基准验证。

构建提示 Plotly chunk 约 1.13 MB、gzip 约 376 kB；目前已经动态加载。仅凭这个警告不能决定换绘图库或拆新框架。真实求解器测试有非致命 SWIG 提示及 `No module named 'matplotlib'` 输出，但断言均通过。

本轮没有完成屏幕阅读器全流程、全键盘矩阵、真实下载后再上传的浏览器文件往返、生产部署验证或完整 WCAG 审计。这些应进入后续验收，不应写成已经通过。

## 3. 已确认逻辑问题与修复契约

### F01 — 新草稿被旧请求标成“已计算”

**位置：** `frontend/src/App.jsx:369–432`（`calculate`）、`572–585`（`handleFieldChange`）、`562–570`（状态推导）。

成功响应无条件调用 `setDirty(false)`。普通字段编辑更新 `config`，却没有让正在运行的请求知道草稿版本已改变。请求序号只能防止两个请求乱序，不能防止“请求后又编辑、但没再发请求”。

**浏览器实际复现：** 选 Bragg Si(111) 预设，随即选 Cu K 边。请求完成后，能量输入是 **8978.9 eV**、元素为 Cu，界面却显示 **Calculation ready**、Bragg angle **14.31°**，比较栏 Current 仍是 **8000 eV**。再次点击 Recalculate 后角度变成 **12.72°**，才与输入一致。

**实施要求：** 每次提交带上不可变输入快照和草稿 revision。响应可以成为最后有效结果，但只有对应当前规范化输入时才算 current；更新结果不能自动清掉后来编辑产生的 stale 状态。422 字段错误也只能归属其请求快照，不能落到已经改变的字段上。

**验收：** 用可控延迟请求覆盖“编辑后成功返回”“编辑后 422 返回”“先 A 后 B 乱序完成”。任何时刻绿色 ready 都意味着当前可提交输入和 accepted result 是同一组科学参数。

### F02 — superseded 请求触发错误回滚

**位置：** `App.jsx:663–684`（`handleDiagramDistanceChange`）；`calculate` 在 `390`、`424` 将过期或 abort 也返回 `false`。

源码回调测试复现：图中 p 从 1.2 改到 2，首个请求尚未完成时 q 从 1.5 改到 2。第二个请求提交 p=2/q=2 并取消第一个；第一个回调把 p 回滚为 1.2。最终草稿 p=1.2/q=2、结果 p=2/q=2，且 dirty=false。

**实施要求：** 返回有类型的 outcome，例如 `accepted / invalid / failed / superseded`。取消或被替代不是输入验证失败。不要让旧请求修改新事务的草稿。优先保留用户草稿并显示错误；如保留图中回滚，必须绑定仍然有效的 request ID 和 draft revision，而不仅比较一个字段的值。

**验收：** 连续 p→q、q→p、同字段连续输入、拖动后键盘输入、取消、422、网络失败，都不能把后来的有效编辑撤销。

### F03 — unavailable 不得被格式化成零

**位置：** `frontend/src/components/ComparisonPanel.jsx:32–45,117–126`；`App.jsx:79–101,1261–1266`。

实际 formatter 执行结果：`formatValue(null)` 为 `0.000`；`formatDelta(null, 1.35, 'eV FWHM')` 为 `-1.350 eV FWHM`。后端在求解器忙、失败或部分 enrichment 不可用时，可以合法返回 null。这会把“未算出来”呈现为极好的分辨率。另一方面 `if (!baseline)` 又会丢掉真实 baseline=0 的比较。

**实施要求：** 所有 result surfaces 共用 null-safe formatter：null/undefined/非有限值显示 `Unavailable` 或 `—`，原因从 result warning/status 获取；真实 0 保留。只有两侧都是有效数值时才生成 delta。禁止只修 ComparisonPanel 而遗漏摘要、Advanced assumptions 和 tooltip。

**验收：** null/null、null/数值、数值/null、0/数值、0/0、负数与极小数分别测试。保持 eV/px 与 eV FWHM 的单位区分，不为缺失值生成“改善”结论。

### F04 — Physical scale 不能修改物理坐标

**位置：** `frontend/src/lib/opticsGeometry.js:1–2,19–44,74–105,119–122`。

- θ 被固定夹在 2°–42°，Physical scale 也受影响，图中 scattering angle 最大仅 84°；标签和投影数值却使用真实 θ。
- p/q 通过 `positiveDistance` 被夹在 0.05–50 m；后端接受范围之外的有限正距离。焦点距离同样经过距离映射。
- 函数验证：θ=55° 和 θ=80° 绘制同一个 84° 光路；p=0.005 画成 0.05 m，p=120 画成 50 m。
- 浏览器验证：Si(111)、2100 eV 的结果 θ=70.30°、2θ=140.59°，Physical scale 仍画出近乎向下的 84° 出射方向；标注的投影 1.159/0.952 m 与绘图位置不对应。

**实施要求：** 分离物理几何、schematic 映射和可拖动范围。Physical scale 的源、探测器、焦点、角度、投影使用真实有限值与同一坐标系。极端范围通过 viewport、缩放、离屏标记或明确的显示限制处理，不能偷偷改值。0.05–50 m 可以继续作为交互操纵范围，但不能成为物理数据的截断范围。

“源在右、探测器通常在左”不能演变成所有合法 backscattering 配置都强迫探测器在左。保持已经定义的 upper/lower、Bragg/Laue 符号约定。若 schematic 继续压缩某些量，必须明确说明压缩项；标签不能假装与被截断的坐标相符。

Physical scale 中器件图标、晶体厚度和示意光束包络目前仍有可读性放大，见 `opticsGeometry.js:106–117`。后续需明确“坐标按米，图标/包络示意”，或有独立科学依据地实现真实尺寸；不要让用户从画出的束宽反推计算束宽。

**验收：** 覆盖小角、常规角、>45°、接近 backscattering，p/q 超出拖动范围，实/虚焦点和四种 geometry/condition 组合。坐标、距离标签、投影与 API 数值自洽；切换显示比例不触发科学计算。

### F05 — enrichment 输出必须满足严格 JSON

**位置：** `dxascalc/reflectivity.py:203–208,763`；`dxascalc/web_api.py:319–321`。

重现请求：`{"source_size_um":1e308,"source_distance_m":0.01}`。输入本身有限，源尺寸分辨率转换却溢出；部分结果包含 `source_size_resolution_ev_fwhm: Infinity`，API 仍返回 200。严格 JSON 编码失败，浏览器也不能把该正文解析为 JSON。

**实施要求：** 在 enrichment 计算与序列化边界保护非有限输出；不能只依赖纯几何层的有限性检查。返回字段化错误，或保留其他有效结果、将失败项置 null 并给出特定 warning。不要粗暴把所有无效数值替成零。

**验收：** success、partial、fallback、busy 和 extreme-input 响应均能通过 `json.dumps(..., allow_nan=False)` 等严格检查；浏览器得到可解释错误，而不是通用 JSON 解析失败。

### F06 — 临时故障之后应能恢复 XOP

**位置：** `dxascalc/reflectivity.py:488,524–526`，`_solve_cached`。

当前 LRU 同时缓存正常 XOP 与 crystalpy flat fallback。模拟首轮 XOP timeout、后续恢复后，同一参数调用两次只执行一次 XOP，第二次继续复用降级结果，直到缓存淘汰或进程重启。

**实施要求：** 降级结果不进入长期成功缓存，或设有明确、可测的短 TTL/重试策略。保留并发、超时和容量限制，避免恢复机制变成无限重试。模型名称和 warning 必须随实际结果改变。

**验收：** 暂时失败后的同一配置可恢复主求解器；稳定成功仍命中缓存；忙状态或失败不会引发无界资源使用。

### F07 — 比较的是已计算快照，保存的是输入草稿

**位置：** `App.jsx:716–770,873–874`；`ComparisonPanel.jsx:48–54,79`。

Compare 取 `calculatedConfig/result`，Save 取当前 `config`；dirty 或错误草稿时 Compare 仍可用，Replace baseline 在 pending 期间也没有状态限制。第二次 Compare 点击只滚动到比较区，但按钮一直呈 pressed。比较标题只显示材料、hkl、能量、geometry、厚度，改 p/q/R 后两份配置的标签可能看起来完全相同。

**实施要求：** 明确分开“保存输入配置”和“固定已计算结果作为 baseline”。默认只能将当前且有效的 accepted snapshot 设为新 baseline；历史快照仍可查看，但要标清其参数和状态。比较区显示输入变化列表，至少包括所有不同的科学参数、单位，以及求解模型是否一致。对缺少结果或不同模型的 delta 给出上下文，不能暗示所有结果可直接等价比较。

建议动作名称区分 `Set baseline`、`View comparison`、`Replace baseline`，不要用假 toggle 语义。保存草稿可以保留，但 UI 要说明文件是输入配置、加载后要重新计算；不需要把输入文件擅自变成结果缓存或修改 v1 格式。

**验收：** 单独改 p、q、R、偏振都能看出两配置差异；pending/dirty/error 时按钮行为明确；显示的 Current 参数、指标和 warning 来自同一结果快照。

### F08 — 控件要容纳完整数值

**位置：** `frontend/src/styles.css:1795–1804,2681–2684,2729–2747`。

1280×800 下 Photon energy 实际 value=8978.9，但截图只看到 8978。DOM 测得输入宽约 95.625 px、字号 11 px、左右 padding 9/42 px，另有步进按钮与原生 number 控件占位。可读数字空间不足，不是数据舍入。

**实施要求：** 将单位、步进按钮与数字文本空间合理分配；必要时在窄 inspector 中让标签换行到输入上方。支持完整 eV 小数、负半径和小距离。不能通过截断值、减少科学精度或缩小字体来掩盖问题。

**验收：** 在默认与最小允许 inspector 宽度，静止未聚焦时也能读出 `8978.9`、`-123.456`、`0.005` 等代表值。不能要求用户先点击输入、横向滚动才知道实际值。

### F09 — 错误恢复与键盘操作

**位置：** `FieldControl.jsx:148–151`；`App.jsx:392–410,495–511,895–925`；`styles.css:2659–2668`。

- 单位元素 `aria-hidden`，部分字段的 accessible name/description 没有补充单位。
- 菜单标成 `menu/menuitem`，但缺少相应进入焦点和方向键行为。实现完整菜单，或使用更简单且正确的 disclosure 语义。
- 422 只提示查看高亮输入，不自动展开含错误的折叠区，也没有可跳转错误摘要。
- inspector 的 Edited/Synced/error 状态被样式隐藏，重要状态需要在实际可见的位置呈现。

**验收：** 不依赖鼠标也能改 p/q、展开 inspector、操作菜单与对话框、到达首个错误；朗读数值时能知道单位；错误不会只藏在折叠区或视口外。保留已有 About 焦点管理和 Escape 行为，不能因为提取组件而回退。

## 4. 科学议题：记录边界，另行审定

以下不应混进普通 UI/结构重构中修改公式。

### M01 — 模型适用范围尚未成为用户可见契约

`calculator.py:225–240,409–433,549–560` 允许 full divergence 在 `(0, π)` 的几何域内，但使用的能量色散表达有其近似范围。默认 8 keV 配置只把 divergence 改成 100 mrad，即返回约 10758.63 eV span；3000 mrad 返回约 2241901.86 eV，仅有 virtual-focus 类提示。

这证明当前数学输入域远宽于通常使用情景，**不证明可以随便选择新的硬上限**。科学负责人需要定义适用条件、超范围 warning/error 策略和可信参考案例。后续模型不得凭直觉添加一个“合理数字范围”，也不得把 legacy Laue 加号改掉。

### M02 — 卷积资源上限与有效输入范围耦合

`reflectivity.py:45,620–628,736–773`：默认配置 source size=100 µm 可计算，200 µm 时 total resolution 为 null，伴随 `resolution_enrichment_failed`，源于网格和 4097-point kernel 上限。这是受控失败，不能写成崩溃；有效 intrinsic 结果仍应保留。

未来可独立研究卷积网格重采样与资源预算，使用可信数值参考、误差阈值和压力测试验证。不得简单删除资源上限、降采样标量计算或把缺失 total 当作 intrinsic 的同义值。现有 10001 点扫描没有在本轮被证明欠采样，不要把“需要自适应扫描”写成已确认缺陷。

### M03 — 几何核心与求解器的材料数据来源不完全一致

`calculator.py:20–24` 固定 Si=5.431 Å、Ge=5.65 Å；`reflectivity.py:325–337` 使用 xraylib 材料。当前 Ge(111)、8 keV 核心 θ≈13.742123°，xraylib 几何 θ≈13.723894°，对应 d 值也不同。

先记录材料数据、版本与 legacy 来源。是否统一以及采用哪组常数，属于独立科学变更，需要审定和新参考结果；不能为了代码复用偷偷统一并更新所有 golden values。

### 不可破坏的科学约定

1. 负 bending radius 有效；符号不得在核心几何中丢弃。
2. signed span/width 与非负显示 magnitude 分离；focus 保留正负和 real/virtual，image inversion 用明确语义表示。
3. detector sampling 的单位是 eV/px，它不是 instrument energy FWHM。
4. total 是晶体响应、Gaussian source、单像素 top-hat 的数值卷积估计，不得改成简单 RSS 或只取晶体宽度。
5. FWHM 取包含全局峰值的连通主瓣；不能横跨不相连旁瓣计算一个总宽度。
6. Laue legacy span 的加号约定仍未解决，detector-space Borrmann fan 未单独建模。
7. Bragg 的 multilamellar、Laue 的 Penning–Polder 与 flat-perfect-crystal fallback 必须明确区分。
8. 保留 XOP 独立临时目录、参数列表调用、超时、有限队列与并发、有限缓存；禁止恢复旧 Notebook 文件副作用。
9. 全 10001 点用于标量与卷积，最多 2501 点用于显示。这两层不能混淆。
10. “输入验证”“legacy 回归”“solver 回归”“实验验证”是不同证据，文案不能互相替代。

## 5. UI 审美与用户体验指导

### U01 — 保留视觉语言，调整信息优先级

现有界面干净、颜色克制，光路图能解释配置，是值得保留的主体。问题是结果层级：六项指标以 3×2 呈现，Bragg angle 已在光路摘要出现，仍与核心输出占同等大块区域；Estimated total resolution 反而位于第二行，视觉强调较弱。

建议默认突出四项：**Energy span、Beam width、Detector sampling、Estimated total resolution**。θ、2θ、focus、image orientation 放进紧凑的 geometry readout，仍保持容易查到。对不同物理单位和估计/实测属性继续明确标注；不能仅用色彩表达差别。

在 1440×1000 当前画布和状态区占据大部分首屏；1280×800 时核心结果刚进入屏幕，total 与 Detector 输入需要下滚。根据 viewport 高度调整画布占比，让桌面用户较容易同时看到光路、四项主要输出和相关输入。可考虑约 360–560 px 的自适应画布高度作为试验起点，但以实际光路可读性验收，不把这个建议当不可变规格。

### U02 — 让专家读得清，而不是一味压缩

当前参数标签多为 10 px、输入约 11 px，说明文字部分为 8–10 px。数值单位、图例和模型说明在高密度页面中偏小。建议主要控件/标签约 12–13 px，次要说明约 11–12 px，关键数值使用 tabular numerals；以完整值可读和真实桌面截图验收。

可以适当增加默认 inspector 宽度，并保留用户可调宽度。空间紧张时优先重排控件、压缩重复解释、折叠次要细节，不缩小到隐藏尾数。避免用更多阴影、渐变或卡片来制造“新设计感”。

建议收敛为少量排版、间距、边框 token；延续已有 warm off-white、muted violet、blue/violet rays。保留状态的文字/图标语义。颜色对比度需要实际测量，本轮没有宣称现有界面完整满足或违反某项 WCAG 等级。

### U03 — 状态靠近用户正在看的结果

保留最后有效结果是正确策略，但主结果、晶体响应、比较和 inspector readout 都要共享明确的快照状态。用户滚动到比较区后不能只靠页面最上方的一个 stale 提示判断是否可用。

建议轻量显示 `Calculated: Si(111), 8000 eV`、`Changes not calculated` 或 `Showing previous result`，并在有差异时列出修改了哪些参数。只有真正失败的输入才显示 error；虚焦点和 image inversion 属于几何状态，不应默认变成红色失败。

Laue Borrmann-fan 提示在当前顶部 banner、Crystal 提示和 model 文案中多处重复。保留结果附近的关键限制，完整解释收纳到可展开 assumptions；不要把全部科学限制藏起来，也不要反复占用首屏。

### U04 — 把比较接近迭代任务

当前 Compare 自动把用户滚到晶体曲线和覆盖区之后，右侧 inspector 已滚出视野，用户改参数后又要来回移动。建议比较区靠近主要结果，或有明确的 Results / Comparison 视图切换，并保持当前参数可达；不得用新的全宽 band 截断右侧 inspector。

比较应先回答“改了什么”，再回答“结果变了多少”。一个紧凑输入 diff 和数值表比两个相同的 Si(111) 标签更有效。baseline 可以保留本次会话内的单份快照；多项目管理、云同步、登录、数据库都不是这轮必要范围。

### U05 — 响应式与图表交互

390×844 检查没有页面水平溢出，基础堆叠是有效的。但开启比较后参数 inspector 在约页面 y=2450 px 才出现，修改配置非常迟。窄屏可提供 `Parameters`/`Results` 跳转或调整区域顺序；优先保持自然文档流，不沿用桌面固定分区高度。

光路保留拖动、精确 p/q 编辑、键盘替代、guides 和两个比例模式。减少工具栏、图例和标签碰撞；给缩放后的 reset 行为明确名称。Plotly 导出图是否包含 HTML p/q overlay 尚需专门检查，未确认前不要承诺导出的图片包含全部参数注释。

重构后的建议布局关系：

```text
Header: Bragg/Laue | preset | calculate + state | compare | file menu
┌──────────────────────────────────────┬───────────────────────┐
│ Optical geometry + view controls     │ Crystal               │
│ p/q edits + compact geometry readout │ Geometry              │
├──────────────────────────────────────┤ Detector              │
│ Four primary outputs + result state  │                       │
│ Comparison, when requested           │ Continuous inspector  │
│ Crystal response + model summary     │ with readable inputs  │
│ Coverage / detailed assumptions      │                       │
└──────────────────────────────────────┴───────────────────────┘
```

这是信息组织建议，不是推翻 `frontend/AGENTS.md` 的新视觉稿。右侧连续 inspector、左侧结果/响应/coverage 的基本方向必须保留。

## 6. 推荐的内部结构和状态契约

### 6.1 一个可解释的计算会话

不要再依赖多个互相独立的 boolean 共同维护真实性。可以用 reducer 或小型 hook；不必引入全局状态框架。

```text
draft:           用户原始输入、revision、字段解析状态
pendingRequest:  id、submittedRevision、canonicalConfig、startedAt
acceptedResult:  requestId、canonicalConfig、result、warnings、model provenance
baseline:        一个完整 acceptedResult 快照
viewState:       scale、guides、zoom、panel sizes、expanded sections
```

- `isCurrent` 从当前可解析的 canonical config 与 accepted config 的关系推导；revision 用于请求所有权，不能因为“改回相同值”永久误判 stale。
- 原始字符串输入可以暂时为空、负号或正在编辑的科学记数法。解析状态和领域有效性分开；不要用默认值偷偷替代缺失输入再呈现为计算成功。
- 每份 result、warnings、响应曲线和模型名称作为一个快照接受；不得分别到达后混配。
- AbortController 用于减少无用工作，request ID/revision 用于保证正确性；只 abort 不能替代状态验证。
- 普通数值/edge 编辑继续采用显式 Recalculate；预设、geometry、load、图中 p/q commit 保留当前自动提交路径。所有入口经过同一个协调器。若未来改成全面自动计算，应另行评估负载和交互，不在结构拆分时暗改行为。
- 输入错误保留草稿及最后有效结果；展开相关 section，并提供到错误字段的可达路径。
- guides、scale、zoom、layout resize 只更新 viewState，不触发计算 API。
- API 和配置文件继续使用 `energy_kev`；UI 使用 eV，转换集中在边界，避免来回格式化改变原值。
- 未编辑 thickness 时 Bragg/Laue 默认分别为 200/50 µm；用户手动编辑和文件载入后的厚度不被 geometry 切换覆盖。preset/reset 的重置行为单独定义并测试。

### 6.2 拆分按职责进行

当前 `App.jsx` 1645 行、`OpticsCanvas.jsx` 934 行、`styles.css` 3369 行。行数不是错误，但状态、输入、请求、布局和反馈共同集中使 F01/F02 很难可靠维护。

可按以下职责渐进提取，名称仅为建议，不要求照抄目录结构：

| 责任 | 建议归属 | 不应承担 |
| --- | --- | --- |
| 草稿、请求、accepted snapshot、错误状态 | `useCalculationSession` / reducer | 科学公式、Plotly 样式 |
| 输入 canonicalization、单位、preset/thickness 转移 | `lib/configuration*` / `lib/energyUnits` | 网络、图表 |
| API 调用及可区分的错误结果 | `lib/apiClient` | 修改 React 草稿 |
| 数值与 delta 展示 | `lib/formatMetrics` | 给缺失值编造默认数 |
| Header、Inspector、结果与 model 信息区 | 专用组件 | 各自创建独立计算状态 |
| 真实坐标与 schematic 映射 | `lib/opticsGeometry` 内明确分层 | 复制后端光学求解公式 |
| Plotly traces/layout | 图表构建模块 | 直接改变表单 |
| 拖动、键盘、inline editor 提交 | 光路 interaction controller | 绕过统一请求协调器 |
| 文件 save/load | 现有文件格式模块 + 小型 UI adapter | 直接信任文件内结果 |

`OpticsCanvas.jsx:597–605` 还通过固定 annotation index 定位编辑框，拆分时改成稳定语义映射，避免加一个注释就把 p/q 控件移到错误位置。

CSS 先标明当前有效规则，再逐组件收敛重复定义和历史 selector；不要继续在文件末尾叠加另一套覆盖样式。无需在本轮引入新 UI 框架、迁移 TypeScript、换 bundler 或替换 Plotly。

后端保留 `models → calculator → reflectivity → web_api` 边界。F05/F06 是局部可靠性修复；模型常数、公式和适用范围变更另行处理。

## 7. 分阶段执行计划

每一阶段应有可单独 review 的 diff、对应测试和实际截图/行为证据。不要一个提交同时改公式、状态架构和全站样式。

| 阶段 | 工作范围 | 完成门槛 |
| --- | --- | --- |
| A. 基线 | 重读当前 instructions/status；确认运行目录与构建；记录代表配置及截图 | 明确包含哪些已有用户修改，不覆盖它们 |
| B. 结果真实性 | F01/F02/F03；会话状态、请求 outcome、统一 formatter | 先加入能复现缺陷的测试，再使其通过；旧结果状态一致 |
| C. 绘图真实性 | F04；物理坐标/显示映射/操纵范围分离 | 大角度与范围外距离自洽，交互与键盘无退化 |
| D. API 健壮性 | F05/F06 | 严格 JSON 和故障恢复测试通过；资源边界保留 |
| E. 工作流与视觉 | F07/F08/F09、U01–U05；组件提取、CSS 收敛 | 桌面完整数值可读，核心输出层级清楚，比较与错误恢复顺畅 |
| F. 文档与回归 | 更新 architecture/scientific wording/design QA；补运行验证说明 | 每项结论有证据，未覆盖的限制被如实记录 |

F 阶段的 scientific 文档更新以说明现状和 provenance 为主，不意味着批准 M01/M03 的数值变更。M02 如需新数值算法，应作为独立科学/性能任务。

如由多个模型协作，分配互不重叠的文件或职责；共享状态契约先定下来。不要两个模型同时重写 `App.jsx` 或 `styles.css`，再依赖人工拼接不同状态模型。

## 8. 验收矩阵

| 场景 | 必须观察到的行为 |
| --- | --- |
| 首次加载、preset/edge catalog 失败 | 可理解 loading/error/retry；不可显示虚构成功 |
| preset 请求中改 Cu K edge | 8978.9 eV 草稿不会被 8000 eV 结果标 ready |
| A→B 请求逆序完成 | 旧响应不能覆盖较新 accepted snapshot |
| 请求中编辑后返回 422 | 错误属于相应参数版本，不能误标新草稿 |
| 图中 p→q 快速提交 | 无跨请求回滚；所有字段与 accepted config 一致 |
| p/q 拖动、inline 输入、键盘、inspector | 使用统一验证与提交规则；明确 draft/commit 时机 |
| null/undefined/0/极小值 | unavailable 与真实零不同；无虚假 delta |
| 422：R=0、Si(100)、零 hkl、不可达能量 | 正确字段消息、展开/定位、最后有效结果明显 stale |
| Bragg↔Laue 未改/已改 thickness | 默认转换正确，手动厚度不丢失 |
| eV 边界往返 | 8978.9 eV ↔ 8.9789 keV；保存再加载不发生 1000 倍偏差 |
| malformed/oversize/unknown-version 配置 | 可解释错误，保留现有工作；文件大小限制仍在 |
| 有效但物理无效配置载入 | 草稿/验证失败语义清晰，不能宣称已有成功计算 |
| 2100 eV Si(111)、θ>45°、小角 | Physical scale 的光路、角度和投影一致 |
| p/q=0.005、120 m 等范围外值 | 物理图不静默裁成 0.05/50 m；交互限制单独说明 |
| 虚焦点、实焦点、过焦点 image inversion | 符号、方向与文字一致，示意缩放不改变科学值 |
| 同配置 XOP 暂时失败后恢复 | fallback 如实标示，之后可回到 XOP，正常缓存仍有效 |
| enhancement 溢出、busy、部分失败 | 所有响应严格 JSON；保留可用数据且解释不可用项 |
| baseline/current 的 p/q/R/偏振不同 | 比较区能读出输入差异、状态与模型来源 |
| 1280×800 / 1440×900或1000 / 1920×1080 | 完整数字和核心结果可读，长文案不撑坏 inspector |
| 最小/默认/较宽 inspector，section resize/reset | 不隐藏数字、单位、error；键盘 resize 仍可用 |
| 390×844 与 820×900 | 无整体横溢出，参数可达，自然内容流 |
| keyboard / zoom200% / reduced motion | 焦点可见、无意外陷阱、菜单与错误可操作 |
| guides/scale/zoom/layout resize | 不触发 `/api/calculate`，不改变配置或结果 |

前端现有 Node 工具测试不足以证明这些契约。为真实状态路径增加 component/integration 测试，再用浏览器验证布局和交互；不要只复制当前错误实现写成测试 expected。后端现有 API 测试主要注入/关闭真实 enrichment，需要补上可控 partial/fallback/busy 契约。

常规回归保留：

```bash
.venv/bin/python -m unittest discover -s tests -v
npm test --prefix frontend
npm run build --prefix frontend
DXASCALC_RUN_XOP_INTEGRATION=1 .venv/bin/python -m unittest discover -s tests -p test_reflectivity.py -v
```

真实 solver suite 在依赖与平台可用时运行；若跳过，最终交付必须明确。不要用跳过的测试宣称 solver 已验证，也不要未经科学依据修改旧 fixture 以让测试通过。

## 9. 文档与可追溯性清理

- `design-qa.md:29` 仍称 source/crystal 未建模，与当前实现不一致；`17` 仍描述 full-width coverage，与当前右侧连续 inspector 要求不符；`34` 是旧 keV 输入步进说明。文档内五个历史图像路径在本地均不存在。其旧 `passed` 结论不能作为当前验收结果。
- `docs/ARCHITECTURE.md` 后端边界清楚，但缺少前端 draft/request/accepted snapshot 的所有权契约，应补上。
- `docs/SCIENTIFIC_MODEL.md` 的输入单位表需明确 UI 是 eV，API/保存格式是 keV。保持其现有 signed geometry 和模型限制说明。
- `README.md` 中的 `validated` 应准确说明验证范围，避免让用户理解为完整实验验证。
- `environment.yml:6` 固定 Python 3.8，而 web 项目要求 ≥3.9。标明 Notebook legacy 环境用途，或单独整理 web 环境说明。
- `/api/health` 仅返回 status=ok。它不能证明前端版本、solver 可执行性或科学结果正确。后续运行检查要分别验证服务、构建版本、代表计算和模型来源；可增加轻量版本/provenance 信息，但无需扩展成新的部署平台。

## 10. 可直接交给后续模型的任务说明

```text
你将根据 docs/REFACTOR_GUIDE.md 重构 DXASCalc。
先读取当前工作区 instructions、git status/diff、科学契约和本指南。
以用户已有未提交修改为基线，保留它们。

本轮实施范围：[由任务发起者指定上述阶段，例如 B–D]。
先复现该阶段问题并建立有意义的回归测试，再进行最小必要的职责拆分。
始终区分 draft、pending request、accepted result、baseline 和 view state。
不得以 null=0、改变符号、截断物理参数、修改 fixture 或隐藏 warning 解决问题。
保持 geometry-first 桌面布局和现有 Dr. XAS 视觉语言；保留 eV UI/keV API兼容性。
科学公式、Laue 符号和材料常数议题不得在普通结构/视觉重构中修改。

逐阶段验证并报告：修改了什么、如何复现/验证、哪些测试未覆盖、仍有何限制。
未获得独立指令时，不提交、推送、部署或改动外部服务。
不要将通过构建、health 或旧 design QA 等同于所有逻辑/UI/科学验证都通过。
```

本指南的第一验收标准是：**研究人员看到的参数、光路、结果、比较及状态必须彼此一致，并能辨认模型估计和不可用数据。** 结构整理与视觉改进都应服务这一点。
