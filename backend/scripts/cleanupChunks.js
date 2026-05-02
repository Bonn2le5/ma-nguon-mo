/**
 * scripts/cleanupChunks.js
 *
 * FIX #5: Dọn thư mục chunk bị bỏ dở (người dùng tắt browser giữa chừng).
 * Nếu session chunk tồn tại hơn TTL_HOURS giờ mà chưa được finalize, xóa luôn.
 *
 * Cách chạy tự động — thêm vào server.js:
 *   require('./scripts/cleanupChunks')();
 *
 * Hoặc chạy thủ công:
 *   node scripts/cleanupChunks.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const CHUNKS_DIR = path.join(__dirname, '../uploads/_chunks');
const TTL_HOURS  = 6;   // Session quá TTL_HOURS giờ → xóa
const TTL_MS     = TTL_HOURS * 60 * 60 * 1000;

function cleanup() {
  if (!fs.existsSync(CHUNKS_DIR)) return;

  const now     = Date.now();
  let   cleaned = 0;
  let   freed   = 0; // bytes

  const entries = fs.readdirSync(CHUNKS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sessionDir = path.join(CHUNKS_DIR, entry.name);
    const metaPath   = path.join(sessionDir, '_meta.json');

    let expired = false;

    // Cách 1: đọc createdAt từ _meta.json (có từ phiên bản fix)
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (now - (meta.createdAt || 0) > TTL_MS) expired = true;
      } catch {
        expired = true; // meta hỏng → cũng xóa
      }
    }

    // Cách 2: fallback dùng mtime của thư mục (cho session cũ không có createdAt)
    if (!expired) {
      try {
        const stat = fs.statSync(sessionDir);
        if (now - stat.mtimeMs > TTL_MS) expired = true;
      } catch {
        expired = true;
      }
    }

    if (expired) {
      try {
        // Tính dung lượng trước khi xóa (để log)
        const files = fs.readdirSync(sessionDir);
        for (const f of files) {
          try { freed += fs.statSync(path.join(sessionDir, f)).size; } catch {}
        }
        fs.rmSync(sessionDir, { recursive: true, force: true });
        cleaned++;
      } catch (err) {
        console.error(`[cleanupChunks] Không xóa được ${entry.name}:`, err.message);
      }
    }
  }

  if (cleaned > 0) {
    const mb = (freed / 1024 / 1024).toFixed(1);
    console.log(`[cleanupChunks] Đã dọn ${cleaned} session hết hạn, giải phóng ~${mb} MB`);
  }
}

/**
 * Khi require() và gọi như hàm, tự chạy lập lịch.
 * Ví dụ trong server.js: require('./scripts/cleanupChunks')();
 */
module.exports = function startCleanupJob(intervalHours = 1) {
  // Chạy ngay 1 lần lúc khởi động, sau đó định kỳ
  cleanup();
  const ms = intervalHours * 60 * 60 * 1000;
  setInterval(cleanup, ms);
  console.log(`[cleanupChunks] Lập lịch dọn chunk mỗi ${intervalHours} giờ (TTL = ${TTL_HOURS}h)`);
};

// Cho phép chạy trực tiếp: node scripts/cleanupChunks.js
if (require.main === module) {
  cleanup();
}
