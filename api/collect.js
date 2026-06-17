/**
 * 数据接收接口（api/collect.js）
 *
 * 接收 OneNET Studio HTTP 数据推送：
 * - GET 请求：URL 验证（返回 msg 参数值完成验证）
 * - POST 请求：接收设备数据推送，解析定位数据写入 Redis
 *
 * OneNET 推送协议文档：
 * https://open.iot.10086.cn/doc/iot_platform/book/application-develop/push/http_push.html
 */

const { parseLocation } = require('../lib/onenet');
const { wgs84ToGcj02 } = require('../lib/coord');
const {
  saveLocation,
  updateLastLocation,
  saveDebugLog,
} = require('../lib/kv');

const DEVICE_ID = process.env.ONENET_DEVICE_ID || '862323085449968';

/**
 * Vercel Serverless Function 入口
 */
module.exports = async function handler(req, res) {
  const startTime = Date.now();

  // ========== GET：OneNET URL 验证 ==========
  // OneNET 验证时会 GET 带 ?msg=xxx&nonce=xxx&signature=xxx
  // 按官方文档：直接原样返回 msg 参数值即可通过验证
  if (req.method === 'GET') {
    const msg = req.query.msg || 'ok';
    console.log(`[Collect] GET 验证 - 返回 msg: ${msg}`);
    return res.status(200).send(msg);
  }

  // ========== POST：接收设备数据推送 ==========
  if (req.method !== 'POST') {
    return res.status(200).json({ success: true });
  }

  console.log('='.repeat(50));
  console.log(`[Collect] POST 推送 — ${new Date().toISOString()}`);

  try {
    // 1. 解析请求体
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      console.log('[Collect] 请求体非 JSON');
      return res.status(200).json({ success: true, message: 'invalid json' });
    }

    console.log(`[Collect] 外层包: msg=${typeof body.msg} nonce=${body.nonce} time=${body.time}`);

    // 🔍 保存原始推送数据用于调试
    await saveDebugLog(body);

    // 2. 提取 msg 字段（OneNET 将实际数据包在 msg 里）
    let data;
    const msgRaw = body.msg || '';
    try {
      // msg 可能是 JSON 字符串或已解析的对象
      data = typeof msgRaw === 'string' ? JSON.parse(msgRaw) : msgRaw;
    } catch {
      // 如果不是 JSON，尝试直接从 body 中找定位数据
      console.log('[Collect] msg 非 JSON，尝试直接解析 body');
      data = body;
    }

    console.log(`[Collect] 数据内容: ${JSON.stringify(data).substring(0, 300)}`);

    // 3. 提取定位信息
    const location = parseLocation(data);

    // 3.5 WGS84 → GCJ02 坐标转换（高德地图使用火星坐标系）
    if (location) {
      const gcj02 = wgs84ToGcj02(location.lng, location.lat);
      console.log(`[Collect] 坐标转换: WGS84(${location.lng}, ${location.lat}) → GCJ02(${gcj02.lng}, ${gcj02.lat})`);
      location.lng = gcj02.lng;
      location.lat = gcj02.lat;
    }

    if (!location) {
      const elapsed = Date.now() - startTime;
      console.log(`[Collect] 无定位数据 - ${elapsed}ms`);
      return res.status(200).json({
        success: true,
        message: '无定位数据',
        stored: false,
      });
    }

    // 4. 写入 Redis（始终写入，不去重）
    await saveLocation(DEVICE_ID, location.lng, location.lat, location.ts, location.type);
    await updateLastLocation(DEVICE_ID, location.lng, location.lat, location.ts, location.type);

    const elapsed = Date.now() - startTime;
    console.log(`[Collect] 存储成功 - ${elapsed}ms`);
    console.log('='.repeat(50));

    return res.status(200).json({
      success: true,
      message: '已存储',
      stored: true,
      location,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Collect] 失败 - ${elapsed}ms`, error.message);

    // 即使失败也返回 200，避免 OneNET 重推
    return res.status(200).json({
      success: false,
      error: error.message,
    });
  }
};
