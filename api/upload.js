// api/upload.js - Bản Fix An Toàn (Critical Fix)
// 1. Khôi phục đúng đường dẫn cho từng loại file.
// 2. THROW ERROR nếu không đọc được data cũ (Ngăn chặn mất dữ liệu).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    // --- AUTH CHECK ---
    const hasAuthCookie = req.headers.cookie && (
      req.headers.cookie.includes('admin_token') || 
      req.headers.cookie.includes('auth')
    );
    
    if (!hasAuthCookie) {
      return res.status(401).json({ 
        error: 'Chưa đăng nhập hoặc phiên hết hạn',
        code: 'NO_AUTH_COOKIE'
      });
    }

    // --- VALIDATE ---
    const VALID_TYPES = ['ipa', 'dylib', 'conf', 'cert', 'mod', 'sign'];
    if (!type || !data || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';

    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'Server thiếu GITHUB_TOKEN' });
    }

    // --- XÁC ĐỊNH ĐƯỜNG DẪN CHUẨN (Theo cấu trúc của bạn) ---
    // Nhóm 1: ipa, dylib, conf -> public/data/
    // Nhóm 2: cert, mod, sign -> public/pages/data/
    let FILE_PATH;
    if (['cert', 'mod', 'sign'].includes(type)) {
        FILE_PATH = `public/pages/data/${type}.json`;
    } else {
        FILE_PATH = `public/data/${type}.json`;
    }

    console.log(`🚀 Uploading ${type} to: ${FILE_PATH}`);

    // --- LẤY DỮ LIỆU CŨ TỪ GITHUB ---
    const fileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const headers = {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    const getResponse = await fetch(fileUrl, { headers });

    let currentData = [];
    let sha = null;

    if (getResponse.ok) {
      const fileData = await getResponse.json();
      sha = fileData.sha;

      // 🛑 KIỂM TRA AN TOÀN: Nếu file có size > 0 mà không có content -> Lỗi API hoặc file quá lớn
      if (!fileData.content && fileData.size > 0) {
          throw new Error('GitHub API không trả về nội dung file (File quá lớn?). Dừng upload để bảo toàn dữ liệu.');
      }

      try {
        // Xử lý content base64 (loại bỏ xuống dòng nếu có)
        const cleanContent = fileData.content ? fileData.content.replace(/\n/g, '') : '';
        const decoded = Buffer.from(cleanContent, 'base64').toString('utf-8');
        
        // Parse JSON
        currentData = JSON.parse(decoded);

        // Kiểm tra xem có phải Array không
        if (!Array.isArray(currentData)) {
            throw new Error('Dữ liệu cũ không phải là mảng (Array).');
        }

      } catch (parseError) {
        // 🛑 CRITICAL: NẾU PARSE LỖI -> DỪNG NGAY. KHÔNG ĐƯỢC GHI ĐÈ.
        console.error('❌ Lỗi đọc dữ liệu cũ:', parseError);
        return res.status(500).json({ 
          error: 'KHÔNG THỂ ĐỌC DỮ LIỆU CŨ. Dừng lại để tránh mất file.',
          details: 'File JSON trên GitHub bị lỗi cú pháp hoặc không đọc được. Vui lòng kiểm tra thủ công.'
        });
      }

    } else if (getResponse.status === 404) {
      console.log('✨ File chưa tồn tại, tạo mới...');
      currentData = []; // Chỉ tạo mới khi chắc chắn 404
    } else {
      const errText = await getResponse.text();
      return res.status(500).json({ error: 'Lỗi kết nối GitHub', details: errText });
    }

    // --- CẬP NHẬT DỮ LIỆU ---
    currentData.unshift(data);

    // --- UPLOAD LẠI ---
    const newContent = Buffer.from(JSON.stringify(currentData, null, 2)).toString('base64');
    const commitName = data.name || data.title || data.filename || 'Item';

    const putBody = {
      message: `Update ${type}: ${commitName}`,
      content: newContent,
      branch: 'main'
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(fileUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      return res.status(500).json({ error: 'Lỗi khi lưu file lên GitHub', details: errText });
    }

    return res.status(200).json({ 
      success: true, 
      path: FILE_PATH,
      message: 'Cập nhật thành công!' 
    });

  } catch (error) {
    console.error('💥 Server Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
