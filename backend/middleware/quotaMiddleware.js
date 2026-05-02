const db = require('../config/db');

/**
 * Kiểm tra quota TRƯỚC khi multer parse file.
 *
 * Vấn đề cũ: dùng req.headers['content-length'] — đây là kích thước
 * toàn bộ multipart request (bao gồm boundary, header...), KHÔNG phải
 * kích thước file thực. Với file lớn, giá trị này lớn hơn thực tế
 * → báo hết quota oan.
 *
 * Fix: ước tính từ Content-Length nhưng trừ overhead multipart (~1KB),
 * và chỉ BLOCK rõ ràng khi vượt. Kiểm tra chính xác cuối cùng vẫn
 * nằm ở route sau khi multer đã parse xong (req.file.size).
 */
module.exports = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT quota, used_space FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'User không tồn tại' });

    const { quota, used_space } = rows[0];

    // Gắn vào req để route sau dùng lại, tránh query DB lần 2
    req.userQuota = { quota, used_space };

    // Ước tính sơ bộ từ Content-Length (trừ ~2KB overhead multipart)
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const MULTIPART_OVERHEAD = 2 * 1024; // 2KB
    const estimatedSize = Math.max(0, contentLength - MULTIPART_OVERHEAD);

    if (estimatedSize > 0 && used_space + estimatedSize > quota) {
      return res.status(413).json({
        message: 'Dung lượng lưu trữ đã đầy. Vui lòng xóa bớt file.',
        used: used_space,
        quota: quota
      });
    }

    next();
  } catch (err) {
    console.error('quotaMiddleware error:', err);
    res.status(500).json({ message: 'Lỗi kiểm tra dung lượng' });
  }
};
