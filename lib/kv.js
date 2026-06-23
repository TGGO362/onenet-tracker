/**
 * Upstash Redis 存储封装
 *
 * 基于 @upstash/redis 实现定位数据的存储与查询：
 * - 每条定位数据以独立 key 存储，TTL=12h 自动过期
 * - 维护 lastloc 用于采集时去重
 * - 查询时按设备 + 时间范围扫描过滤
 *
 * Vercel 集成 Upstash Redis 后，环境变量自动注入：
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

const { Redis } = require('@upstash/redis');

// 从环境变量自动初始化（Vercel 集成 Upstash 后自动注入）
const redis = Redis.fromEnv();

// KV key 前缀
const KEY_PREFIX = 'location';
const LAST_LOC_KEY = 'lastloc';

// 数据 TTL（48 小时 = 172800 秒）
const DATA_TTL = 172800;
// lastloc TTL（30 天 = 2592000 秒，确保长期去重可用）
const LASTLOC_TTL = 2592000;

/**
 * 保存一条定位数据
 *
 * @param {string} deviceId - 设备 ID
 * @param {number} lng        - 经度 (GCJ02)
 * @param {number} lat        - 纬度 (GCJ02)
 * @param {string} ts         - ISO 8601 时间戳
 * @param {string} type       - 定位类型: 'gps' | 'base_station'
 */
async function saveLocation(deviceId, lng, lat, ts, type) {
  const tsMs = new Date(ts).getTime();
  const key = `${KEY_PREFIX}:${deviceId}:${tsMs}`;

  const value = { lng, lat, ts, type };

  await redis.set(key, JSON.stringify(value), { ex: DATA_TTL });
  console.log(`[KV] 已存储: key=${key} type=${type} lng=${lng} lat=${lat}`);
}

/**
 * 查询指定时间范围内的所有定位数据
 *
 * @param {string} deviceId - 设备 ID
 * @param {number} minTs     - 起始时间戳（Unix ms，含）
 * @param {number} maxTs     - 截止时间戳（Unix ms，含）
 * @returns {Array<{lng: number, lat: number, ts: string}>} 按时间升序排列
 */
async function getLocations(deviceId, minTs, maxTs) {
  const pattern = `${KEY_PREFIX}:${deviceId}:*`;
  console.log(`[KV] 扫描 key 模式: ${pattern}`);

  const keys = await redis.keys(pattern);
  console.log(`[KV] 匹配到 ${keys.length} 条 key`);

  if (keys.length === 0) return [];

  // 批量获取值
  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.get(key);
  }
  const results = await pipeline.exec();

  // 解析、过滤、排序
  const points = [];
  for (let i = 0; i < keys.length; i++) {
    if (!results[i]) continue;
    try {
      const point = typeof results[i] === 'string' ? JSON.parse(results[i]) : results[i];
      const tsMs = new Date(point.ts).getTime();

      if (tsMs >= minTs && tsMs <= maxTs) {
        points.push(point);
      }
    } catch (e) {
      console.warn(`[KV] 解析数据失败: key=${keys[i]}`, e.message);
    }
  }

  // 按时间升序
  points.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  console.log(`[KV] 过滤后返回 ${points.length} 个点位`);
  return points;
}

/**
 * 获取设备最后一条有效定位（用于去重）
 *
 * @param {string} deviceId
 * @returns {{ lng: number, lat: number, ts: string } | null}
 */
async function getLastLocation(deviceId) {
  const key = `${LAST_LOC_KEY}:${deviceId}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/**
 * 更新设备最后有效定位
 */
async function updateLastLocation(deviceId, lng, lat, ts, type) {
  const key = `${LAST_LOC_KEY}:${deviceId}`;
  await redis.set(key, JSON.stringify({ lng, lat, ts, type }), { ex: LASTLOC_TTL });
}

/**
 * 检查定位点与上次是否重复（静止去重）
 * 同类型 + 同坐标 才判为重复，GPS/基站 切换时即使同坐标也保留
 *
 * @param {string} deviceId
 * @param {number} lng
 * @param {number} lat
 * @param {string} type - 'gps' | 'base_station'
 * @returns {boolean} true=重复/静止，应跳过
 */
async function isDuplicate(deviceId, lng, lat, type) {
  const last = await getLastLocation(deviceId);
  if (!last) return false;

  // 类型变了（GPS ↔ 基站切换），即使同坐标也不算重复
  if (last.type && last.type !== type) {
    console.log(`[KV] 定位类型切换 (${last.type}→${type})，允许记录`);
    return false;
  }

  // 同类型 + 同坐标（6 位精度 ≈ 0.1m）才判重复
  const same = last.lng.toFixed(6) === lng.toFixed(6)
            && last.lat.toFixed(6) === lat.toFixed(6);

  if (same) {
    console.log(`[KV] 位置重复，跳过存储: type=${type} lng=${lng} lat=${lat}`);
  }
  return same;
}

/**
 * 获取设备最后活跃时间（用于离线判断）
 */
async function getLastActiveTime(deviceId) {
  const last = await getLastLocation(deviceId);
  return last ? last.ts : null;
}

/**
 * 清空设备所有定位数据（用于清理旧数据）
 */
async function clearDeviceData(deviceId) {
  const pattern = `${KEY_PREFIX}:${deviceId}:*`;
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  // 同时清除 lastloc
  const lastKey = `${LAST_LOC_KEY}:${deviceId}`;
  await redis.del(lastKey);
  console.log(`[KV] 已清空 ${keys.length + 1} 条数据 (deviceId=${deviceId})`);
  return { cleared: keys.length };
}

/**
 * 保存调试日志 — 记录最近一次 OneNET 推送原始数据
 */
const DEBUG_KEY = 'debug:lastpush';
async function saveDebugLog(rawBody) {
  await redis.set(DEBUG_KEY, JSON.stringify(rawBody), { ex: 3600 });
}

/**
 * 读取调试日志
 */
async function getDebugLog() {
  const raw = await redis.get(DEBUG_KEY);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return raw; }
}

/**
 * 保存最新遥测数据
 */
const TELEMETRY_KEY_PREFIX = 'telemetry';
async function saveTelemetry(deviceId, telemetry) {
  const key = `${TELEMETRY_KEY_PREFIX}:${deviceId}`;
  await redis.set(key, JSON.stringify(telemetry), { ex: LASTLOC_TTL });
  console.log(`[KV] 遥测已更新: ${JSON.stringify(telemetry)}`);
}

/**
 * 读取最新遥测数据
 */
async function getTelemetry(deviceId) {
  const key = `${TELEMETRY_KEY_PREFIX}:${deviceId}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

module.exports = {
  saveLocation,
  getLocations,
  getLastLocation,
  updateLastLocation,
  isDuplicate,
  getLastActiveTime,
  clearDeviceData,
  saveDebugLog,
  getDebugLog,
  saveTelemetry,
  getTelemetry,
};
