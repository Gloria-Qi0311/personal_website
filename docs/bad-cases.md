# 追踪编号和 bad case 集

## 追踪编号

聊天框里每条回答下面都有一个编号，比如 `GQ-20261019-E3967B0C`，点 Copy 复制。

每条回答都存在 Cloudflare D1 数据库 `gloria-chat-logs` 的 `chat_logs` 表里：编号、时间、问题、回答、谁答的（`local` 本地 Qwen / `cloud` Workers AI / `page` 两个都不在线，由网页自带的回答兜底）、之前的对话、部署版本。不存访客 IP。

查一条：Cloudflare 后台 → Storage & Databases → D1 → `gloria-chat-logs` → Console：

```sql
SELECT * FROM chat_logs WHERE trace_id = 'GQ-20261019-E3967B0C';
```

## Bad case 集

`evals/bad-cases.json`，每条：

| 字段 | 意思 |
|---|---|
| `id` | BC-001、BC-002… |
| `traceId` | 出问题那次回答的编号 |
| `question` | 访客问的问题 |
| `badAnswer` | 当时错在哪 |
| `expected` | 应该怎么答 |
| `checks.mustInclude` | 回答里至少要出现其中一个词（可选） |
| `checks.mustNotInclude` | 回答里不能出现的词（可选） |

**报一个 bad case**：把编号和“应该怎么答”发给 Claude，它会查记录、加一条，并修好。

**改聊天功能之前**，对预览地址跑一遍，全部 PASS 才合并：

```bash
node scripts/eval-bad-cases.js https://<预览地址>
```
