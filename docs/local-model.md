# 网站聊天：本地模型 + 长期记忆 + 提问时现扫

访客在网站聊天框提问时，`worker/index.js` 这样找人回答：

1. **本地**：通过 Cloudflare Tunnel 问你 Mac 上的 `local/agent.mjs`。它**当场**扫一遍你最近在做的事（最近几天你自己的 git 提交，加上 `~/now.md`），再交给 LM Studio 里的 Qwen 回答。
2. **云端兜底**：Mac 关机、合盖或隧道断了，就用 Workers AI 回答。它看不到你今天在做什么，被问到时会说"最新动态要等我电脑在线才能看"。
3. **都不行**：浏览器里的 `scripts/app.js` 用网站内容简单回答。

两种模型都会先读**你自己写的长期记忆**（存在 Cloudflare KV 里，见第 6 步），再读网站内容。本地回答时，回复下面会多一行小字 "Answered by a small model running on my own laptop."

只做第 6 步也有用：云端模型马上就会按你写的记忆说话。

---

## 1. LM Studio 开服务

LM Studio → **Developer** → 加载 Qwen3.5 9B → 打开本地服务器。端口以设置页「基础 URL」为准，你的是 `1235`。建议关掉闲置自动卸载模型。

## 2. 装 Mac 小程序（agent）

需要 Node.js（`node -v` 能看到版本就行，没有就 `brew install node`）。在仓库根目录：

```bash
# 第一次运行会生成 ~/.gloria-agent.json，里面已经有随机生成的 token
node local/agent.mjs
```

打开 `~/.gloria-agent.json`，把 `dirs` 改成你放项目的文件夹，比如 `["~/Projects", "~/Documents/GitHub"]`。其他可选项：

- `exclude`：不想让模型提到的仓库文件夹名
- `authors`：只算这些邮箱的提交（默认是你的 git user.email，队友的提交不算）
- `days`：多少天内算"最近"（默认 7）
- `note`：你自己写近况的文件（默认 `~/now.md`，写一两句"这周在忙什么"，优先级最高）

先看看它扫到了什么：

```bash
node local/agent.mjs --scan
```

没问题就装成后台常驻（开机自动启动，挂了自动重启）：

```bash
bash local/install-launchd.sh
```

本机测试（把 TOKEN 换成配置文件里的 token）：

```bash
curl -s localhost:8788/health -H "authorization: Bearer TOKEN"
curl -s localhost:8788/chat -H "authorization: Bearer TOKEN" -H 'content-type: application/json' \
  -d '{"system":"You are Gloria.","messages":[{"role":"user","content":"你最近在做什么？"}]}'
```

日志在 `~/Library/Logs/gloria-agent.log`。

> 如果项目放在「文稿」或「桌面」里，macOS 会挡住后台程序读取。到 系统设置 → 隐私与安全性 → 完全磁盘访问权限，把 `node` 加进去（路径用 `which node` 查）。

## 3. Cloudflare Tunnel（让网站连到 Mac 小程序）

前提：`gloriaqi.site` 已经加进 Cloudflare 并显示「活动」。

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create gloria-llm
cloudflared tunnel route dns gloria-llm llm.gloriaqi.site
```

`~/.cloudflared/config.yml`（隧道只连小程序，LM Studio 不暴露出去）：

```yaml
tunnel: gloria-llm
credentials-file: /Users/你的用户名/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: llm.gloriaqi.site
    service: http://localhost:8788
  - service: http_status:404
```

```bash
cloudflared tunnel run gloria-llm          # 先手动跑一次试试
sudo cloudflared service install           # 之后开机自动启动
```

## 4. 加访问保护

小程序本身要 token，再用 Cloudflare Access 加一层，只放行网站的 Worker：

1. Zero Trust → **Access → Service Auth → Service Tokens** → Create，记下 Client ID 和 Client Secret。
2. **Access → Applications → Add → Self-hosted**，域名填 `llm.gloriaqi.site`。
3. 策略：Action 选 **Service Auth**，Include 选刚才的 service token。

## 5. 把地址和密钥交给 Worker

Cloudflare 后台 → Workers 和 Pages → `gloria-qi` → 设置 → 变量和机密，添加这四个「机密」（或用 `npx wrangler secret put <名字>`）：

| 名字 | 值 |
| - | - |
| `LOCAL_AGENT_URL` | `https://llm.gloriaqi.site` |
| `LOCAL_AGENT_TOKEN` | `~/.gloria-agent.json` 里的 token |
| `CF_ACCESS_ID` | 第 4 步的 Client ID |
| `CF_ACCESS_SECRET` | 第 4 步的 Client Secret |

## 6. 写你的长期记忆

Cloudflare 后台 → 存储和数据库 (Storage & databases) → Workers KV → 打开名字里带 `MEMORY` 的那个（第一次部署后自动创建）→ 添加条目：

- 键 (Key)：`memory`
- 值 (Value)：用你自己的话写，比如你是谁、性格、偏好、说话风格、哪些话题不想聊

保存后一分钟内生效，想改随时回来改。注意：访客在聊天里可能把这些内容问出来，真正的秘密不要写进去。

## 7. 验证

```bash
curl -s https://gloriaqi.site/api/chat -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"你最近在做什么？"}]}'
```

返回里 `source` 是 `"local"` 说明是你的 Mac 在回答，`"cloud"` 说明走了兜底。为什么切到云端可以看 Cloudflare 后台 → Workers → gloria-qi → 日志，里面会有 `chat: local failed: ...`。

## 注意

- 要让本地模型接访客，Mac 要开着、醒着。插电时可以 `caffeinate -s`，或用 Amphetamine。
- 每个访客 IP 每分钟最多 10 条（`wrangler.jsonc` 里的 `CHAT_LIMIT`）。
- 小程序只读 git 提交记录和 `now.md`，不会读别的文件；离开 Mac 的只有模型写出的回答。
- 9B 模型偶尔会答偏，页面底部有 "It can make mistakes" 的提示。
