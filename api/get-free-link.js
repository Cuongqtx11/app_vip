export default async function handler(req, res) {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Thiếu link tải' });
  }

  // API Key bí mật chỉ nằm ở phía Server (không bị lộ ra trình duyệt)
  const API_KEY = '691e7751f7bfff4e4434ecd5';
  
  // Tạo link vượt quảng cáo
  const freeLink = `https://link4m.co/st?api=${API_KEY}&url=${encodeURIComponent(url)}`;

  // Chuyển hướng người dùng đến link đó
  res.redirect(302, freeLink);
}
