# 数据库集合与权限

在 CloudBase 控制台手动创建以下集合。小程序前端不直接读写数据库，全部业务读写由 `menuService` 云函数完成。

## 集合

### `family_members`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | String | 自动生成 |
| `openid` | String | 微信 OpenID，必填 |
| `nickname` | String | 家庭内显示名 |
| `role` | String | `admin` 或 `member` |
| `enabled` | Boolean | 是否允许使用 |
| `createdAt` | Date | 创建时间 |

为 `openid` 创建唯一索引。

### `categories`

字段：`_id`、`name`、`sortOrder`、`enabled`。示例数据使用固定 `_id`，重复初始化会安全覆盖示例分类。

### `dishes`

字段：`_id`、`name`、`categoryId`、`description`、`imageFileId`、`defaultServings`、`cookingTime`、`ingredients`、`steps`、`enabled`、`createdAt`、`updatedAt`。

`ingredients` 每项包含 `name`、`quantity`、`unit`、`type`、`note`。`type` 为 `main` 或 `seasoning`。

### `orders`

字段：`_id`、`orderDate`、`creatorOpenid`、`creatorName`、`dinerCount`、`items`、`remark`、`status`、`ingredientSummary`、`idempotencyKey`、`createdAt`、`updatedAt`。

- `items` 保存菜名、图片、默认份数、实际份数、原料和步骤快照，菜品以后编辑也不会改变历史订单。
- `ingredientSummary` 是提交时计算的合并食材清单。
- 为 `creatorOpenid + idempotencyKey` 创建联合唯一索引，进一步防止网络重试造成重复订单。
- 建议为 `orderDate + createdAt`、`creatorOpenid + createdAt` 创建联合索引，以支持管理员今日订单和成员历史订单查询。

### `family_settings`

使用固定文档 ID `family` 保存家庭级设置。当前字段包括：

- `inviteCodeSalt`：邀请码随机盐值
- `inviteCodeHash`：邀请码经过 `scrypt` 计算后的校验值
- `inviteCodeUpdatedAt`：最近更新时间
- `inviteCodeUpdatedBy`：修改邀请码的管理员 OpenID

数据库不会保存邀请码明文。管理员生成邀请码后应立即复制；遗忘后只能生成新的。

## 安全规则

在五个集合的“权限设置 / 安全规则”中都使用：

```json
{
  "read": false,
  "write": false
}
```

云函数以服务端身份访问数据库，不受前端安全规则限制。不要把集合设为“所有用户可读”或“仅创建者可写”，因为项目的角色校验、订单快照和字段清洗都在云函数中完成。

云存储也建议设为前端不可写。菜品图片由管理员在编辑页选择后转为数据，经 `menuService.uploadDishImage` 校验管理员身份并上传。

## 第一位管理员

1. 部署云函数后打开小程序“我的”页，复制页面显示的 OpenID。
2. 在 `family_members` 新增文档：

```json
{
  "openid": "刚复制的 OpenID",
  "nickname": "小柴",
  "role": "admin",
  "enabled": true,
  "createdAt": "请选择控制台的日期类型并填当前时间"
}
```

3. 重新编译或下拉刷新。该用户会显示“管理员 · 做饭人”。
4. 管理员进入“我的 → 家庭邀请码”生成邀请码并发给家人。
5. 家人在首页输入邀请码后，云函数会读取其真实 OpenID，并以普通成员身份写入 `family_members`。邀请码永远不能授予管理员权限。
