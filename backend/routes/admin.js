const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const auth = require('../middleware/authMiddleware');
const db = require('../config/db');

// Middleware kiểm tra admin
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Không có quyền admin' });
  next();
};

// GET /api/admin/stats — thống kê tổng quan
router.get('/stats', auth, isAdmin, async (req, res) => {
  try {
    const [[userCount]] = await db.query('SELECT COUNT(*) as total FROM users');
    const [[activeCount]] = await db.query('SELECT COUNT(*) as total FROM users WHERE is_active = 1');
    const [[storageInfo]] = await db.query('SELECT SUM(used_space) as used, SUM(quota) as total FROM users');
    const [[todayActivity]] = await db.query(
      'SELECT COUNT(*) as total FROM files WHERE DATE(created_at) = CURDATE()'
    );

    res.json({
      total_users: userCount.total,
      active_users: activeCount.total,
      used_storage: storageInfo.used || 0,
      total_storage: storageInfo.total || 0,
      today_activity: todayActivity.total
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// GET /api/admin/users — danh sách tất cả user
router.get('/users', auth, isAdmin, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, username, email, role, quota, used_space, is_active, created_at, last_login FROM users ORDER BY created_at DESC'
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// POST /api/admin/users — tạo user mới
router.post('/users', auth, isAdmin, async (req, res) => {
  try {
    const { username, email, password, role, quota } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const quotaBytes = (quota || 5) * 1024 * 1024 * 1024; // GB to bytes

    await db.query(
      'INSERT INTO users (username, email, password, role, quota) VALUES (?,?,?,?,?)',
      [username, email, hash, role || 'user', quotaBytes]
    );
    res.json({ message: 'Tạo user thành công' });
  } catch (err) {
    res.status(400).json({ message: 'Username hoặc email đã tồn tại' });
  }
});

// PUT /api/admin/users/:id — cập nhật user (quota, role, trạng thái)
router.put('/users/:id', auth, isAdmin, async (req, res) => {
  try {
    const { quota, role, is_active } = req.body;
    const quotaBytes = quota ? quota * 1024 * 1024 * 1024 : null;

    if (quotaBytes !== null) {
      await db.query('UPDATE users SET quota = ? WHERE id = ?', [quotaBytes, req.params.id]);
    }
    if (role) {
      await db.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    }
    if (is_active !== undefined) {
      await db.query('UPDATE users SET is_active = ? WHERE id = ?', [is_active, req.params.id]);
    }
    res.json({ message: 'Cập nhật thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật' });
  }
});

// DELETE /api/admin/users/:id — xóa user
router.delete('/users/:id', auth, isAdmin, async (req, res) => {
  try {
    // Không cho xóa chính mình
    if (req.params.id == req.user.id) {
      return res.status(400).json({ message: 'Không thể xóa tài khoản đang đăng nhập' });
    }
    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'Xóa user thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa user' });
  }
});

// PUT /api/admin/users/:id/reset-password — reset mật khẩu
router.put('/users/:id/reset-password', auth, isAdmin, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự' });
    }
    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, req.params.id]);
    res.json({ message: 'Reset mật khẩu thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi reset mật khẩu' });
  }
});

// GET /api/admin/logs — nhật ký hoạt động chi tiết
router.get('/logs', auth, isAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const [logs] = await db.query(
      `SELECT f.id, f.original_name, f.file_size, f.mime_type,
              f.folder_path, f.created_at, u.username, u.email
       FROM files f JOIN users u ON f.user_id = u.id
       WHERE u.username LIKE ? OR f.original_name LIKE ?
       ORDER BY f.created_at DESC LIMIT ?`,
      [search, search, limit]
    );
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;