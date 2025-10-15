export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password } = req.body;
    
    if (password === process.env.ADMIN_PASSWORD) {
      // Tạo session token an toàn
      const token = Buffer.from(`${Date.now()}-${Math.random()}-${process.env.ADMIN_SECRET || 'fallback'}`).toString('base64');
      
      // Set HTTP-only cookie để bảo mật hơn
      res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Path=/; Max-Age=3600; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      
      return res.json({ 
        success: true, 
        message: 'Login successful',
        token: token
      });
    }
    
    return res.status(401).json({ error: 'Invalid password' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
