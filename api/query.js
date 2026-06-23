/**
 * 轨迹查询接口（api/query.js）
 *
 * 功能：
 * 1. 接收前端时段参数 hours（1/3/6/9/12）
 * 2. 从 Upstash Redis 筛选对应时段内的所有定位点
 * 3. 按时间升序返回，附 CORS 头供前端调用
 *
 * 请求格式：GET /api/query?hours=3
 * 响应格式：{ success: true, data: [...], count: N, timeRange: {...} }
 */

const { getLocations, getLastActiveTime, getTelemetry } = require('../lib/kv');

// 允许的时段选项
const ALLOWED_HOURS = [1, 3, 6, 9, 12];

// 设备 ID
const DEVICE_ID = process.env.ONENET_DEVICE_ID;

/**
 * Vercel Serverless Function 入口
 */
module.exports = async function handler(req, res) {
  // CORS 头 — 允许前端跨域请求
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 预检请求
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const startTime = Date.now();
  console.log(`[Query] 查询请求 — ${new Date().toISOString()}`);

  try {
    // 1. 解析参数
    const { hours } = req.query;
    const hoursNum = parseInt(hours, 10);

    if (!ALLOWED_HOURS.includes(hoursNum)) {
      return res.status(400).json({
        success: false,
        error: `无效的时段参数。允许值：${ALLOWED_HOURS.join('/')} 小时`,
      });
    }

    if (!DEVICE_ID) {
      throw new Error('缺少 ONENET_DEVICE_ID 环境变量');
    }

    // 2. 计算时间范围
    const now = Date.now();
    const minTs = now - hoursNum * 60 * 60 * 1000;
    const maxTs = now;

    console.log(`[Query] 查询时段: ${hoursNum}h (${new Date(minTs).toISOString()} ~ ${new Date(maxTs).toISOString()})`);

    // 3. 从 KV 查询数据
    const data = await getLocations(DEVICE_ID, minTs, maxTs);

    // 4. 获取最后活跃时间 & 遥测数据
    const lastActive = await getLastActiveTime(DEVICE_ID);
    const telemetry = await getTelemetry(DEVICE_ID);

    const elapsed = Date.now() - startTime;
    console.log(`[Query] 返回 ${data.length} 个点位 - 耗时 ${elapsed}ms`);

    // 5. 返回结果
    return res.status(200).json({
      success: true,
      data,
      count: data.length,
      timeRange: {
        start: new Date(minTs).toISOString(),
        end: new Date(maxTs).toISOString(),
      },
      lastActive: lastActive || null,
      offline: !lastActive || (Date.now() - new Date(lastActive).getTime() > 30 * 60 * 1000),
      telemetry: telemetry || null,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Query] 失败 - 耗时 ${elapsed}ms`, error.message);
    console.error(error.stack);

    return res.status(500).json({
      success: false,
      error: '查询失败，请稍后重试',
    });
  }
};
