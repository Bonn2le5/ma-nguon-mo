CREATE DATABASE IF NOT EXISTS cloud_storage;
USE cloud_storage;
select * from users ;
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') DEFAULT 'user',
  quota BIGINT DEFAULT 5368709120,       -- 5GB mặc định
  used_space BIGINT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,        -- tên file lưu trên disk (UUID)
  original_name VARCHAR(255) NOT NULL,   -- tên file gốc hiển thị cho user
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100),
  folder_path VARCHAR(500) DEFAULT '/',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  path VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shares (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_id INT NOT NULL,
  user_id INT NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  allow_upload BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tài khoản admin mặc định
-- username: admin / password: admin123
INSERT IGNORE INTO users (username, email, password, role, quota)
VALUES (
  'admin',
  'admin@cloudstore.com',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'admin',
  107374182400  -- 100GB
);

CREATE TABLE IF NOT EXISTS projects (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255)  NOT NULL,
  description TEXT,
  owner_id    INT           NOT NULL,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Bảng project_members (owner / editor / viewer)
CREATE TABLE IF NOT EXISTS project_members (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  project_id  INT          NOT NULL,
  user_id     INT          NOT NULL,
  role        ENUM('owner','editor','viewer') NOT NULL DEFAULT 'viewer',
  joined_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_member (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id)  ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(id)      ON DELETE CASCADE
);

-- Bảng project_files (file riêng của từng project)
CREATE TABLE IF NOT EXISTS project_files (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  project_id    INT           NOT NULL,
  filename      VARCHAR(255)  NOT NULL,   -- tên file trên disk (uuid)
  original_name VARCHAR(255)  NOT NULL,   -- tên hiển thị
  file_size     BIGINT        DEFAULT 0,
  mime_type     VARCHAR(100),
  uploaded_by   INT           NOT NULL,   -- user_id người upload
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id)  REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)    ON DELETE CASCADE
);

-- Index để query nhanh hơn
CREATE INDEX idx_pm_project  ON project_members (project_id);
CREATE INDEX idx_pm_user     ON project_members (user_id);
CREATE INDEX idx_pf_project  ON project_files   (project_id);

-- ── 1. Thêm cột vào bảng files ──
ALTER TABLE files ADD COLUMN is_deleted  TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN deleted_at  DATETIME DEFAULT NULL;
ALTER TABLE files ADD COLUMN is_favorite TINYINT(1) NOT NULL DEFAULT 0;

-- ── 2. Thêm cột vào bảng folders ──
ALTER TABLE folders ADD COLUMN is_favorite TINYINT(1) NOT NULL DEFAULT 0;

-- ── 3. Bảng tags ──
CREATE TABLE IF NOT EXISTS tags (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT         NOT NULL,
  name       VARCHAR(50) NOT NULL,
  color      VARCHAR(20) NOT NULL DEFAULT '#6366f1',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_tag (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. Bảng file_tags ──
CREATE TABLE IF NOT EXISTS file_tags (
  file_id INT NOT NULL,
  tag_id  INT NOT NULL,
  PRIMARY KEY (file_id, tag_id),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. Bảng shared_with_users ──
CREATE TABLE IF NOT EXISTS shared_with_users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  file_id      INT        NOT NULL,
  owner_id     INT        NOT NULL,
  recipient_id INT        NOT NULL,
  can_download TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_share (file_id, recipient_id),
  FOREIGN KEY (file_id)      REFERENCES files(id)  ON DELETE CASCADE,
  FOREIGN KEY (owner_id)     REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 6. Index ──
CREATE INDEX idx_files_deleted   ON files (user_id, is_deleted);
CREATE INDEX idx_files_favorite  ON files (user_id, is_favorite);
CREATE INDEX idx_swu_recipient   ON shared_with_users (recipient_id);

-- =====================================================
-- MIGRATION: Thêm tính năng xác nhận email + reset mật khẩu
-- Chạy file này 1 lần trong MySQL
-- =====================================================

-- 1. Thêm cột email_verified vào bảng users
ALTER TABLE users
  ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0
  AFTER email;

-- Nếu bạn muốn các tài khoản cũ (admin, demo) được đăng nhập luôn
-- không cần verify → chạy dòng này:
UPDATE users 
SET email_verified = 1
WHERE id > 0;
-- 2. Bảng lưu token xác nhận email (đăng ký)
CREATE TABLE IF NOT EXISTS email_verifications (
  id         INT          AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  token      VARCHAR(64)  NOT NULL UNIQUE,
  expires_at DATETIME     NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Bảng lưu token reset mật khẩu (quên mật khẩu)
CREATE TABLE IF NOT EXISTS password_resets (
  id         INT          AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  token      VARCHAR(64)  NOT NULL UNIQUE,
  expires_at DATETIME     NOT NULL,
  used       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE project_files
  ADD COLUMN  is_favorite TINYINT(1) NOT NULL DEFAULT 0;
   SHOW CREATE TABLE projects;
-- 2. Bảng tags riêng cho project (namespace tách biệt với tags cá nhân)
CREATE TABLE project_tags (
   id         INT AUTO_INCREMENT PRIMARY KEY,
   project_id INT NOT NULL,
   name       VARCHAR(64)  NOT NULL,
   color      VARCHAR(16)  NOT NULL DEFAULT '#6366f1',
   UNIQUE KEY uq_project_tag (project_id, name),
   FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
 
-- 3. Bảng quan hệ file ↔ tag trong project
CREATE TABLE IF NOT EXISTS project_file_tags (
   file_id INT NOT NULL,
   tag_id  INT NOT NULL,
   PRIMARY KEY (file_id, tag_id),
   FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
   FOREIGN KEY (tag_id)  REFERENCES project_tags(id)  ON DELETE CASCADE
);
CREATE TABLE project_file_comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  file_id    INT NOT NULL,
  user_id    INT NOT NULL,
  content    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)      ON DELETE CASCADE,
  FOREIGN KEY (file_id)    REFERENCES project_files(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(id)         ON DELETE CASCADE
);
