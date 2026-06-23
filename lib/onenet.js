/**
 * OneNET 数据解析工具
 *
 * 解析 OneNET 推送的设备定位数据：
 * - GPS 格式：GPS_经度_纬度（如 GPS_117.3834024_31.9418958）
 * - 基站格式：基站_经度_纬度（如 基站_117.3834024_031.9418958）
 */

// 定位数据正则：匹配 GPS_经度_纬度 或 基站_经度_纬度
// 第一个捕获组是类型（GPS/基站），第二、第三是经纬度
const LOCATION_PATTERN = /^(GPS|基站)_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/;

/**
 * 从 OneNET 推送数据体中提取定位信息
 *
 * OneNET 推送 JSON 格式（常见两种）：
 *
 * 格式 1 — 设备数据上行:
 * {
 *   "product_id": "0HaP28xIqy",
 *   "device_name": "862323085449968",
 *   "data": [{ "id": "loc", "value": "GPS_117.38_31.94", "time": 1718200000000 }]
 * }
 *
 * 格式 2 — 物模型上报:
 * {
 *   "params": { "location": { "value": "GPS_117.38_31.94", "time": 1718200000000 } }
 * }
 *
 * @param {object} body  - POST 请求体（已 JSON.parse）
 * @returns {{ type: string, lng: number, lat: number, ts: string } | null}
 */
function parseLocation(body) {
  if (!body || typeof body !== 'object') return null;

  // 递归在所有字段值中查找 GPS_/基站_ 格式字符串
  const found = findLocationValue(body);
  if (!found) return null;

  const match = found.value.match(LOCATION_PATTERN);
  if (!match) return null;

  const type = match[1] === 'GPS' ? 'gps' : 'base_station';
  const lng = parseFloat(match[2]);
  const lat = parseFloat(match[3]);

  // 坐标合法性检查
  if (isNaN(lng) || isNaN(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  if (lng === 0 && lat === 0) return null;

  // 时间戳：Unix 毫秒 / 秒 / ISO 字符串 均兼容
  let ts;
  if (found.time) {
    const timeVal = Number(found.time);
    if (timeVal > 1000000000000) {
      ts = new Date(timeVal).toISOString();
    } else if (timeVal > 1000000000) {
      ts = new Date(timeVal * 1000).toISOString();
    } else {
      ts = new Date(found.time).toISOString();
    }
  } else {
    ts = new Date().toISOString();
  }

  console.log(`[Parse] 定位: type=${type} lng=${lng} lat=${lat} ts=${ts}`);
  return { type, lng, lat, ts };
}

/**
 * 递归遍历对象，查找包含 GPS_/基站_ 格式值的字段
 */
function findLocationValue(obj, depth = 0) {
  if (!obj || depth > 10) return null;

  // 直接匹配字符串值
  if (typeof obj === 'string') {
    if (LOCATION_PATTERN.test(obj.trim())) {
      return { value: obj.trim(), time: null };
    }
    return null;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findLocationValue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof obj === 'object') {
    // 检查 value + time 模式 (OneNET 数据点)
    if (obj.value && typeof obj.value === 'string' && LOCATION_PATTERN.test(obj.value.trim())) {
      return { value: obj.value.trim(), time: obj.time || obj.at || null };
    }

    // 递归子对象
    for (const key of Object.keys(obj)) {
      const found = findLocationValue(obj[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

// 遥测字段名映射（设备上报 → 标准名）
const TELEMETRY_KEYS = [
  'vbatt', 'battPercent', 'csq', 'rsrp', 'rsrq',
  'gpsSatNum', 'isFix', 'speed', 'charging', 'vin', 'in1',
];

/**
 * 从 OneNET 推送数据中提取遥测信息
 * 递归查找 params 下的数值型字段
 */
function parseTelemetry(body) {
  if (!body || typeof body !== 'object') return null;

  const result = {};
  const found = new Set();

  function scan(obj, depth) {
    if (!obj || depth > 10) return;
    if (Array.isArray(obj)) {
      for (const item of obj) scan(item, depth + 1);
      return;
    }
    if (typeof obj !== 'object') return;

    // 直接检查顶层对象中是否有遥测字段
    for (const key of Object.keys(obj)) {
      if (TELEMETRY_KEYS.includes(key) && !found.has(key)) {
        const val = obj[key];
        // OneNET 物模型: { value: 123, time: ... }
        const numVal = (val && typeof val === 'object' && 'value' in val)
          ? Number(val.value)
          : Number(val);
        if (!isNaN(numVal)) {
          result[key] = numVal;
          found.add(key);
        }
      }
    }
    // 递归子对象
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        scan(obj[key], depth + 1);
      }
    }
  }

  scan(body, 0);

  // 至少找到一个遥测字段才返回
  if (found.size === 0) return null;

  result.ts = new Date().toISOString();
  console.log(`[Parse] 遥测: ${JSON.stringify(result)}`);
  return result;
}

module.exports = { parseLocation, parseTelemetry };
