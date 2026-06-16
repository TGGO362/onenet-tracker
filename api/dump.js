/**
 * 数据库全量查询接口（api/dump.js）
 *
 * 返回 Redis 中所有定位数据，支持可选时间范围过滤：
 *   GET /api/dump
 *   GET /api/dump?start=2024-01-01T00:00:00Z&end=2024-01-02T00:00:00Z
 *
 * 响应格式：{ success: true, data: [...], count: N }
 */

const { getLocations } = require('../lib/kv');

const DEVICE_ID = process.env.ONENET_DEVICE_ID;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  console.log(`[Dump] 查询请求 — ${new Date().toISOString()}`);

  try {
    if (!DEVICE_ID) throw new Error('缺少 ONENET_DEVICE_ID 环境变量');

    const now = Date.now();
    let minTs, maxTs;

    // 解析可选的时间范围参数（ISO 字符串）
    if (req.query.start) {
      minTs = new Date(req.query.start).getTime();
      if (isNaN(minTs)) return res.status(400).json({ success: false, error: 'start 参数格式无效' });
    } else {
      minTs = now - 48 * 60 * 60 * 1000; // 默认 48h（覆盖 Redis TTL 全部数据）
    }

    if (req.query.end) {
      maxTs = new Date(req.query.end).getTime();
      if (isNaN(maxTs)) return res.status(400).json({ success: false, error: 'end 参数格式无效' });
    } else {
      maxTs = now;
    }

    console.log(`[Dump] 时间范围: ${new Date(minTs).toISOString()} ~ ${new Date(maxTs).toISOString()}`);

    const data = await getLocations(DEVICE_ID, minTs, maxTs);

    console.log(`[Dump] 返回 ${data.length} 条`);

    return res.status(200).json({
      success: true,
      data,
      count: data.length,
      timeRange: {
        start: new Date(minTs).toISOString(),
        end: new Date(maxTs).toISOString(),
      },
    });
  } catch (error) {
    console.error('[Dump] 失败', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
