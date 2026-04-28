const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/authMiddleware');
const db = require('../config/db');

// ──────────────────────────────────────────────
// Multer: lưu file upload của project
// ──────────────────────────────────────────────
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
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// ──────────────────────────────────────────────
// Helper: kiểm tra quyền trong project
// ──────────────────────────────────────────────
async function getMember(projectId, userId) {
  const [rows] = await db.query(
    `SELECT pm.role, p.owner_id FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     WHERE pm.project_id = ? AND pm.user_id = ?`,
    [projectId, userId]
  );
  return rows[0] || null;
}

// ──────────────────────────────────────────────
// GET /api/projects/search-users?q=abc&project=id
// Tìm user theo username (gần đúng), loại trừ user đã là member
// ──────────────────────────────────────────────
router.get('/search-users', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const projectId = req.query.project;
    if (!q) return res.json([]);

    // Lấy danh sách user_id đã là member của project (nếu có project)
    let excludeIds = [req.user.id]; // loại chính mình
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

// GET /api/projects — danh sách project của user (owner + member)
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

// POST /api/projects — tạo project mới
router.post('/', auth, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Tên project không được trống' });

    const [result] = await db.query(
      'INSERT INTO projects (name, description, owner_id) VALUES (?,?,?)',
      [name.trim(), description || '', req.user.id]
    );
    const projectId = result.insertId;

    // Tự thêm owner vào member với role = owner
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

// GET /api/projects/:id — chi tiết project
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

// PUT /api/projects/:id — cập nhật project (chỉ owner)
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

// DELETE /api/projects/:id — xóa project (chỉ owner)
router.delete('/:id', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role !== 'owner') return res.status(403).json({ message: 'Chỉ chủ project mới được xóa' });

    // Xóa file vật lý
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

// GET /api/projects/:id/members
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

// POST /api/projects/:id/members — thêm member (chỉ owner)
router.post('/:id/members', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role !== 'owner') return res.status(403).json({ message: 'Chỉ chủ project mới thêm được thành viên' });

    const { username, role } = req.body; // role: 'editor' | 'viewer'
    if (!['editor', 'viewer'].includes(role)) return res.status(400).json({ message: 'Role không hợp lệ (editor/viewer)' });

    // Tìm user
    const [users] = await db.query('SELECT id, username FROM users WHERE username = ?', [username]);
    if (!users.length) return res.status(404).json({ message: 'Không tìm thấy người dùng' });

    const targetUser = users[0];
    if (targetUser.id === req.user.id) return res.status(400).json({ message: 'Không thể tự thêm chính mình' });

    // Kiểm tra đã là member chưa
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

// PUT /api/projects/:id/members/:memberId — đổi role (chỉ owner)
router.put('/:id/members/:memberId', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member || member.role !== 'owner') return res.status(403).json({ message: 'Không có quyền' });

    const { role } = req.body;
    if (!['editor', 'viewer'].includes(role)) return res.status(400).json({ message: 'Role không hợp lệ' });

    // Không đổi role của owner
    const [[target]] = await db.query('SELECT role FROM project_members WHERE id = ?', [req.params.memberId]);
    if (!target || target.role === 'owner') return res.status(400).json({ message: 'Không thể đổi role của chủ project' });

    await db.query('UPDATE project_members SET role = ? WHERE id = ? AND project_id = ?',
      [role, req.params.memberId, req.params.id]);
    res.json({ message: 'Cập nhật quyền thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật quyền' });
  }
});

// DELETE /api/projects/:id/members/:memberId — xóa member (chỉ owner)
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
// FILES
// ══════════════════════════════════════════════

// GET /api/projects/:id/files
router.get('/:id/files', auth, async (req, res) => {
  try {
    const member = await getMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: 'Không có quyền' });

    const [files] = await db.query(
      `SELECT pf.*, u.username as uploaded_by_name
       FROM project_files pf JOIN users u ON u.id = pf.uploaded_by
       WHERE pf.project_id = ?
       ORDER BY pf.created_at DESC`,
      [req.params.id]
    );
    res.json(files);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách file' });
  }
});

// POST /api/projects/:id/files/upload — upload file (owner + editor)
router.post('/:id/files/upload', auth, async (req, res) => {
  const member = await getMember(req.params.id, req.user.id);
  if (!member || member.role === 'viewer') return res.status(403).json({ message: 'Bạn chỉ có quyền xem' });

  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    try {
      const { filename, originalname, size, mimetype } = req.file;
      await db.query(
        'INSERT INTO project_files (project_id, filename, original_name, file_size, mime_type, uploaded_by) VALUES (?,?,?,?,?,?)',
        [req.params.id, filename, originalname, size, mimetype, req.user.id]
      );
      res.json({ message: 'Upload thành công', filename, original_name: originalname });
    } catch (e) {
      res.status(500).json({ message: 'Lỗi lưu file' });
    }
  });
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

// PUT /api/projects/:id/files/:fileId/rename — đổi tên (owner + editor)
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

// DELETE /api/projects/:id/files/:fileId — xóa file (owner + editor)
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