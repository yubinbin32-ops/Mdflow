# Express 5.2.1：mdflow 与 Markdown 对比

本页是可复现的确定性上下文基线，不是“真实模型速度”结论。两条路径使用同一份 Express 5.2.1、同一个 commit、同三条任务；mdflow 先读任务上下文，再只展开任务需要的 Block，Markdown 路径每次读取完整 handoff。

## 结果

| 指标 | mdflow-first | markdown-first | 差异 |
| --- | ---: | ---: | ---: |
| 任务数 | 3 | 3 | 相同任务集 |
| 总上下文 token（cl100k_base） | **7,788** | 10,029 | **mdflow 少 22.35%** |
| 总字符 | **21,283** | 43,899 | **mdflow 少 51.52%** |
| 事实召回 | 12 / 12 | 12 / 12 | 相同 |
| 返工代理次数 | 0 | 0 | 相同 |
| 上下文组装时间（Node 本地） | 64.43 ms | 11.09 ms | mdflow 多 53.34 ms |

任务级 token：

| 任务 | mdflow | Markdown | token 变化 | 事实召回 |
| --- | ---: | ---: | ---: | ---: |
| Response boundary | 2,576 | 3,343 | -22.95% | 4 / 4 vs 4 / 4 |
| Error path | 2,774 | 3,343 | -17.02% | 4 / 4 vs 4 / 4 |
| Release contract | 2,438 | 3,343 | -27.07% | 4 / 4 vs 4 / 4 |

## 如何解读

- mdflow 的优势在于任务上下文的范围和关系：同样的事实召回，平均少传约五分之一 token，并把 Block → Chain → Link → Checkpoint → Plan 顺序固定下来。
- 本地组装时间反而更高，因为它包含 SQLite 查询、关系筛选和 checkpoint 投影；这不是 AI 响应速度，也不是人类阅读速度。
- 要把“开发速度”写成产品结论，还必须接入真实模型/代码编辑器，记录首轮定位、修改成功率、测试回合和恢复回合。本报告明确 `llmClaim=false`，不把脚本时间冒充模型速度。
- Markdown 对照材料故意是完整 handoff，而不是一页 README；它代表“为了不丢架构而把所有说明重新塞进上下文”的成本。

## 固定输入

- 上游：[expressjs/express](https://github.com/expressjs/express)
- 版本：Express 5.2.1
- commit：`023767fe9872e029271df1418f73401bff20ff40`
- 全量测试：`npm test`，1260 passing (2s)
- 图谱：11 Blocks、12 Links、3 Chains、1 Foundation Plan、11 Block checkpoints、3 Chain gates、1 Plan acceptance
- 图谱校验：valid，0 errors，0 warnings

完整 JSON 结果见 [`results.json`](./results.json)，对照材料见 [`markdown-baseline.md`](./markdown-baseline.md)，可读取的样本图谱见 [`.mdflow`](./.mdflow/)。

## 图文资产

![App 架构画布到发布 Plan](./mdflow-release-walkthrough.gif)

这段 GIF 由真实 App 截图组成：先展示完整 Canvas，再展示发布 Plan 的 Block/checkpoint 进度。单帧见 [`mdflow-overview.png`](./mdflow-overview.png) 和 [`mdflow-release-plan.png`](./mdflow-release-plan.png)。用户提供 15 秒产品视频后，再替换为最终宣传 GIF。
