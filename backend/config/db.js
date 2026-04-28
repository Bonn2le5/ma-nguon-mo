const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

// Test kết nối
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Kết nối database thất bại:', err.message);
  } else {
    console.log('✅ Kết nối database thành công!');
    connection.release();
  }
});

module.exports = pool.promise();