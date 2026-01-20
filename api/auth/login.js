// api/auth/login.js - Đăng nhập an toàn với HMAC Token
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password } = req.body;
    
    // Kiểm tra mật khẩu Admin
    if (password === process.env.ADMIN_PASSWORD) {
      // 🔐 BẢO MẬT: Tạo token bằng cách hash Secret Key
      // Token này không thể bị làm giả nếu không biết ADMIN_SECRET
      const secret = process.env.ADMIN_SECRET || 'mac-dinh-can-thay-doi-trong-env';
      const token = crypto.createHmac('sha256', secret)
                          .update('admin-session')
                          .digest('hex');
      
      // Set Cookie an toàn (HttpOnly, Secure, Strict)
      res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Path=/; Max-Age=3600; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      
      return res.json({ 
        success: true, 
        message: 'Login successful',
        token: token // Trả về để client lưu nếu cần (dù cookie tự động lưu)
      });
    }
    
    return res.status(401).json({ error: 'Invalid password' });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
