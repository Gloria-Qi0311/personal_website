# /admin 后台登录设置

/admin 用 GitHub 账号登录。登录由网站自己的 Worker 处理（`worker/cms-auth.js`），不依赖任何外部服务。第一次需要做两步，以后不用再管。

## 1. 在 GitHub 建一个 OAuth App

打开 <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**，填：

| 栏目 | 填什么 |
|---|---|
| Application name | `Gloria Qi site admin`（随意） |
| Homepage URL | `https://gloriaqi.site` |
| Authorization callback URL | `https://gloriaqi.site/api/callback` |

点 **Register application**，然后点 **Generate a new client secret**。记下 **Client ID** 和 **Client secret**（secret 只显示一次）。

## 2. 把两个值填进 Cloudflare

Cloudflare 后台 → Workers & Pages → **gloria-qi** → Settings → Variables and Secrets → **Add**，类型选 **Secret**：

| 名字 | 值 |
|---|---|
| `CMS_GITHUB_CLIENT_ID` | 上一步的 Client ID |
| `CMS_GITHUB_CLIENT_SECRET` | 上一步的 Client secret |

保存后打开 <https://gloriaqi.site/admin/>，点 **Login with GitHub** 即可。只有对仓库有写权限的人（就是你）能保存修改。

## 说明

- 只能在 gloriaqi.site 上登录；`gloria-qi.glqi63583.workers.dev` 和预览网址都不行（GitHub 只认上面填的回调地址）。以后换域名，要把 OAuth App 的两个网址和 `admin/config.yml` 里的 `base_url` 一起改掉。
- 登录只申请公开仓库的权限（`public_repo`），碰不到你的私有仓库。
