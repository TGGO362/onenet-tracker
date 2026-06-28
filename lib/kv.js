/**
 * Upstash Redis 存储封装
 *
 * 基于 @upstash/redis 实现定位数据的存储与查询：
 * - 每条定位数据以独立 key 存储，TTL=48h 自动过期
 * - 维护 lastloc 用于离线判断
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
// lastloc TTL（30 天 = 2592000 秒，确保长期可用）
const LASTLOC_TTL = 2592000;

/**
 * 保存一条定位数据
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
 * 获取设备最后一条有效定位
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
 */
async function isDuplicate(deviceId, lng, lat, type) {
  const last = await getLastLocation(deviceId);
  if (!last) return false;

  if (last.type && last.type !== type) {
    console.log(`[KV] 定位类型切换 (${last.type}→${type})，允许记录`);
    return false;
  }

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
 * 清空设备所有定位数据
 */
async function clearDeviceData(deviceId) {
  const pattern = `${KEY_PREFIX}:${deviceId}:*`;
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  const lastKey = `${LAST_LOC_KEY}:${deviceId}`;
  await redis.del(lastKey);
  console.log(`[KV] 已清空 ${keys.length + 1} 条数据 (deviceId=${deviceId})`);
  return { cleared: keys.length };
}

/**
 * 调试日志：保存最近 N 条 OneNET 推送
 */
const DEBUG_KEY = 'debug:lastpush';
const DEBUG_LIST_KEY = 'debug:pushes';
const DEBUG_MAX = 20;

async function saveDebugLog(rawBody) {
  // 最近一条
  await redis.set(DEBUG_KEY, JSON.stringify(rawBody), { ex: 3600 });
  // 最近 N 条列表
  try {
    const entry = { ts: new Date().toISOString(), body: rawBody };
    let list = [];
    const existing = await redis.get(DEBUG_LIST_KEY);
    if (existing) {
      list = typeof existing === 'string' ? JSON.parse(existing) : existing;
      if (!Array.isArray(list)) list = [];
    }
    list.push(entry);
    if (list.length > DEBUG_MAX) list = list.slice(-DEBUG_MAX);
    await redis.set(DEBUG_LIST_KEY, JSON.stringify(list), { ex: 3600 });
  } catch (e) {
    console.warn('[KV] 保存调试列表失败:', e.message);
  }
}

async function getDebugLog() {
  const raw = await redis.get(DEBUG_KEY);
  const listRaw = await redis.get(DEBUG_LIST_KEY);
  let list = [];
  if (listRaw) {
    try { list = typeof listRaw === 'string' ? JSON.parse(listRaw) : listRaw; } catch { list = []; }
    if (!Array.isArray(list)) list = [];
  }
  const last = raw ? (() => {
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return raw; }
  })() : null;
  return { last, recent: list };
}

/**
 * 遥测数据存储
 */
const TELEMETRY_KEY_PREFIX = 'telemetry';
async function saveTelemetry(deviceId, telemetry) {
  const key = `${TELEMETRY_KEY_PREFIX}:${deviceId}`;
  await redis.set(key, JSON.stringify(telemetry), { ex: LASTLOC_TTL });
  console.log(`[KV] 遥测已更新: ${JSON.stringify(telemetry)}`);
}

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
