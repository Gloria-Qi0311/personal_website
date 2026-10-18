# 把本地模型接到网站聊天框

网站的聊天框发消息到 `POST /api/chat`，由 `worker/index.js` 处理，按这个顺序找人回答：

1. **本地**：Mac 上 LM Studio 里跑的 Qwen，经 Cloudflare Tunnel 访问。
2. **云端兜底**：Mac 关机、合盖或隧道断了，就用 Workers AI（免费额度每天 10,000 neurons）。
3. **都不行**：浏览器里的 `scripts/app.js` 用网站自己的内容简单回答，聊天框不会挂。

本地回答时，回复下面会多一行小字 "Answered by a small model running on my own laptop."

只部署代码、不做下面的步骤也能用：这时所有回答都走 Workers AI。

---

## 1. LM Studio 开服务

1. LM Studio → **Developer** → 加载 Qwen3.5 9B → **Start Server**。端口以设置页「基础 URL」为准，你的是 `1235`，下面都按 1235 写。
2. 在设置里关掉闲置自动卸载模型（或把 TTL 调长），不然第一个访客要等模型重新加载。
3. 模型 id 不用填：`LOCAL_LLM_MODEL` 留空时，Worker 会用 LM Studio 列出的第一个聊天模型。想固定某一个，再用下面的命令查 id 填进去：

   ```bash
   curl -s localhost:1235/v1/models | jq -r '.data[].id'
   ```

## 2. Cloudflare Tunnel（给本地服务一个公网地址）

固定地址需要一个托管在 Cloudflare 上的域名（Cloudflare Registrar 买一个即可）。

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create gloria-llm
cloudflared tunnel route dns gloria-llm llm.你的域名.com
```

`~/.cloudflared/config.yml`：

```yaml
tunnel: gloria-llm
credentials-file: /Users/你的用户名/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: llm.你的域名.com
    service: http://localhost:1235
  - service: http_status:404
```

```bash
cloudflared tunnel run gloria-llm          # 先手动跑一次试试
sudo cloudflared service install           # 之后开机自动启动
```

> 暂时没有域名：`cloudflared tunnel --url http://localhost:1235` 会给一个 `*.trycloudflare.com` 临时地址，可以先试通，但每次重启都会变，也没法加下一步的访问保护。只适合测试。

## 3. 加访问保护（必须做）

LM Studio 本身没有鉴权，隧道地址一旦泄露，谁都能用你的电脑跑模型。用 Cloudflare Access 只放行网站的 Worker：

1. Zero Trust → **Access → Service Auth → Service Tokens** → Create，记下 Client ID 和 Client Secret。
2. **Access → Applications → Add → Self-hosted**，域名填 `llm.你的域名.com`。
3. 策略：Action 选 **Service Auth**，Include 选刚才的 service token。

## 4. 把地址和密钥交给 Worker

在仓库根目录：

```bash
npx wrangler secret put LOCAL_LLM_URL      # https://llm.你的域名.com（不带 /v1）
npx wrangler secret put CF_ACCESS_ID
npx wrangler secret put CF_ACCESS_SECRET
```

（如果你的 LM Studio 版本开了 API token，再加 `LOCAL_LLM_KEY`。）

## 5. 验证

```bash
# 隧道 + Access 通了吗（应返回模型列表；不带 header 应被拦）
curl -s https://llm.你的域名.com/v1/models \
  -H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET"

# 网站接口：source 是 "local" 说明 Mac 在回答，"cloud" 说明走了兜底
curl -s https://gloria-qi.glqi63583.workers.dev/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"你最近在做什么？"}]}'
```

Worker 日志（Cloudflare 后台 → Workers → gloria-qi → Logs）里会看到 `chat: local failed: ...`，说明为什么切到了云端。

## 6. 让网站知道你"现在在做什么"

模型自己没有记忆，只知道每次被塞进提示词的文字。`local/now-sync.mjs` 每 30 分钟在 Mac 上做一次：

1. 看你指定的文件夹里，最近 7 天你自己提交过的 git 仓库（提交说明 + README 第一段），再加上 `~/now.md`（可选，你自己写的一两句话，优先级最高）。
2. 让本地 Qwen 写成 3 到 6 条公开的"我最近在做什么"。
3. **只上传这段摘要**到 `POST /api/now`，存在 Cloudflare KV。两个模型每次聊天都会读它，Mac 关机时用的是最后一次的快照。

活动没变化时脚本什么都不做，不会重复调用模型。

**设置（一次）**

```bash
# 1. 生成一个密钥，存到 Worker（或在 Cloudflare 后台 → Workers → gloria-qi → 设置 → 变量和机密 里加 NOW_TOKEN）
openssl rand -hex 24
npx wrangler secret put NOW_TOKEN

# 2. 第一次运行会生成 ~/.gloria-now.json，把 token 和 dirs（你放项目的文件夹）填进去
node local/now-sync.mjs

# 3. 先预览摘要，不上传
node local/now-sync.mjs --dry-run

# 4. 没问题就装成定时任务（每 30 分钟 + 开机时）
bash local/install-launchd.sh
```

`~/.gloria-now.json` 里还可以设：`exclude`（不想公开的仓库文件夹名）、`authors`（只算这些邮箱的提交，默认是你的 git user.email）、`days`（多久内算"最近"）。

查看当前网站拿到的内容：`curl -s https://gloria-qi.glqi63583.workers.dev/api/now`。日志在 `~/Library/Logs/gloria-now.log`。

> 如果项目放在「文稿」或「桌面」里，macOS 会挡住后台任务读取。到 系统设置 → 隐私与安全性 → 完全磁盘访问权限，把 `node` 加进去（路径用 `which node` 查）。

## 注意

- 想让本地多接访客，Mac 要保持唤醒：插电时 `caffeinate -s`，或用 Amphetamine。合盖就会切到云端。
- 每个访客 IP 每分钟最多 10 条（`wrangler.jsonc` 里的 `CHAT_LIMIT`）。
- 两个模型都只拿到 `/llms-full.txt` 作为资料，回答范围就是网站内容。改了网站内容重新 build 就会同步。
- 9B 模型偶尔会答偏或编细节，系统提示已经要求它只用网站内容，页面底部也有 "It can make mistakes" 的提示。
