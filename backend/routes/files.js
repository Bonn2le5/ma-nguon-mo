const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const auth       = require('../middleware/authMiddleware');
const checkQuota = require('../middleware/quotaMiddleware');
const db         = require('../config/db');

// ─── Upload thường (≤ 100MB, qua Cloudflare) ─────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads', String(req.user.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

// Giới hạn 100MB mỗi file để không vượt giới hạn Cloudflare Tunnel (100MB/request).
// File lớn hơn phải dùng chunked upload.
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ─── Chunk upload storage ─────────────────────────────────────────────────────
const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tmpDir = path.join(__dirname, '../uploads/_chunks', req.body.uploadId || 'unknown');
      fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
      // Tên chunk = số thứ tự để sort đúng thứ tự khi ghép
      const idx = parseInt(req.body.chunkIndex) || 0;
      cb(null, String(idx).padStart(6, '0') + '.part');
    }
  }),
  // Mỗi chunk tối đa 10MB → luôn nhỏ hơn giới hạn 100MB của Cloudflare
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ─── Helper: kiểm tra quota chính xác bằng kích thước thực ───────────────────
async function checkQuotaExact(userId, fileSize) {
  const [rows] = await db.query(
    'SELECT quota, used_space FROM users WHERE id = ?',
    [userId]
  );
  if (!rows.length) throw new Error('User không tồn tại');
  const { quota, used_space } = rows[0];
  if (used_space + fileSize > quota) {
    const err = new Error('Dung lượng lưu trữ đã đầy. Vui lòng xóa bớt file.');
    err.status = 413;
    err.used   = used_space;
    err.quota  = quota;
    throw err;
  }
  return { quota, used_space };
}

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

// ════════════════════════════════════════════════════════════════
// UPLOAD THƯỜNG (file ≤ 100MB)
// ════════════════════════════════════════════════════════════════

router.post('/upload', auth, checkQuota, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Không có file được gửi lên' });

    const folder = req.body.folder || '/';
    const { filename, originalname, size, mimetype } = req.file;

    // FIX #1: Kiểm tra quota bằng kích thước file THỰC TẾ sau khi multer parse,
    // không dùng Content-Length ước tính từ middleware.
    try {
      await checkQuotaExact(req.user.id, size);
    } catch (quotaErr) {
      // Xóa file vừa lưu vì không đủ quota
      fs.unlink(req.file.path, () => {});
      return res.status(quotaErr.status || 413).json({
        message: quotaErr.message,
        used: quotaErr.used,
        quota: quotaErr.quota
      });
    }

    await db.query(
      'INSERT INTO files (user_id, filename, original_name, file_size, mime_type, folder_path) VALUES (?,?,?,?,?,?)',
      [req.user.id, filename, originalname, size, mimetype, folder]
    );
    await db.query('UPDATE users SET used_space = used_space + ? WHERE id = ?', [size, req.user.id]);

    res.json({ message: 'Upload thành công', filename, original_name: originalname });
  } catch (err) {
    console.error('upload error:', err);
    // Dọn file nếu còn trên disk
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ message: 'Lỗi upload' });
  }
});

// ════════════════════════════════════════════════════════════════
// CHUNKED UPLOAD — dành cho file lớn (> 100MB)
// Luồng: chunk-init → chunk (× N) → chunk-finalize
// ════════════════════════════════════════════════════════════════

// ── 1. POST /api/files/upload/chunk-init ──
router.post('/upload/chunk-init', auth, async (req, res) => {
  try {
    const { originalName, totalSize, mimeType, folder, totalChunks } = req.body;

    if (!originalName || !totalSize || !totalChunks) {
      return res.status(400).json({ message: 'Thiếu thông tin file (originalName, totalSize, totalChunks)' });
    }

    const parsedSize   = parseInt(totalSize);
    const parsedChunks = parseInt(totalChunks);

    if (isNaN(parsedSize) || parsedSize <= 0)   return res.status(400).json({ message: 'totalSize không hợp lệ' });
    if (isNaN(parsedChunks) || parsedChunks <= 0) return res.status(400).json({ message: 'totalChunks không hợp lệ' });

    // FIX #3: Vẫn kiểm tra quota sơ bộ ở đây, nhưng sẽ kiểm tra lại bằng
    // kích thước THỰC TẾ ở finalize — không tin hoàn toàn vào totalSize từ client.
    const [rows] = await db.query('SELECT quota, used_space FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'User không tồn tại' });
    const { quota, used_space } = rows[0];
    if (used_space + parsedSize > quota) {
      return res.status(413).json({
        message: 'Dung lượng lưu trữ đã đầy. Vui lòng xóa bớt file.',
        used: used_space,
        quota
      });
    }

    const uploadId = uuidv4();
    const tmpDir   = path.join(__dirname, '../uploads/_chunks', uploadId);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Lưu metadata — ghi thêm createdAt để cleanup job biết session cũ
    const meta = {
      originalName,
      totalSize: parsedSize,
      mimeType: mimeType || 'application/octet-stream',
      folder: folder || '/',
      totalChunks: parsedChunks,
      userId: req.user.id,
      createdAt: Date.now()
    };
    fs.writeFileSync(path.join(tmpDir, '_meta.json'), JSON.stringify(meta));

    res.json({ uploadId, message: 'Đã khởi tạo upload' });
  } catch (err) {
    console.error('chunk-init error:', err);
    res.status(500).json({ message: 'Lỗi khởi tạo upload' });
  }
});

// ── 2. POST /api/files/upload/chunk ──
router.post('/upload/chunk', auth, chunkUpload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks } = req.body;
    if (!uploadId || chunkIndex === undefined) {
      return res.status(400).json({ message: 'Thiếu uploadId hoặc chunkIndex' });
    }

    const tmpDir = path.join(__dirname, '../uploads/_chunks', uploadId);
    if (!fs.existsSync(tmpDir)) {
      return res.status(404).json({ message: 'Upload session không tồn tại. Hãy bắt đầu lại.' });
    }

    const metaPath = path.join(tmpDir, '_meta.json');
    const meta     = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.userId !== req.user.id) {
      return res.status(403).json({ message: 'Không có quyền' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Không nhận được dữ liệu chunk' });
    }

    res.json({
      message: `Chunk ${chunkIndex} nhận xong`,
      chunkIndex: parseInt(chunkIndex),
      received: req.file.size
    });
  } catch (err) {
    console.error('chunk upload error:', err);
    res.status(500).json({ message: 'Lỗi nhận chunk' });
  }
});

// ── 3. POST /api/files/upload/chunk-finalize ──
router.post('/upload/chunk-finalize', auth, async (req, res) => {
  let finalPath = null;
  const tmpDir  = req.body.uploadId
    ? path.join(__dirname, '../uploads/_chunks', req.body.uploadId)
    : null;

  try {
    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ message: 'Thiếu uploadId' });

    if (!fs.existsSync(tmpDir)) {
      return res.status(404).json({ message: 'Upload session không tồn tại' });
    }

    const metaPath = path.join(tmpDir, '_meta.json');
    const meta     = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.userId !== req.user.id) {
      return res.status(403).json({ message: 'Không có quyền' });
    }

    // Kiểm tra đủ chunk chưa
    const chunkFiles = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith('.part'))
      .sort();

    if (chunkFiles.length !== meta.totalChunks) {
      return res.status(400).json({
        message: `Thiếu chunk: nhận ${chunkFiles.length}/${meta.totalChunks}`
      });
    }

    // Tạo file đích
    const ext      = path.extname(meta.originalName);
    const finalFn  = uuidv4() + ext;
    const userDir  = path.join(__dirname, '../uploads', String(req.user.id));
    fs.mkdirSync(userDir, { recursive: true });
    finalPath = path.join(userDir, finalFn);

    // FIX #2: Ghép chunk bằng stream pipe tuần tự, KHÔNG readFileSync vào RAM.
    // Với file GB, cách cũ sẽ OOM crash server.
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(finalPath);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      // Pipe từng chunk vào writeStream theo thứ tự, không giữ toàn bộ data trong RAM
      const pipeNext = (i) => {
        if (i >= chunkFiles.length) {
          writeStream.end();
          return;
        }
        const chunkPath  = path.join(tmpDir, chunkFiles[i]);
        const readStream = fs.createReadStream(chunkPath);
        readStream.on('error', reject);
        readStream.on('end', () => pipeNext(i + 1));
        readStream.pipe(writeStream, { end: false });
      };

      pipeNext(0);
    });

    // Kích thước file THỰC TẾ sau khi ghép
    const actualSize = fs.statSync(finalPath).size;

    // FIX #3 + #4: Kiểm tra quota bằng kích thước THỰC TẾ, không tin totalSize từ client.
    try {
      await checkQuotaExact(req.user.id, actualSize);
    } catch (quotaErr) {
      fs.unlink(finalPath, () => {});
      finalPath = null;
      return res.status(quotaErr.status || 413).json({
        message: quotaErr.message,
        used: quotaErr.used,
        quota: quotaErr.quota
      });
    }

    // Lưu vào DB và cập nhật used_space
    await db.query(
      'INSERT INTO files (user_id, filename, original_name, file_size, mime_type, folder_path) VALUES (?,?,?,?,?,?)',
      [req.user.id, finalFn, meta.originalName, actualSize, meta.mimeType, meta.folder]
    );
    await db.query('UPDATE users SET used_space = used_space + ? WHERE id = ?', [actualSize, req.user.id]);

    // Dọn thư mục chunk tạm
    fs.rmSync(tmpDir, { recursive: true, force: true });

    res.json({
      message: 'Upload hoàn tất',
      filename: finalFn,
      original_name: meta.originalName,
      file_size: actualSize
    });
  } catch (err) {
    console.error('chunk-finalize error:', err);
    // Dọn file đích nếu ghép lỗi giữa chừng
    if (finalPath && fs.existsSync(finalPath)) fs.unlink(finalPath, () => {});
    res.status(500).json({ message: 'Lỗi ghép file: ' + err.message });
  }
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

// ── PUT /api/files/:id/restore ──
router.put('/:id/restore', auth, async (req, res) => {
  try {
    await db.query('UPDATE files SET is_deleted=0, deleted_at=NULL WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    res.json({ message: 'Đã khôi phục' });
  } catch (err) { res.status(500).json({ message: 'Lỗi khôi phục' }); }
});

// ── PUT /api/files/:id/tags ──
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

// ── DELETE /api/files/:id/permanent ──
router.delete('/:id/permanent', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM files WHERE id=? AND user_id=? AND is_deleted=1', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy file trong thùng rác' });
    const file = rows[0];
    const fp   = path.join(__dirname, '../uploads', String(req.user.id), file.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await db.query('DELETE FROM files WHERE id=?', [req.params.id]);
    await db.query('UPDATE users SET used_space=used_space-? WHERE id=?', [file.file_size, req.user.id]);
    res.json({ message: 'Đã xóa vĩnh viễn' });
  } catch (err) { res.status(500).json({ message: 'Lỗi xóa vĩnh viễn' }); }
});

// ── DELETE /api/files/tags/:tagId ──
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

// ── POST /api/files/:id/share-user ──
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

// ── DELETE /api/files/:id/share-user/:userId ──
router.delete('/:id/share-user/:userId', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM shared_with_users WHERE file_id=? AND owner_id=? AND recipient_id=?',
      [req.params.id, req.user.id, req.params.userId]);
    res.json({ message: 'Đã thu hồi chia sẻ' });
  } catch (err) { res.status(500).json({ message: 'Lỗi thu hồi' }); }
});

module.exports = router;
