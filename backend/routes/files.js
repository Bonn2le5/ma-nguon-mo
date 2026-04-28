const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const auth       = require('../middleware/authMiddleware');
const checkQuota = require('../middleware/quotaMiddleware');
const db         = require('../config/db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads', String(req.user.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// ── GET /api/files ── danh sách file trong folder
router.get('/', auth, async (req, res) => {
  try {
    const folder = req.query.folder || '/';
    const [files] = await db.query(
      `SELECT f.*, GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as tag_ids,
              GROUP_CONCAT(t.name ORDER BY t.id SEPARATOR ',') as tag_names,
              GROUP_CONCAT(t.color ORDER BY t.id SEPARATOR ',') as tag_colors
       FROM files f
       LEFT JOIN file_tags ft ON ft.file_id = f.id
       LEFT JOIN tags t ON t.id = ft.tag_id
       WHERE f.user_id = ? AND f.folder_path = ? AND f.is_deleted = 0
       GROUP BY f.id ORDER BY f.created_at DESC`,
      [req.user.id, folder]
    );
    res.json(files);
  } catch (err) { res.status(500).json({ message: 'Lỗi server' }); }
});

// ── GET /api/files/favorites ──
router.get('/favorites', auth, async (req, res) => {
  try {
    const [files] = await db.query(
      `SELECT f.*, GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as tag_ids,
              GROUP_CONCAT(t.name ORDER BY t.id SEPARATOR ',') as tag_names,
              GROUP_CONCAT(t.color ORDER BY t.id SEPARATOR ',') as tag_colors
       FROM files f
       LEFT JOIN file_tags ft ON ft.file_id = f.id
       LEFT JOIN tags t ON t.id = ft.tag_id
       WHERE f.user_id = ? AND f.is_favorite = 1 AND f.is_deleted = 0
       GROUP BY f.id ORDER BY f.created_at DESC`,
      [req.user.id]
    );
    res.json(files);
  } catch (err) { res.status(500).json({ message: 'Lỗi server' }); }
});

// ── GET /api/files/trash ──
router.get('/trash', auth, async (req, res) => {
  try {
    const [files] = await db.query(
      'SELECT * FROM files WHERE user_id = ? AND is_deleted = 1 ORDER BY deleted_at DESC',
      [req.user.id]
    );
    res.json(files);
  } catch (err) { res.status(500).json({ message: 'Lỗi server' }); }
});

// ── GET /api/files/shared-with-me ──
router.get('/shared-with-me', auth, async (req, res) => {
  try {
    const [files] = await db.query(
      `SELECT f.id, f.original_name, f.file_size, f.mime_type, f.created_at,
              u.username as owner_name, swu.can_download, swu.id as share_entry_id
       FROM shared_with_users swu
       JOIN files f ON f.id = swu.file_id
       JOIN users u ON u.id = swu.owner_id
       WHERE swu.recipient_id = ? AND f.is_deleted = 0
       ORDER BY swu.created_at DESC`,
      [req.user.id]
    );
    res.json(files);
  } catch (err) { res.status(500).json({ message: 'Lỗi server' }); }
});

// ── GET /api/files/info/storage ──
router.get('/info/storage', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT quota, used_space FROM users WHERE id = ?', [req.user.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ message: 'Lỗi server' }); }
});

// ── GET /api/files/tags/list ──
router.get('/tags/list', auth, async (req, res) => {
  try {
    const [tags] = await db.query('SELECT * FROM tags WHERE user_id = ? ORDER BY name', [req.user.id]);
    res.json(tags);
  } catch (err) { res.status(500).json({ message: 'Lỗi lấy tags' }); }
});

// ── GET /api/files/search-users ──
router.get('/search-users', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const [users] = await db.query(
      'SELECT id, username, email FROM users WHERE username LIKE ? AND id != ? LIMIT 8',
      [`%${q}%`, req.user.id]
    );
    res.json(users);
  } catch (err) { res.status(500).json({ message: 'Lỗi tìm kiếm' }); }
});

// ── POST /api/files/upload ──
router.post('/upload', auth, checkQuota, upload.single('file'), async (req, res) => {
  try {
    const folder = req.body.folder || '/';
    const { filename, originalname, size, mimetype } = req.file;
    await db.query(
      'INSERT INTO files (user_id, filename, original_name, file_size, mime_type, folder_path) VALUES (?,?,?,?,?,?)',
      [req.user.id, filename, originalname, size, mimetype, folder]
    );
    await db.query('UPDATE users SET used_space = used_space + ? WHERE id = ?', [size, req.user.id]);
    res.json({ message: 'Upload thành công', filename, original_name: originalname });
  } catch (err) { res.status(500).json({ message: 'Lỗi upload' }); }
});

// ── POST /api/files/tags ── tạo tag
router.post('/tags', auth, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Tên tag không được trống' });
    const [result] = await db.query(
      'INSERT INTO tags (user_id, name, color) VALUES (?,?,?) ON DUPLICATE KEY UPDATE color=VALUES(color), id=LAST_INSERT_ID(id)',
      [req.user.id, name.trim(), color || '#6366f1']
    );
    res.json({ id: result.insertId, name: name.trim(), color: color || '#6366f1' });
  } catch (err) { res.status(500).json({ message: 'Lỗi tạo tag' }); }
});

// ── GET /api/files/download/:id ──
router.get('/download/:id', auth, async (req, res) => {
  try {
    const [owned] = await db.query('SELECT * FROM files WHERE id = ? AND user_id = ? AND is_deleted = 0', [req.params.id, req.user.id]);
    const [shared] = await db.query(
      `SELECT f.* FROM files f JOIN shared_with_users swu ON swu.file_id = f.id
       WHERE f.id = ? AND swu.recipient_id = ? AND f.is_deleted = 0`,
      [req.params.id, req.user.id]
    );
    const file = owned[0] || shared[0];
    if (!file) return res.status(404).json({ message: 'Không tìm thấy file' });
    const filePath = path.join(__dirname, '../uploads', String(file.user_id), file.filename);
    res.download(filePath, file.original_name);
  } catch (err) { res.status(500).json({ message: 'Lỗi download' }); }
});

// ── PUT /api/files/:id/rename ──
router.put('/:id/rename', auth, async (req, res) => {
  try {
    const { new_name } = req.body;
    await db.query('UPDATE files SET original_name = ? WHERE id = ? AND user_id = ?', [new_name, req.params.id, req.user.id]);
    res.json({ message: 'Đổi tên thành công' });
  } catch (err) { res.status(500).json({ message: 'Lỗi đổi tên' }); }
});

// ── PUT /api/files/:id/favorite ── toggle yêu thích
router.put('/:id/favorite', auth, async (req, res) => {
  try {
    const [[file]] = await db.query('SELECT is_favorite FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!file) return res.status(404).json({ message: 'Không tìm thấy file' });
    const newVal = file.is_favorite ? 0 : 1;
    await db.query('UPDATE files SET is_favorite = ? WHERE id = ?', [newVal, req.params.id]);
    res.json({ is_favorite: newVal });
  } catch (err) { res.status(500).json({ message: 'Lỗi yêu thích' }); }
});

// ── PUT /api/files/:id/restore ── khôi phục từ trash
router.put('/:id/restore', auth, async (req, res) => {
  try {
    await db.query('UPDATE files SET is_deleted=0, deleted_at=NULL WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    res.json({ message: 'Đã khôi phục' });
  } catch (err) { res.status(500).json({ message: 'Lỗi khôi phục' }); }
});

// ── PUT /api/files/:id/tags ── cập nhật tags cho file
router.put('/:id/tags', auth, async (req, res) => {
  try {
    const { tag_ids } = req.body;
    const [[file]] = await db.query('SELECT id FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!file) return res.status(404).json({ message: 'Không tìm thấy file' });
    await db.query('DELETE FROM file_tags WHERE file_id = ?', [req.params.id]);
    if (tag_ids && tag_ids.length > 0) {
      await db.query('INSERT INTO file_tags (file_id, tag_id) VALUES ?', [tag_ids.map(tid => [req.params.id, tid])]);
    }
    res.json({ message: 'Cập nhật tag thành công' });
  } catch (err) { res.status(500).json({ message: 'Lỗi cập nhật tag' }); }
});

// ── DELETE /api/files/:id ── chuyển vào trash
router.delete('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM files WHERE id=? AND user_id=? AND is_deleted=0', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy file' });
    await db.query('UPDATE files SET is_deleted=1, deleted_at=NOW() WHERE id=?', [req.params.id]);
    res.json({ message: 'Đã chuyển vào thùng rác' });
  } catch (err) { res.status(500).json({ message: 'Lỗi xóa file' }); }
});

// ── DELETE /api/files/trash/empty ── dọn thùng rác
router.delete('/trash/empty', auth, async (req, res) => {
  try {
    const [files] = await db.query('SELECT * FROM files WHERE user_id=? AND is_deleted=1', [req.user.id]);
    let freed = 0;
    for (const f of files) {
      const fp = path.join(__dirname, '../uploads', String(req.user.id), f.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      freed += f.file_size || 0;
    }
    await db.query('DELETE FROM files WHERE user_id=? AND is_deleted=1', [req.user.id]);
    if (freed > 0) await db.query('UPDATE users SET used_space=used_space-? WHERE id=?', [freed, req.user.id]);
    res.json({ message: `Đã dọn ${files.length} file` });
  } catch (err) { res.status(500).json({ message: 'Lỗi dọn thùng rác' }); }
});

// ── DELETE /api/files/:id/permanent ── xóa vĩnh viễn
router.delete('/:id/permanent', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM files WHERE id=? AND user_id=? AND is_deleted=1', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy file trong thùng rác' });
    const file = rows[0];
    const fp = path.join(__dirname, '../uploads', String(req.user.id), file.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await db.query('DELETE FROM files WHERE id=?', [req.params.id]);
    await db.query('UPDATE users SET used_space=used_space-? WHERE id=?', [file.file_size, req.user.id]);
    res.json({ message: 'Đã xóa vĩnh viễn' });
  } catch (err) { res.status(500).json({ message: 'Lỗi xóa vĩnh viễn' }); }
});

// ── DELETE /api/files/tags/:tagId ── xóa tag
router.delete('/tags/:tagId', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM tags WHERE id=? AND user_id=?', [req.params.tagId, req.user.id]);
    res.json({ message: 'Đã xóa tag' });
  } catch (err) { res.status(500).json({ message: 'Lỗi xóa tag' }); }
});

// ── GET /api/files/:id/shared-users ──
router.get('/:id/shared-users', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT swu.*, u.username, u.email FROM shared_with_users swu
       JOIN users u ON u.id = swu.recipient_id
       WHERE swu.file_id=? AND swu.owner_id=?`,
      [req.params.id, req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ message: 'Lỗi server' }); }
});

// ── POST /api/files/:id/share-user ── chia sẻ cho user
router.post('/:id/share-user', auth, async (req, res) => {
  try {
    const { username, can_download } = req.body;
    const [[file]] = await db.query('SELECT id FROM files WHERE id=? AND user_id=? AND is_deleted=0', [req.params.id, req.user.id]);
    if (!file) return res.status(404).json({ message: 'Không tìm thấy file' });

    const [[target]] = await db.query('SELECT id, username FROM users WHERE username=?', [username]);
    if (!target) return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    if (target.id === req.user.id) return res.status(400).json({ message: 'Không thể chia sẻ cho chính mình' });

    await db.query(
      `INSERT INTO shared_with_users (file_id, owner_id, recipient_id, can_download)
       VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE can_download=VALUES(can_download)`,
      [req.params.id, req.user.id, target.id, can_download !== false ? 1 : 0]
    );
    res.json({ message: `Đã chia sẻ cho ${target.username}` });
  } catch (err) { res.status(500).json({ message: 'Lỗi chia sẻ' }); }
});

// ── DELETE /api/files/:id/share-user/:userId ── thu hồi
router.delete('/:id/share-user/:userId', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM shared_with_users WHERE file_id=? AND owner_id=? AND recipient_id=?',
      [req.params.id, req.user.id, req.params.userId]);
    res.json({ message: 'Đã thu hồi chia sẻ' });
  } catch (err) { res.status(500).json({ message: 'Lỗi thu hồi' }); }
});

module.exports = router;