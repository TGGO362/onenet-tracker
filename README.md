# OneNet + Vercel + 高德地图 12 小时轨迹系统

将 OneNet 物联网设备的位置数据实时展示在高德地图上，支持 1~12 小时时段轨迹回溯。

## 架构

```
IoT 设备 → OneNet 平台 → HTTP 推送 → Vercel Serverless → Upstash Redis (12h TTL) → 高德地图网页
```

设备上报数据后，OneNet 自动推送到 Vercel，无需定时轮询。

## 目录结构

```
├── package.json
├── vercel.json          # Vercel 部署配置
├── .env.example         # 环境变量模板
├── lib/
│   ├── onenet.js        # OneNET 推送数据解析
│   └── kv.js            # Upstash Redis 封装
├── api/
│   ├── collect.js       # 数据接收接口（OneNET 推送目标）
│   └── query.js         # 轨迹查询接口（前端调用）
├── public/
│   └── index.html       # 前端页面
└── README.md
```

## 部署步骤

### 1. 准备工作

#### OneNet 控制台

设备已在 OneNET Studio 上线（产品 ID 和设备名称见 OneNET 控制台）。

#### 高德地图控制台

Key 和安全密钥已配置在项目环境变量与页面中。

#### Vercel 账号

1. 注册/登录 [Vercel](https://vercel.com)
2. 安装 CLI：`npm i -g vercel`

### 2. 部署到 Vercel

```bash
cd D:/clacude_code_test
npm install
vercel          # 首次部署（按提示登录、创建项目）
vercel --prod   # 部署到生产环境
```

部署后会得到一个域名，如 `https://xxxx.vercel.app`。

### 3. 集成 Upstash Redis

1. [Vercel 控制台](https://vercel.com) → 你的项目 → **Storage**
2. **Create Database** → 选择 **Upstash Redis**
3. 创建后自动注入环境变量（免费额度：每日 10,000 次请求，绰绰有余）

### 4. 配置环境变量

在 Vercel 控制台（或 CLI）设置：

| 变量名 | 值 |
|--------|-----|
| `ONENET_PRODUCT_ID` | `0HaP28xIqy` |
| `ONENET_DEVICE_ID` | `862323085449968` |
| `AMAP_KEY` | `your_amap_key` |
| `AMAP_SECRET` | `your_amap_secret` |

```bash
vercel env add ONENET_PRODUCT_ID
# 输入你的 OneNET 产品 ID

vercel env add ONENET_DEVICE_ID
# 输入你的设备名称

vercel env add AMAP_KEY
# 输入你的高德 Key

vercel env add AMAP_SECRET
# 输入你的高德安全密钥
```

全部选 **Production**。配完后重新部署：

```bash
vercel --prod
```

### 5. 配置 OneNET 数据推送

1. 登录 [OneNET Studio](https://open.iot.10086.cn/)
2. 左侧菜单 → **数据流转** → **数据推送**
3. 点击 **新增推送**，填写：

| 字段 | 值 |
|------|-----|
| 推送地址 | `https://你的域名.vercel.app/api/collect` |
| 数据格式 | JSON |
| 触发事件 | 设备数据上报 |

4. 保存

之后设备每次上报位置，OneNET 自动 POST 数据到 Vercel，实时入库。

### 6. 验证

1. **触发推送**：让设备上报一次数据，或手动 POST 测试数据到 `/api/collect`
2. **查看数据**：浏览器访问 `https://你的域名.vercel.app/api/query?hours=1`
3. **地图查看**：访问 `https://你的域名.vercel.app`

## 数据格式

设备上报的定位数据支持两种格式：
- GPS 定位：`GPS_117.3834024_031.9418958`
- 基站定位：`基站_117.3834024_031.9418958`

系统自动递归解析 OneNET 推送 JSON 中的所有字段，匹配即提取。

## 自动清理

Redis 数据设置 12 小时 TTL，过期自动删除，无需手动维护。12 小时内数据总量 < 40 条，完全在免费额度内。

## 本地调试

```bash
npm i -g vercel
vercel dev

# 模拟 OneNET 推送（另开终端）
curl -X POST http://localhost:3000/api/collect \
  -H "Content-Type: application/json" \
  -d '{"product_id":"你的产品ID","device_name":"你的设备名","data":[{"id":"loc","value":"GPS_117.3834024_31.9418958","time":1718200000000}]}'
```

## 限制说明

| 项目 | 免费额度 | 本项目用量 |
|------|---------|-----------|
| Upstash Redis | 每日 10,000 次请求 | < 100 次/天 |
| Vercel 函数 | 100 GB-hours / 月 | 极低 |
| OneNET 数据推送 | 免费 | 约 48 条/天 |

## License

MIT
