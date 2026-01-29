// api/upload.js - Vercel Serverless Function (Đã sửa lỗi đường dẫn)
export default async function handler(req, res) {
  // Chỉ cho phép POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    // 1. AUTH CHECK - Kiểm tra đăng nhập
    const hasAuthCookie = req.headers.cookie && (
      req.headers.cookie.includes('admin_token') || 
      req.headers.cookie.includes('auth')
    );
    
    if (!hasAuthCookie) {
      console.log('⚠️ No auth cookie found');
      return res.status(401).json({ 
        error: 'Chưa đăng nhập hoặc phiên đã hết hạn',
        code: 'NO_AUTH_COOKIE'
      });
    }

    // 2. VALIDATE INPUT
    const VALID_TYPES = ['ipa', 'dylib', 'conf', 'cert', 'mod', 'sign'];
    if (!type || !data || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ (Invalid type or data)' });
    }

    // GitHub Config
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    
    // === FIX QUAN TRỌNG: QUY HOẠCH VỀ MỘT ĐƯỜNG DẪN DUY NHẤT ===
    // Tất cả file json sẽ nằm ở public/data/ để App đọc được
    const FILE_PATH = `public/data/${type}.json`;

    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'Server chưa cấu hình GITHUB_TOKEN' });
    }

    console.log(`🚀 Bắt đầu upload: ${type} -> ${FILE_PATH}`);

    // 3. LẤY DỮ LIỆU CŨ TỪ GITHUB
    const fileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const headers = {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json' // Quan trọng cho PUT request
    };
    
    const getResponse = await fetch(fileUrl, { headers });

    let currentData = [];
    let sha = null;

    if (getResponse.ok) {
      const fileData = await getResponse.json();
      sha = fileData.sha;
      try {
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        currentData = JSON.parse(content);
        // Đảm bảo dữ liệu luôn là mảng
        if (!Array.isArray(currentData)) currentData = [];
      } catch (e) {
        console.warn('⚠️ File json cũ bị lỗi format, sẽ tạo mới mảng rỗng.');
        currentData = [];
      }
    } else if (getResponse.status === 404) {
      console.log('✨ File chưa tồn tại, sẽ tạo mới...');
    } else {
      const errorText = await getResponse.text();
      console.error('❌ GitHub GET error:', errorText);
      return res.status(500).json({ 
        error: 'Lỗi khi lấy dữ liệu từ GitHub', 
        details: errorText 
      });
    }

    // 4. THÊM DATA MỚI VÀO ĐẦU MẢNG
    currentData.unshift(data);

    // 5. UPLOAD (PUT) LẠI LÊN GITHUB
    const newContent = Buffer.from(JSON.stringify(currentData, null, 2)).toString('base64');
    
    // Tạo commit message dễ đọc
    const commitName = data.name || data.title || data.filename || 'Untitled Item'; 
    
    const updatePayload = {
      message: `Update ${type}: ${commitName}`,
      content: newContent,
      branch: 'main'
    };

    if (sha) {
      updatePayload.sha = sha;
    }

    const updateResponse = await fetch(fileUrl, {
      method: 'PUT',
      headers, // Dùng lại headers đã khai báo ở trên
      body: JSON.stringify(updatePayload)
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('❌ GitHub PUT error:', errorText);
      return res.status(500).json({ 
        error: 'Lỗi khi ghi dữ liệu lên GitHub', 
        details: errorText 
      });
    }

    console.log('✅ Upload thành công!');
    return res.status(200).json({ 
      success: true, 
      message: 'Upload successful',
      path: FILE_PATH, // Trả về đường dẫn để debug
      id: data.id 
    });

  } catch (error) {
    console.error('💥 Server Error:', error);
    return res.status(500).json({ 
      error: 'Lỗi Server nội bộ', 
      details: error.message 
    });
  }
}
