const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend tĩnh
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve file uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Share page: /s/:token → share.html
app.get('/s/:token', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/share.html'));
});

// ===== ROUTES =====
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/files',   require('./routes/files'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/share',   require('./routes/share'));
app.use('/api/admin',    require('./routes/admin'));
app.use('/api/projects', require('./routes/projects'));

// ===== CATCH-ALL =====
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
    console.log(`🌐 Cloudflare tunnel → http://localhost:${PORT}`);
});