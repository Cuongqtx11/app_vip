import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ============================================================
  // 1. UPLOAD / UPDATE FILE (Cập nhật database json)
  // ============================================================
  // Tính năng này phục vụ cho việc cập nhật các file JSON cấu hình từ trang Admin
  if (action === 'upload' && req.method === 'POST') {
    try {
        const { path: FILE_PATH, content: NEW_CONTENT } = req.body;
        const cookie = req.headers.cookie || '';
        
        // Chỉ admin mới có quyền upload file cấu hình
        if (!cookie.includes('admin_token')) return res.status(401).json({ error: 'Unauthorized' });

        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const GITHUB_OWNER = 'Cuongqtx11';
        const GITHUB_REPO = 'app_vip';

        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'Thiếu biến môi trường GITHUB_TOKEN' });

        const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const getRes = await fetch(getUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` }});
        let sha = null;
        if (getRes.ok) {
            const fileData = await getRes.json();
            sha = fileData.sha;
        }

        const updateRes = await fetch(getUrl, {
            method: 'PUT',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: `Admin update: ${FILE_PATH}`, 
                content: Buffer.from(JSON.stringify(NEW_CONTENT, null, 2)).toString('base64'), 
                sha 
            })
        });

        if (!updateRes.ok) throw new Error('Không thể cập nhật file lên GitHub');

        return res.status(200).json({ success: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(400).json({ error: 'Action không hợp lệ hoặc tính năng đã được tách riêng (Sync)' });
}
