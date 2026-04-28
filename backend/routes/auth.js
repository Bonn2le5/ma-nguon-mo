const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const auth = require('../middleware/authMiddleware');
require('dotenv').config();

// Đăng ký
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hash]
    );
    res.json({ message: 'Đăng ký thành công' });
  } catch (err) {
    res.status(400).json({ message: 'Username hoặc email đã tồn tại' });
  }
});

// Đăng nhập
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE username = ?', [username]
    );
    if (!rows.length) return res.status(400).json({ message: 'Sai tài khoản' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Sai mật khẩu' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, role: user.role, username: user.username });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// GET /api/auth/profile — lấy thông tin người dùng hiện tại
router.get('/profile', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, email, role, quota, used_space, created_at, last_login FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Người dùng không tồn tại' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// PUT /api/auth/profile — cập nhật thông tin (username, email, đổi mật khẩu)
router.put('/profile', auth, async (req, res) => {
  const { username, email, current_password, new_password } = req.body;

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Người dùng không tồn tại' });

    const user = rows[0];

    // Nếu muốn đổi mật khẩu → bắt buộc xác nhận mật khẩu hiện tại
    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ message: 'Cần nhập mật khẩu hiện tại để đổi mật khẩu' });
      }
      const match = await bcrypt.compare(current_password, user.password);
      if (!match) {
        return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
      }
      if (new_password.length < 6) {
        return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
      }
    }

    // Kiểm tra username/email trùng với người khác
    if (username && username !== user.username) {
      const [dup] = await db.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.user.id]);
      if (dup.length) return res.status(400).json({ message: 'Username đã được sử dụng' });
    }
    if (email && email !== user.email) {
      const [dup] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.user.id]);
      if (dup.length) return res.status(400).json({ message: 'Email đã được sử dụng' });
    }

    // Build update query
    const updates = [];
    const values = [];

    if (username && username.trim()) { updates.push('username = ?'); values.push(username.trim()); }
    if (email && email.trim())       { updates.push('email = ?');    values.push(email.trim()); }
    if (new_password) {
      const hash = await bcrypt.hash(new_password, 10);
      updates.push('password = ?');
      values.push(hash);
    }

    if (!updates.length) return res.status(400).json({ message: 'Không có thông tin nào để cập nhật' });

    values.push(req.user.id);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    // Lấy lại thông tin mới để trả về
    const [updated] = await db.query(
      'SELECT id, username, email, role, quota, used_space, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    // Cấp lại token nếu username thay đổi
    let newToken = null;
    if (username && username !== user.username) {
      newToken = jwt.sign(
        { id: updated[0].id, username: updated[0].username, role: updated[0].role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
    }

    res.json({
      message: 'Cập nhật thành công',
      user: updated[0],
      ...(newToken && { token: newToken })
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;