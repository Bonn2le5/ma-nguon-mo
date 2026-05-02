const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const db       = require('../config/db');
const mailer   = require('../config/mailer');
const auth     = require('../middleware/authMiddleware');
require('dotenv').config();

// ─── Helper: sinh token ngẫu nhiên ──────────────────────────
function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Helper: gửi mail xác nhận đăng ký ─────────────────────
async function sendVerifyMail(email, username, token) {
  const link = `${process.env.APP_URL}/verify-email.html?token=${token}`;
  await mailer.sendMail({
    from: `"CloudStore" <${process.env.MAIL_USER}>`,
    to: email,
    subject: '✅ Xác nhận tài khoản CloudStore',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <div style="background:#2563eb;padding:28px 32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">☁️ CloudStore</h1>
        </div>
        <div style="padding:32px">
          <h2 style="color:#111827;margin-top:0">Xin chào, ${username}!</h2>
          <p style="color:#374151;line-height:1.6">
            Cảm ơn bạn đã đăng ký tài khoản. Nhấn nút bên dưới để xác nhận địa chỉ email và kích hoạt tài khoản.
          </p>
          <div style="text-align:center;margin:32px 0">
            <a href="${link}"
               style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
              Xác nhận Email
            </a>
          </div>
          <p style="color:#6b7280;font-size:13px">
            Link có hiệu lực trong <strong>24 giờ</strong>. Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email này.
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="color:#9ca3af;font-size:12px;margin:0">
            Hoặc copy link: <a href="${link}" style="color:#2563eb">${link}</a>
          </p>
        </div>
      </div>
    `
  });
}

// ─── Helper: gửi mail reset mật khẩu ────────────────────────
async function sendResetMail(email, username, token) {
  const link = `${process.env.APP_URL}/reset-password.html?token=${token}`;
  await mailer.sendMail({
    from: `"CloudStore" <${process.env.MAIL_USER}>`,
    to: email,
    subject: '🔐 Đặt lại mật khẩu CloudStore',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <div style="background:#2563eb;padding:28px 32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">☁️ CloudStore</h1>
        </div>
        <div style="padding:32px">
          <h2 style="color:#111827;margin-top:0">Xin chào, ${username}!</h2>
          <p style="color:#374151;line-height:1.6">
            Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Nhấn nút bên dưới để tiếp tục.
          </p>
          <div style="text-align:center;margin:32px 0">
            <a href="${link}"
               style="background:#dc2626;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
              Đặt lại mật khẩu
            </a>
          </div>
          <p style="color:#6b7280;font-size:13px">
            Link có hiệu lực trong <strong>1 giờ</strong>. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="color:#9ca3af;font-size:12px;margin:0">
            Hoặc copy link: <a href="${link}" style="color:#dc2626">${link}</a>
          </p>
        </div>
      </div>
    `
  });
}

// ════════════════════════════════════════════════
// POST /api/auth/register
// ════════════════════════════════════════════════
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (username, email, password, email_verified) VALUES (?, ?, ?, 0)',
      [username, email, hash]
    );
    const userId = result.insertId;

    // Tạo token xác nhận email (24h)
    const token = genToken();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)',
      [userId, token, expires]
    );

    // Gửi mail (không chặn response nếu lỗi mail)
    sendVerifyMail(email, username, token).catch(err =>
      console.error('Lỗi gửi mail xác nhận:', err.message)
    );

    res.json({ message: 'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản.' });
  } catch (err) {
    res.status(400).json({ message: 'Username hoặc email đã tồn tại' });
  }
});

// ════════════════════════════════════════════════
// GET /api/auth/verify-email/:token
// ════════════════════════════════════════════════
router.get('/verify-email/:token', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM email_verifications WHERE token = ?',
      [req.params.token]
    );
    if (!rows.length) {
      return res.status(400).json({ message: 'Token không hợp lệ hoặc đã được sử dụng' });
    }
    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ message: 'Token đã hết hạn. Vui lòng đăng ký lại.' });
    }

    await db.query('UPDATE users SET email_verified = 1 WHERE id = ?', [row.user_id]);
    await db.query('DELETE FROM email_verifications WHERE id = ?', [row.id]);

    res.json({ message: 'Xác nhận email thành công! Bạn có thể đăng nhập ngay.' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ════════════════════════════════════════════════
// POST /api/auth/login
// ════════════════════════════════════════════════
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

    // Kiểm tra email đã xác nhận chưa
    if (!user.email_verified) {
      return res.status(403).json({
        message: 'Tài khoản chưa xác nhận email. Vui lòng kiểm tra hộp thư.',
        unverified: true
      });
    }

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

// ════════════════════════════════════════════════
// POST /api/auth/resend-verify
// Gửi lại email xác nhận
// ════════════════════════════════════════════════
router.post('/resend-verify', async (req, res) => {
  const { email } = req.body;
  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE email = ? AND email_verified = 0', [email]
    );
    if (!rows.length) {
      return res.status(400).json({ message: 'Email không tồn tại hoặc đã được xác nhận' });
    }
    const user = rows[0];

    // Xóa token cũ, tạo mới
    await db.query('DELETE FROM email_verifications WHERE user_id = ?', [user.id]);
    const token = genToken();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, token, expires]
    );

    await sendVerifyMail(user.email, user.username, token);
    res.json({ message: 'Đã gửi lại email xác nhận!' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi gửi mail' });
  }
});

// ════════════════════════════════════════════════
// POST /api/auth/forgot-password
// ════════════════════════════════════════════════
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    // Luôn trả về 200 để tránh lộ thông tin
    if (!rows.length) {
      return res.json({ message: 'Nếu email tồn tại, bạn sẽ nhận được hướng dẫn trong vài phút.' });
    }
    const user = rows[0];

    // Xóa token cũ (nếu có), tạo mới
    await db.query('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
    const token = genToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 giờ
    await db.query(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, token, expires]
    );

    await sendResetMail(user.email, user.username, token);
    res.json({ message: 'Nếu email tồn tại, bạn sẽ nhận được hướng dẫn trong vài phút.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi gửi mail' });
  }
});

// ════════════════════════════════════════════════
// POST /api/auth/reset-password/:token
// ════════════════════════════════════════════════
router.post('/reset-password/:token', async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }
  try {
    const [rows] = await db.query(
      'SELECT * FROM password_resets WHERE token = ? AND used = 0',
      [req.params.token]
    );
    if (!rows.length) {
      return res.status(400).json({ message: 'Link không hợp lệ hoặc đã được sử dụng' });
    }
    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ message: 'Link đã hết hạn. Vui lòng yêu cầu lại.' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, row.user_id]);
    await db.query('UPDATE password_resets SET used = 1 WHERE id = ?', [row.id]);

    res.json({ message: 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập ngay.' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ════════════════════════════════════════════════
// GET /api/auth/profile
// ════════════════════════════════════════════════
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

// ════════════════════════════════════════════════
// PUT /api/auth/profile
// ════════════════════════════════════════════════
router.put('/profile', auth, async (req, res) => {
  const { username, email, current_password, new_password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Người dùng không tồn tại' });
    const user = rows[0];

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ message: 'Cần nhập mật khẩu hiện tại để đổi mật khẩu' });
      }
      const match = await bcrypt.compare(current_password, user.password);
      if (!match) return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
      if (new_password.length < 6) {
        return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
      }
    }

    if (username && username !== user.username) {
      const [dup] = await db.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.user.id]);
      if (dup.length) return res.status(400).json({ message: 'Username đã được sử dụng' });
    }
    if (email && email !== user.email) {
      const [dup] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.user.id]);
      if (dup.length) return res.status(400).json({ message: 'Email đã được sử dụng' });
    }

    const updates = [];
    const values  = [];
    if (username?.trim()) { updates.push('username = ?'); values.push(username.trim()); }
    if (email?.trim())    { updates.push('email = ?');    values.push(email.trim()); }
    if (new_password) {
      const hash = await bcrypt.hash(new_password, 10);
      updates.push('password = ?');
      values.push(hash);
    }
    if (!updates.length) return res.status(400).json({ message: 'Không có thông tin nào để cập nhật' });

    values.push(req.user.id);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    const [updated] = await db.query(
      'SELECT id, username, email, role, quota, used_space, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    let newToken = null;
    if (username && username !== user.username) {
      newToken = jwt.sign(
        { id: updated[0].id, username: updated[0].username, role: updated[0].role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
    }

    res.json({ message: 'Cập nhật thành công', user: updated[0], ...(newToken && { token: newToken }) });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;