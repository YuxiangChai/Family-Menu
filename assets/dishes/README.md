# 菜品测试图片

`tomato-eggs-test.png` 是使用内置 imagegen 生成的番茄炒蛋测试图，不是真实菜品照片。
已通过当前本机后端的图片存储机制关联到现有的“番茄炒蛋”，没有新增菜品或修改历史订单。
此目录保留原图；数据库和运行时上传目录仍被 Git 忽略，克隆仓库不会自动导入此图片或家庭数据。
需要在其他部署中使用时，可在管理员的菜品编辑页上传此图。

## 生成提示词

```text
Use case: photorealistic-natural
Asset type: square dish photo for a Chinese family menu mini program
Primary request: 一盘真实家常番茄炒蛋，鲜红番茄块和蓬松金黄炒鸡蛋，少量葱花，刚出锅的自然汁水。
Scene/backdrop: 素白陶瓷浅盘，温暖干净的家用餐桌背景。
Composition/framing: 近景，略俯视约45度，食物居中，整盘在画面内，四周留少量空间，方便正方形缩略图裁切。
Lighting/mood: 柔和自然窗光，温馨家常，真实食物摄影。
Constraints: Only this dish, no text, no logos, no watermark, no people, no cutlery obscuring food, no exaggerated restaurant styling.
```
