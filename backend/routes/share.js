const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/authMiddleware');
const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// POST /api/share — tạo link share
router.post('/', auth, async (req, res) => {
  try {
    const { file_id, allow_upload, expires_at } = req.body;

    // Kiểm tra file thuộc user
    const [files] = await db.query(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [file_id, req.user.id]
    );
    if (!files.length) return res.status(404).json({ message: 'Không tìm thấy file' });

    // Kiểm tra đã có share chưa
    const [existing] = await db.query(
      'SELECT * FROM shares WHERE file_id = ? AND user_id = ?',
      [file_id, req.user.id]
    );
    if (existing.length) {
      return res.json({ token: existing[0].token, message: 'Link share đã tồn tại' });
    }

    const token = uuidv4();
    await db.query(
      'INSERT INTO shares (file_id, user_id, token, allow_upload, expires_at) VALUES (?,?,?,?,?)',
      [file_id, req.user.id, token, allow_upload || false, expires_at || null]
    );

    res.json({ token, share_url: `/api/share/${token}` });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tạo share link' });
  }
});

// GET /api/share/:token — truy cập file qua share link
router.get('/:token', async (req, res) => {
  try {
    const [shares] = await db.query(
      `SELECT s.*, f.filename, f.original_name, f.file_size, f.mime_type, f.user_id as owner_id
       FROM shares s JOIN files f ON s.file_id = f.id
       WHERE s.token = ?`,
      [req.params.token]
    );
    if (!shares.length) return res.status(404).json({ message: 'Link không hợp lệ' });

    const share = shares[0];

    // Kiểm tra hết hạn
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ message: 'Link đã hết hạn' });
    }

    res.json({
      file_name: share.original_name,
      file_size: share.file_size,
      mime_type: share.mime_type,
      allow_upload: share.allow_upload,
      token: req.params.token
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// GET /api/share/:token/download — download qua share link
router.get('/:token/download', async (req, res) => {
  try {
    const [shares] = await db.query(
      `SELECT s.*, f.filename, f.original_name, f.user_id as owner_id
       FROM shares s JOIN files f ON s.file_id = f.id
       WHERE s.token = ?`,
      [req.params.token]
    );
    if (!shares.length) return res.status(404).json({ message: 'Link không hợp lệ' });

    const share = shares[0];
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ message: 'Link đã hết hạn' });
    }

    const filePath = path.join(__dirname, '../uploads', String(share.owner_id), share.filename);
    res.download(filePath, share.original_name);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi download' });
  }
});

// DELETE /api/share/:id — xóa share link
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM shares WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Đã xóa link share' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa share' });
  }
});

module.exports = router;