/**
 * 管理接口（api/admin.js）
 *
 * POST /api/admin?action=clear — 清空设备所有数据
 */
const { clearDeviceData } = require('../lib/kv');

const DEVICE_ID = process.env.ONENET_DEVICE_ID || '862323085449968';

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    const { action } = req.query;

    if (action === 'clear') {
      const result = await clearDeviceData(DEVICE_ID);
      return res.status(200).json({
        success: true,
        message: `已清空 ${result.cleared} 条位置数据`,
        cleared: result.cleared,
      });
    }

    return res.status(400).json({ success: false, message: '未知操作' });
  }

  return res.status(200).json({ success: true });
};
