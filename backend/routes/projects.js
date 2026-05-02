const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const auth    = require('../middleware/authMiddleware');
const db      = require('../config/db');

// ══════════════════════════════════════════════
// MULTER — upload thường cho project (≤ 100MB)
// ══════════════════════════════════════════════
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/projects', String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ══════════════════════════════════════════════
// MULTER — chunked upload cho project (mỗi chunk ≤ 10MB)
// ══════════════════════════════════════════════
const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tmpDir = path.join(__dirname, '../uploads/_chunks/projects', req.body.uploadId || 'unknown');
      fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
      const idx = parseInt(req.body.chunkIndex) || 0;
      cb(null, String(idx).padStart(6, '0') + '.part');
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ══════════════════════════════════════════════
// HELPER: kiểm tra quyền trong project
// ══════════════════════════════════════════════
async function getMember(projectId, userId) {
  const [rows] = await db.query(
    `SELECT pm.role, p.owner_id FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     WHERE pm.project_id = ? AND pm.user_id = ?`,
    [projectId, userId]
  );
  return rows[0] || null;
}

// ══════════════════════════════════════════════
// SEARCH USERS
// ══════════════════════════════════════════════
router.get('/search-users', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const projectId = req.query.project;
    if (!q) return res.json([]);

    let excludeIds = [req.user.id];
    if (projectId) {
      const [members] = await db.query('SELECT user_id FROM project_members WHERE project_id = ?', [projectId]);
      members.forEach(m => excludeIds.push(m.user_id));
    }

    const placeholders = excludeIds.map(() => '?').join(',');
    const [users] = await db.query(
      `SELECT id, username, email FROM users
       WHERE username LIKE ? AND id NOT IN (${placeholders})
       LIMIT 8`,
      [`%${q}%`, ...excludeIds]
    );
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tìm kiếm' });
  }
});

// ══════════════════════════════════════════════
// PROJECT CRUD
// ══════════════════════════════════════════════

router.get('/', auth, async (req, res) => {
  try {
    const [projects] = await db.query(
      `SELECT p.*, u.username as owner_name,
              pm.role as my_role,
              (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
              (SELECT COUNT(*) FROM project_files WHERE project_id = p.id) as file_count
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       JOIN users u ON u.id = p.owner_id
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Tên project không được trống' });

    const [result] = await db.query(
      'INSERT INTO projects (name, description, owner_id) VALUES (?,?,?)',
      [name.trim(), description || '', req.user.id]
    );
    const projectId = result.insertId;
    await db.query(
      'INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)',
      [projectId, req.user.id, 'owner']
    );
    res.json({ message: 'Tạo project thành công', id: projectId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tạo project' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: 'Không có quyền truy cập' });

    const [[project]] = await db.query(
      `SELECT p.*, u.username as owner_name
       FROM projects p JOIN users u ON u.id = p.owner_id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!project) return res.status(404).json({ message: 'Không tìm thấy project' });
    res.json({ ...project, my_role: member.role });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role !== 'owner') return res.status(403).json({ message: 'Chỉ chủ project mới được chỉnh sửa' });

    const { name, description } = req.body;
    await db.query(
      'UPDATE projects SET name = ?, description = ? WHERE id = ?',
      [name, description, req.params.id]
    );
    res.json({ message: 'Cập nhật thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role !== 'owner') return res.status(403).json({ message: 'Chỉ chủ project mới được xóa' });

    const dir = path.join(__dirname, '../uploads/projects', req.params.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });

    await db.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ message: 'Đã xóa project' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa project' });
  }
});

// ══════════════════════════════════════════════
// MEMBERS
// ══════════════════════════════════════════════

router.get('/:id/members', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: 'Không có quyền' });

    const [members] = await db.query(
      `SELECT pm.id, pm.role, pm.joined_at, u.id as user_id, u.username, u.email
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?
       ORDER BY pm.joined_at ASC`,
      [req.params.id]
    );
    res.json(members);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.post('/:id/members', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role !== 'owner') return res.status(403).json({ message: 'Chỉ chủ project mới thêm được thành viên' });

    const { username, role } = req.body;
    if (!['editor', 'viewer'].includes(role)) return res.status(400).json({ message: 'Role không hợp lệ (editor/viewer)' });

    const [users] = await db.query('SELECT id, username FROM users WHERE username = ?', [username]);
    if (!users.length) return res.status(404).json({ message: 'Không tìm thấy người dùng' });

    const targetUser = users[0];
    if (targetUser.id === req.user.id) return res.status(400).json({ message: 'Không thể tự thêm chính mình' });

    const [existing] = await db.query(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
      [req.params.id, targetUser.id]
    );
    if (existing.length) return res.status(400).json({ message: 'Người dùng đã là thành viên của project' });

    await db.query(
      'INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)',
      [req.params.id, targetUser.id, role]
    );
    res.json({ message: `Đã thêm ${targetUser.username} với quyền ${role}` });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi thêm thành viên' });
  }
});

router.put('/:id/members/:memberId', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role !== 'owner') return res.status(403).json({ message: 'Không có quyền' });

    const { role } = req.body;
    if (!['editor', 'viewer'].includes(role)) return res.status(400).json({ message: 'Role không hợp lệ' });

    const [[target]] = await db.query('SELECT role FROM project_members WHERE id = ?', [req.params.memberId]);
    if (!target || target.role === 'owner') return res.status(400).json({ message: 'Không thể đổi role của chủ project' });

    await db.query('UPDATE project_members SET role = ? WHERE id = ? AND project_id = ?',
      [role, req.params.memberId, req.params.id]);
    res.json({ message: 'Cập nhật quyền thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật quyền' });
  }
});

router.delete('/:id/members/:memberId', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role !== 'owner') return res.status(403).json({ message: 'Không có quyền' });

    const [[target]] = await db.query('SELECT role, user_id FROM project_members WHERE id = ?', [req.params.memberId]);
    if (!target) return res.status(404).json({ message: 'Không tìm thấy thành viên' });
    if (target.role === 'owner') return res.status(400).json({ message: 'Không thể xóa chủ project' });

    await db.query('DELETE FROM project_members WHERE id = ? AND project_id = ?', [req.params.memberId, req.params.id]);
    res.json({ message: 'Đã xóa thành viên' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa thành viên' });
  }
});

// ══════════════════════════════════════════════
// TAGS — dùng chung namespace của project
// Bảng: project_tags (id, project_id, name, color)
//        project_file_tags (file_id, tag_id)
// ══════════════════════════════════════════════

// GET /api/projects/:id/tags — lấy danh sách tag của project
router.get('/:id/tags', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: 'Không có quyền' });

    const [tags] = await db.query(
      'SELECT * FROM project_tags WHERE project_id = ? ORDER BY name',
      [req.params.id]
    );
    res.json(tags);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy tags' });
  }
});

// POST /api/projects/:id/tags — tạo tag mới
router.post('/:id/tags', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role === 'viewer') return res.status(403).json({ message: 'Bạn chỉ có quyền xem' });

    const { name, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Tên tag không được trống' });

    const [result] = await db.query(
      `INSERT INTO project_tags (project_id, name, color) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE color=VALUES(color), id=LAST_INSERT_ID(id)`,
      [req.params.id, name.trim(), color || '#6366f1']
    );
    res.json({ id: result.insertId, name: name.trim(), color: color || '#6366f1' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tạo tag' });
  }
});

// DELETE /api/projects/:id/tags/:tagId — xóa tag
router.delete('/:id/tags/:tagId', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role === 'viewer') return res.status(403).json({ message: 'Bạn chỉ có quyền xem' });

    await db.query('DELETE FROM project_tags WHERE id = ? AND project_id = ?',
      [req.params.tagId, req.params.id]);
    res.json({ message: 'Đã xóa tag' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa tag' });
  }
});

// ══════════════════════════════════════════════
// FILES — CRUD + favorite + tags
// ══════════════════════════════════════════════

// GET /api/projects/:id/files — có kèm tags + is_favorite
router.get('/:id/files', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: 'Không có quyền' });

    const [files] = await db.query(
      `SELECT pf.*,
              u.username as uploaded_by_name,
              pf.is_favorite,
              GROUP_CONCAT(pt.id   ORDER BY pt.id SEPARATOR ',') as tag_ids,
              GROUP_CONCAT(pt.name ORDER BY pt.id SEPARATOR ',') as tag_names,
              GROUP_CONCAT(pt.color ORDER BY pt.id SEPARATOR ',') as tag_colors
       FROM project_files pf
       JOIN users u ON u.id = pf.uploaded_by
       LEFT JOIN project_file_tags pft ON pft.file_id = pf.id
       LEFT JOIN project_tags pt ON pt.id = pft.tag_id
       WHERE pf.project_id = ?
       GROUP BY pf.id
       ORDER BY pf.is_favorite DESC, pf.created_at DESC`,
      [req.params.id]
    );
    res.json(files);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách file' });
  }
});

// POST /api/projects/:id/files/upload — upload thường (≤ 100MB)
router.post('/:id/files/upload', auth, async (req, res) => {
  const member = await getMember(req.params.id, req.user.id);
  if (!member || member.role === 'viewer') return res.status(403).json({ message: 'Bạn chỉ có quyền xem' });

  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    try {
      const { filename, originalname, size, mimetype } = req.file;
      const [result] = await db.query(
        'INSERT INTO project_files (project_id, filename, original_name, file_size, mime_type, uploaded_by) VALUES (?,?,?,?,?,?)',
        [req.params.id, filename, originalname, size, mimetype, req.user.id]
      );
      res.json({ message: 'Upload thành công', id: result.insertId, filename, original_name: originalname });
    } catch (e) {
      res.status(500).json({ message: 'Lỗi lưu file' });
    }
  });
});

// ── CHUNKED UPLOAD cho project ────────────────────────────────────────────────

// 1. POST /api/projects/:id/files/upload/chunk-init
router.post('/:id/files/upload/chunk-init', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role === 'viewer') return res.status(403).json({ message: 'Bạn chỉ có quyền xem' });

    const { originalName, totalSize, mimeType, totalChunks } = req.body;
    if (!originalName || !totalSize || !totalChunks) {
      return res.status(400).json({ message: 'Thiếu thông tin file' });
    }

    const parsedSize   = parseInt(totalSize);
    const parsedChunks = parseInt(totalChunks);
    if (isNaN(parsedSize) || parsedSize <= 0)    return res.status(400).json({ message: 'totalSize không hợp lệ' });
    if (isNaN(parsedChunks) || parsedChunks <= 0) return res.status(400).json({ message: 'totalChunks không hợp lệ' });

    const uploadId = uuidv4();
    const tmpDir   = path.join(__dirname, '../uploads/_chunks/projects', uploadId);
    fs.mkdirSync(tmpDir, { recursive: true });

    fs.writeFileSync(path.join(tmpDir, '_meta.json'), JSON.stringify({
      originalName,
      totalSize: parsedSize,
      mimeType: mimeType || 'application/octet-stream',
      totalChunks: parsedChunks,
      projectId: req.params.id,
      userId: req.user.id,
      createdAt: Date.now()
    }));

    res.json({ uploadId, message: 'Đã khởi tạo upload' });
  } catch (err) {
    console.error('project chunk-init error:', err);
    res.status(500).json({ message: 'Lỗi khởi tạo upload' });
  }
});

// 2. POST /api/projects/:id/files/upload/chunk
router.post('/:id/files/upload/chunk', auth, chunkUpload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    if (!uploadId || chunkIndex === undefined) {
      return res.status(400).json({ message: 'Thiếu uploadId hoặc chunkIndex' });
    }

    const tmpDir = path.join(__dirname, '../uploads/_chunks/projects', uploadId);
    if (!fs.existsSync(tmpDir)) {
      return res.status(404).json({ message: 'Upload session không tồn tại. Hãy bắt đầu lại.' });
    }

    const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, '_meta.json'), 'utf8'));
    if (meta.userId !== req.user.id) return res.status(403).json({ message: 'Không có quyền' });
    if (!req.file) return res.status(400).json({ message: 'Không nhận được dữ liệu chunk' });

    res.json({ message: `Chunk ${chunkIndex} nhận xong`, chunkIndex: parseInt(chunkIndex) });
  } catch (err) {
    console.error('project chunk upload error:', err);
    res.status(500).json({ message: 'Lỗi nhận chunk' });
  }
});

// 3. POST /api/projects/:id/files/upload/chunk-finalize
router.post('/:id/files/upload/chunk-finalize', auth, async (req, res) => {
  let finalPath = null;
  const { uploadId } = req.body;
  const tmpDir = uploadId
    ? path.join(__dirname, '../uploads/_chunks/projects', uploadId)
    : null;

  try {
    if (!uploadId) return res.status(400).json({ message: 'Thiếu uploadId' });
    if (!fs.existsSync(tmpDir)) return res.status(404).json({ message: 'Upload session không tồn tại' });

    const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, '_meta.json'), 'utf8'));
    if (meta.userId !== req.user.id) return res.status(403).json({ message: 'Không có quyền' });

    // Kiểm tra quyền member
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role === 'viewer') return res.status(403).json({ message: 'Bạn chỉ có quyền xem' });

    // Kiểm tra đủ chunk chưa
    const chunkFiles = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith('.part'))
      .sort();

    if (chunkFiles.length !== meta.totalChunks) {
      return res.status(400).json({
        message: `Thiếu chunk: nhận ${chunkFiles.length}/${meta.totalChunks}`
      });
    }

    // Tạo file đích trong thư mục project
    const ext       = path.extname(meta.originalName);
    const finalFn   = uuidv4() + ext;
    const projectDir = path.join(__dirname, '../uploads/projects', String(req.params.id));
    fs.mkdirSync(projectDir, { recursive: true });
    finalPath = path.join(projectDir, finalFn);

    // Ghép chunk bằng stream (không load vào RAM)
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(finalPath);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      const pipeNext = (i) => {
        if (i >= chunkFiles.length) { writeStream.end(); return; }
        const readStream = fs.createReadStream(path.join(tmpDir, chunkFiles[i]));
        readStream.on('error', reject);
        readStream.on('end', () => pipeNext(i + 1));
        readStream.pipe(writeStream, { end: false });
      };
      pipeNext(0);
    });

    const actualSize = fs.statSync(finalPath).size;

    // Lưu vào DB
    const [result] = await db.query(
      'INSERT INTO project_files (project_id, filename, original_name, file_size, mime_type, uploaded_by) VALUES (?,?,?,?,?,?)',
      [req.params.id, finalFn, meta.originalName, actualSize, meta.mimeType, req.user.id]
    );

    // Dọn chunk tạm
    fs.rmSync(tmpDir, { recursive: true, force: true });

    res.json({
      message: 'Upload hoàn tất',
      id: result.insertId,
      filename: finalFn,
      original_name: meta.originalName,
      file_size: actualSize
    });
  } catch (err) {
    console.error('project chunk-finalize error:', err);
    if (finalPath && fs.existsSync(finalPath)) fs.unlink(finalPath, () => {});
    res.status(500).json({ message: 'Lỗi ghép file: ' + err.message });
  }
});

// GET /api/projects/:id/files/:fileId/download
router.get('/:id/files/:fileId/download', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: 'Không có quyền' });

    const [[file]] = await db.query('SELECT * FROM project_files WHERE id = ? AND project_id = ?',
      [req.params.fileId, req.params.id]);
    if (!file) return res.status(404).json({ message: 'Không tìm thấy file' });

    const filePath = path.join(__dirname, '../uploads/projects', String(req.params.id), file.filename);
    res.download(filePath, file.original_name);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi download' });
  }
});

// PUT /api/projects/:id/files/:fileId/rename
router.put('/:id/files/:fileId/rename', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role === 'viewer') return res.status(403).json({ message: 'Bạn chỉ có quyền xem' });

    const { new_name } = req.body;
    if (!new_name?.trim()) return res.status(400).json({ message: 'Tên không hợp lệ' });

    await db.query('UPDATE project_files SET original_name = ? WHERE id = ? AND project_id = ?',
      [new_name.trim(), req.params.fileId, req.params.id]);
    res.json({ message: 'Đổi tên thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi đổi tên' });
  }
});

// PUT /api/projects/:id/files/:fileId/favorite — toggle yêu thích
router.put('/:id/files/:fileId/favorite', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: 'Không có quyền' });

    const [[file]] = await db.query(
      'SELECT is_favorite FROM project_files WHERE id = ? AND project_id = ?',
      [req.params.fileId, req.params.id]
    );
    if (!file) return res.status(404).json({ message: 'Không tìm thấy file' });

    const newVal = file.is_favorite ? 0 : 1;
    await db.query('UPDATE project_files SET is_favorite = ? WHERE id = ?', [newVal, req.params.fileId]);
    res.json({ is_favorite: newVal });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi yêu thích' });
  }
});

// PUT /api/projects/:id/files/:fileId/tags — cập nhật tags cho file
router.put('/:id/files/:fileId/tags', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role === 'viewer') return res.status(403).json({ message: 'Bạn chỉ có quyền xem' });

    const { tag_ids } = req.body;

    const [[file]] = await db.query(
      'SELECT id FROM project_files WHERE id = ? AND project_id = ?',
      [req.params.fileId, req.params.id]
    );
    if (!file) return res.status(404).json({ message: 'Không tìm thấy file' });

    // Xóa tag cũ rồi thêm lại
    await db.query('DELETE FROM project_file_tags WHERE file_id = ?', [req.params.fileId]);
    if (tag_ids && tag_ids.length > 0) {
      await db.query(
        'INSERT INTO project_file_tags (file_id, tag_id) VALUES ?',
        [tag_ids.map(tid => [req.params.fileId, tid])]
      );
    }
    res.json({ message: 'Cập nhật tag thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật tag' });
  }
});

// DELETE /api/projects/:id/files/:fileId
router.delete('/:id/files/:fileId', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role === 'viewer') return res.status(403).json({ message: 'Bạn chỉ có quyền xem' });

    const [[file]] = await db.query('SELECT * FROM project_files WHERE id = ? AND project_id = ?',
      [req.params.fileId, req.params.id]);
    if (!file) return res.status(404).json({ message: 'Không tìm thấy file' });

    const filePath = path.join(__dirname, '../uploads/projects', String(req.params.id), file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await db.query('DELETE FROM project_files WHERE id = ?', [req.params.fileId]);
    res.json({ message: 'Đã xóa file' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa file' });
  }
});

module.exports = router;