/**
 * 调试接口 — 查看最近一次 OneNET 推送原始数据
 */
const { getDebugLog } = require('../lib/kv');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const debug = await getDebugLog();
  return res.status(200).json({
    success: true,
    hasData: !!debug,
    debug,
  });
};
