# 小柴的菜单

家庭成员专用微信小程序：浏览菜品、组成今晚菜单、提交订单；管理员维护菜品和处理订单。

当前版本使用 **微信原生小程序 + Node.js HTTP 服务 + SQLite 本地数据库**，无需腾讯 CloudBase。服务可以放在家里的电脑上，后续通过 Cloudflare Tunnel 暴露 HTTPS 域名。本仓库没有替你创建 Tunnel，也不包含生产数据库、图片或微信密钥。

## 保留的功能

- 分类、搜索、菜品详情、主料/配料、步骤、图片、上架/下架。
- 菜名是唯一必填项：分类、图片、介绍、份数、时长、食材、配料、步骤均可留空；未分类菜不会被隐藏。
- 今晚菜单、份数调整、人数和口味备注；防重复下单、订单快照、按份数合并食材。
- 家庭邀请码加入；管理员生成/自定义/更换邀请码；普通成员只能查看自己的订单，管理员查看当天所有订单并更新状态。
- 微信身份由服务器向微信验证，不信任前端传来的 OpenID 或角色；停用账号不能用邀请码重新加入。
- 不会初始化三道示例菜，只自动创建三个默认分类。

“下单后微信推送”此前尚未实现，这次没有增加推送。仍需另行配置微信订阅消息模板及用户授权。

## 先在本机跑起来

安装 Node.js 24 LTS 或更新版本。服务使用 Node 自带 SQLite，没有需要 `npm install` 的运行依赖。

```bash
git clone https://github.com/YuxiangChai/Family-Menu.git
cd Family-Menu
cp server/.env.example server/.env
```

编辑 `server/.env`：

```dotenv
WX_APP_ID=你的小程序AppID
WX_APP_SECRET=你的小程序AppSecret
PUBLIC_BASE_URL=http://127.0.0.1:3000
HOST=127.0.0.1
PORT=3000
```

AppSecret 在微信公众平台的小程序开发设置中获取，**只放服务器的 `.env`，不要放到小程序或提交到 GitHub**。服务端 AppID 应和 `project.config.json` 中的小程序 AppID 相同。Git 已忽略 `.env` 和运行数据。

```bash
npm start
```

打开 `http://127.0.0.1:3000/health`，应返回 `ok: true`。这只能证明本地服务正常，不代表微信登录和公网访问已成功。未配置微信凭据时也能检查健康状态，但不能登录。

微信开发者工具导入仓库根目录。`miniprogram/config/env.js` 默认指向本机：

```js
module.exports = { apiBaseUrl: 'http://127.0.0.1:3000' }
```

仅开发者工具本机调试时启用“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”。**手机中的 `127.0.0.1` 是手机自己，不是这台电脑**；手机预览要等 HTTPS 域名可以访问后再测试。

## 第一位管理员和邀请码

没有任何公开“抢占管理员”接口。首次安装需要在服务器终端授权：

1. 启动服务，在小程序“我的”页复制自己的真实 OpenID（未加入家庭也能查看自己的 OpenID）。
2. 在仓库根目录执行：

```bash
npm run admin -- --openid "自己的真实OpenID" --nickname "小柴"
```

3. 回到“我的”刷新，进入“家庭邀请码”，生成邀请码并私下发给家人。
4. 家人在首页输入邀请码和称呼，获得普通成员权限。换邀请码不影响已加入的成员，旧邀请码不能再让新成员加入。

查看家庭成员：

```bash
npm run members
# 只有确实需要完整标识时才使用：
npm run members -- --show-openids
# 停用/恢复某位成员（角色不变）：
npm run member -- --openid "该成员OpenID" --enabled false
npm run member -- --openid "该成员OpenID" --enabled true
```

`family_members` 是“谁属于家庭、叫什么、有什么权限”；`family_settings` 是整个家庭共用的配置（邀请码校验值等），不是另一份成员名单。详见 [数据库说明](database/README.md)。不要把成员列表或备份提交到 GitHub。

## 以后接 Tunnel

假设域名为 `https://menu.example.com`：

1. Tunnel 指向运行服务的 `http://127.0.0.1:3000`，无需将路由器端口开放到公网。
2. `server/.env` 中 `PUBLIC_BASE_URL` 改为 `https://menu.example.com` 并重启服务。
3. `miniprogram/config/env.js` 中 `apiBaseUrl` 同样改为 `https://menu.example.com`，重新编译/上传小程序。
4. 微信公众平台按当前要求配置 HTTPS 合法域名，至少包括 `request`、图片所需的 `downloadFile`。上传使用 JSON 请求，不使用 `wx.uploadFile`。
5. 真机验证登录、邀请码、只填菜名保存、照片、下单和状态更新。

不要让 API 域名前置交互式 Cloudflare Access 登录页或浏览器验证码，否则小程序拿到的会是 HTML 而不是接口响应。服务本身校验微信身份和成员权限。备案不等于网络已通，仍要实测 HTTPS、Tunnel 和微信平台配置。

家里的电脑必须开机、联网、服务常驻；断电/断网期间不能下单。项目提供 [Linux systemd 示例](server/deploy/family-menu.service)，安装前需替换用户、目录和 Node 路径；不会自动安装系统服务。

## 家用电脑使用 Docker（可选）

安装 Docker 和 Compose，复制并配置 `server/.env` 后：

```bash
docker compose up -d --build
docker compose logs --tail=50 menu
docker compose exec menu node server/cli.js admin --openid "自己的真实OpenID" --nickname "小柴"
docker compose exec menu node server/cli.js members
```

Compose 只将端口绑定到宿主机 `127.0.0.1:3000`，适合宿主机运行 Tunnel；如果 Tunnel 也在容器里，需要另外配置容器网络。数据库和图片保存于命名卷 `menu-data`，重建容器不会清空。不要执行 `docker compose down -v`，那会删除数据卷。

更新代码：

```bash
git pull --ff-only
docker compose up -d --build
```

原生 Node 部署则 `git pull --ff-only` 后重启服务。两种方式的数据目录不同，换部署方式前先备份并迁移数据。

## 数据和备份

原生部署数据在 `server/data/`：`menu.sqlite` 保存成员、菜品、订单、邀请码和会话；`uploads/` 保存照片。它们是可写的运行数据，不是静态源码；GitHub 拉代码不会带走家庭数据。

```bash
npm run backup
# 或指定一个尚不存在的目录：
npm run backup -- --output /安全备份位置/新备份目录
```

命令使用 SQLite 在线备份，再复制图片，默认放在被 Git 忽略的 `server/backups/`。备份含敏感家庭数据，要保存到另一块硬盘/受控位置。仅复制正在运行的 `menu.sqlite` 可能漏掉 WAL 中的内容，应使用备份命令。

Docker 中备份到数据卷内一个新目录，再取出来：

```bash
docker compose exec menu node server/cli.js backup --output /app/server/data/backups/first-backup
mkdir -p server/backups
docker compose cp menu:/app/server/data/backups/first-backup ./server/backups/first-backup
```

每次更换备份名称。恢复时先停止服务并保留当前数据副本，再用备份中的 `menu.sqlite` 和 `uploads/` 替换完整的数据目录，之后重启。不要在旧数据库仍运行时替换文件。

原 CloudBase 里的真实数据不会自动出现在 SQLite 中。若有旧菜品/订单需要保留，应先导出并另行转换导入；停服前未导出的内容不能仅靠源码恢复。`sample-data.json` 只是旧示例，不是实际家庭数据。

## 开发与验证

```bash
npm test
```

测试覆盖真实本地 HTTP + SQLite 的业务、权限、图片签名、邀请码、幂等下单、备份，以及前端登录刷新和可选菜品字段。测试使用临时数据库和模拟微信换码结果，不会创建真实账号数据；没有 HTTP 模拟登录后门。

代码目录：`miniprogram/` 为现有小程序；`server/` 为新服务；`cloudfunctions/menuService/lib/` 为共用校验和业务规则。旧 CloudBase 云函数及 [旧部署记录](docs/cloudbase-legacy.md) 仅作历史参考，当前前端不再调用。微信登录/Tunnel 真机联调必须使用实际部署环境完成。

## 许可

[MIT License](LICENSE)。
