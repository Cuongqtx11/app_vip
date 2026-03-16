export default async function handler(req, res) {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Thiếu link tải' });
  }

  // API Key bí mật được lấy từ Environment Variables của Vercel
  const API_KEY = process.env.LINK4M_API_KEY;
  
  if (!API_KEY) {
    return res.status(500).json({ error: 'Chưa cấu hình API Key trên Server' });
  }
  
  // Tạo link vượt quảng cáo
  const freeLink = `https://link4m.co/st?api=${API_KEY}&url=${encodeURIComponent(url)}`;

  // Chuyển hướng người dùng đến link đó
  res.redirect(302, freeLink);
}
