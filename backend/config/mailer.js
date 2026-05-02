const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,  // gmail của bạn
    pass: process.env.MAIL_PASS,  // App Password (không phải mật khẩu thường)
  }
});

// Kiểm tra kết nối lúc khởi động
transporter.verify((err) => {
  if (err) {
    console.error('❌ Mailer lỗi:', err.message);
  } else {
    console.log('✅ Mailer sẵn sàng → ' + process.env.MAIL_USER);
  }
});

module.exports = transporter;