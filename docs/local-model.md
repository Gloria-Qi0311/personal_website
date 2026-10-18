# 把本地模型接到网站聊天框

网站的聊天框发消息到 `POST /api/chat`，由 `worker/index.js` 处理，按这个顺序找人回答：

1. **本地**：Mac 上 LM Studio 里跑的 Qwen，经 Cloudflare Tunnel 访问。
2. **云端兜底**：Mac 关机、合盖或隧道断了，就用 Workers AI（免费额度每天 10,000 neurons）。
3. **都不行**：浏览器里的 `scripts/app.js` 用网站自己的内容简单回答，聊天框不会挂。

本地回答时，回复下面会多一行小字 "Answered by a small model running on my own laptop."

只部署代码、不做下面的步骤也能用：这时所有回答都走 Workers AI。

---

## 1. LM Studio 开服务

1. LM Studio → **Developer** → 加载 Qwen3.5 9B → **Start Server**（默认端口 `1234`）。
2. 在设置里关掉闲置自动卸载模型（或把 TTL 调长），不然第一个访客要等模型重新加载。
3. 查模型 id，填到 `wrangler.jsonc` 的 `LOCAL_LLM_MODEL`：

   ```bash
   curl -s localhost:1234/v1/models | jq -r '.data[].id'
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
    service: http://localhost:1234
  - service: http_status:404
```

```bash
cloudflared tunnel run gloria-llm          # 先手动跑一次试试
sudo cloudflared service install           # 之后开机自动启动
```

> 暂时没有域名：`cloudflared tunnel --url http://localhost:1234` 会给一个 `*.trycloudflare.com` 临时地址，可以先试通，但每次重启都会变，也没法加下一步的访问保护。只适合测试。

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

## 注意

- 想让本地多接访客，Mac 要保持唤醒：插电时 `caffeinate -s`，或用 Amphetamine。合盖就会切到云端。
- 每个访客 IP 每分钟最多 10 条（`wrangler.jsonc` 里的 `CHAT_LIMIT`）。
- 两个模型都只拿到 `/llms-full.txt` 作为资料，回答范围就是网站内容。改了网站内容重新 build 就会同步。
- 9B 模型偶尔会答偏或编细节，系统提示已经要求它只用网站内容，页面底部也有 "It can make mistakes" 的提示。
