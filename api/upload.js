// api/upload.js - Phiên bản hỗ trợ FILE LỚN (Sử dụng Blob API)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    // 1. AUTH CHECK
    const hasAuthCookie = req.headers.cookie && (
      req.headers.cookie.includes('admin_token') || 
      req.headers.cookie.includes('auth')
    );
    
    if (!hasAuthCookie) {
      return res.status(401).json({ error: 'Chưa đăng nhập', code: 'NO_AUTH_COOKIE' });
    }

    // 2. CONFIG
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';

    if (!GITHUB_TOKEN) return res.status(500).json({ error: 'Thiếu GITHUB_TOKEN' });

    // Xác định đường dẫn file
    let FILE_PATH;
    if (['cert', 'mod', 'sign'].includes(type)) {
        FILE_PATH = `public/pages/data/${type}.json`;
    } else {
        FILE_PATH = `public/data/${type}.json`;
    }

    console.log(`🚀 Bắt đầu xử lý file lớn: ${FILE_PATH}`);

    // headers dùng chung
    const headers = {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Vercel-Serverless-Function'
    };

    // 3. BƯỚC 1: LẤY SHA CỦA FILE HIỆN TẠI (Metadata)
    // API này chỉ lấy thông tin, không lấy nội dung nên rất nhẹ
    const metaUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const metaRes = await fetch(metaUrl, { headers });
    
    let currentData = [];
    let sha = null;

    if (metaRes.ok) {
      const meta = await metaRes.json();
      sha = meta.sha;

      // 4. BƯỚC 2: DÙNG BLOB API ĐỂ TẢI NỘI DUNG (Hỗ trợ tới 100MB)
      // Thay vì lấy content trực tiếp, ta lấy qua SHA blob
      const blobUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs/${sha}`;
      const blobRes = await fetch(blobUrl, { headers });

      if (blobRes.ok) {
        const blobData = await blobRes.json();
        // GitHub Blob trả về base64, cần giải mã
        const rawContent = Buffer.from(blobData.content, 'base64').toString('utf-8');
        
        try {
          currentData = JSON.parse(rawContent);
          if (!Array.isArray(currentData)) throw new Error('Not an array');
        } catch (e) {
          console.error('❌ Lỗi Parse JSON:', e.message);
          // Nếu file lỗi nhưng ta muốn cứu vãn để ghi data mới, có thể để mảng rỗng
          // Nhưng an toàn nhất là báo lỗi để bạn check file tay
           return res.status(500).json({ 
             error: 'File JSON hiện tại bị lỗi cú pháp, không thể đọc.', 
             details: e.message 
           });
        }
      }
    } else if (metaRes.status === 404) {
      console.log('✨ File mới, khởi tạo mảng rỗng');
      currentData = [];
    } else {
       // Lỗi khác
       const err = await metaRes.text();
       return res.status(500).json({ error: 'Lỗi lấy metadata', details: err });
    }

    // 5. THÊM DỮ LIỆU MỚI VÀO ĐẦU
    currentData.unshift(data);

    // 6. GHI LẠI FILE (Upload)
    // Upload vẫn dùng API contents cũ vì nó hỗ trợ ghi đè file lớn tốt
    const newContent = Buffer.from(JSON.stringify(currentData, null, 2)).toString('base64');
    const commitName = data.name || data.title || data.filename || 'Item';

    const updateBody = {
      message: `Update ${type}: ${commitName}`,
      content: newContent,
      branch: 'main'
    };
    if (sha) updateBody.sha = sha;

    const updateRes = await fetch(metaUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updateBody)
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      return res.status(500).json({ error: 'Lỗi khi lưu file', details: errText });
    }

    return res.status(200).json({ 
      success: true, 
      path: FILE_PATH,
      message: 'Đã update thành công vào file lớn!' 
    });

  } catch (error) {
    console.error('💥 Server Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
