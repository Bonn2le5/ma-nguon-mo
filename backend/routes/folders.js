const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const db = require('../config/db');

// GET /api/folders — lấy danh sách thư mục (kèm is_favorite)
router.get('/', auth, async (req, res) => {
  try {
    const [folders] = await db.query(
      'SELECT * FROM folders WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(folders);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// POST /api/folders — tạo thư mục mới
router.post('/', auth, async (req, res) => {
  try {
    const { name, parent_path } = req.body;
    const base = (parent_path || '/').replace(/\/$/, '');
    const fullPath = base + '/' + name + '/';
    // Kiểm tra trùng tên
    const [existing] = await db.query(
      'SELECT id FROM folders WHERE user_id = ? AND path = ?',
      [req.user.id, fullPath]
    );
    if (existing.length) return res.status(400).json({ message: 'Thư mục đã tồn tại' });

    await db.query(
      'INSERT INTO folders (user_id, name, path) VALUES (?, ?, ?)',
      [req.user.id, name, fullPath]
    );
    res.json({ message: 'Tạo thư mục thành công', path: fullPath });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tạo thư mục' });
  }
});

// DELETE /api/folders/:id — xóa thư mục
router.delete('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM folders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy thư mục' });

    await db.query(
  'DELETE FROM folders WHERE user_id = ? AND (id = ? OR path LIKE ?)',
        [req.user.id, req.params.id, rows[0].path + '%']
    );
    // Xóa file trong thư mục đó
    await db.query(
      'DELETE FROM files WHERE user_id = ? AND folder_path LIKE ?',
      [req.user.id, rows[0].path + '%']
    );
    res.json({ message: 'Xóa thư mục thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa thư mục' });
  }
});


// PUT /api/folders/:id/favorite — toggle yêu thích thư mục
router.put('/:id/favorite', auth, async (req, res) => {
  try {
    const [[folder]] = await db.query(
      'SELECT id, is_favorite FROM folders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!folder) return res.status(404).json({ message: 'Không tìm thấy thư mục' });
    const newVal = folder.is_favorite ? 0 : 1;
    await db.query('UPDATE folders SET is_favorite = ? WHERE id = ?', [newVal, req.params.id]);
    res.json({ is_favorite: newVal });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật yêu thích' });
  }
});

module.exports = router;