const db = require('../config/db');

module.exports = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT quota, used_space FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'User không tồn tại' });

    const { quota, used_space } = rows[0];
    const fileSize = req.headers['content-length'] ? parseInt(req.headers['content-length']) : 0;

    if (used_space + fileSize > quota) {
      return res.status(413).json({
        message: 'Dung lượng lưu trữ đã đầy. Vui lòng xóa bớt file.',
        used: used_space,
        quota: quota
      });
    }
    next();
  } catch (err) {
    res.status(500).json({ message: 'Lỗi kiểm tra dung lượng' });
  }
};