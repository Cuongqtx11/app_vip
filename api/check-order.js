// api/check-order.js
export default async function handler(req, res) {
    // Chỉ nhận POST
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { content } = req.body; 
    
    // Nếu không có nội dung check -> Báo lỗi ngay
    if (!content || content.length < 4) {
        return res.status(400).json({ status: 'error', message: 'Mã giao dịch không hợp lệ' });
    }

    const SEPAY_API_TOKEN = process.env.SEPAY_API_TOKEN;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO_OWNER = 'cuongqtx11'; // Username của bạn
    const REPO_NAME = 'app_vip';     // Repo của bạn
    const FILE_PATH = 'public/data/keys.json'; // Đường dẫn file

    try {
        // --- 1. GỌI SEPAY KIỂM TRA GIAO DỊCH ---
        // Lấy 20 giao dịch gần nhất để chắc chắn không bị sót
        const sepayUrl = `https://my.sepay.vn/userapi/transactions/list?limit=20`;
        
        const sepayRes = await fetch(sepayUrl, {
            headers: { 
                'Authorization': `Bearer ${SEPAY_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!sepayRes.ok) {
            throw new Error(`SePay API Error: ${sepayRes.statusText}`);
        }

        const sepayData = await sepayRes.json();
        
        // Kiểm tra kỹ danh sách giao dịch
        if (!sepayData.transactions || sepayData.transactions.length === 0) {
            return res.status(200).json({ status: 'pending', message: 'Chưa có giao dịch nào' });
        }

        // TÌM CHÍNH XÁC GIAO DỊCH (Quan trọng: Phải chứa đúng nội dung code)
        // Convert cả 2 về chữ hoa để so sánh cho chuẩn
        const matchingTrans = sepayData.transactions.find(t => 
            t.transaction_content.toUpperCase().includes(content.toUpperCase())
        );

        // Nếu KHÔNG tìm thấy giao dịch nào khớp code -> Trả về pending (Chưa thanh toán)
        if (!matchingTrans) {
            return res.status(200).json({ status: 'pending', message: 'Chưa tìm thấy tiền' });
        }

        // --- 2. XÁC ĐỊNH GÓI CƯỚC ---
        const amount = parseFloat(matchingTrans.amount_in);
        let duration = '';
        let packageName = '';
        let maxDownloads = 999999; // Mặc định không giới hạn
        let expiryDays = 0;

        if (amount >= 199000) { 
            packageName = 'VIP 1 Năm'; duration = '365 ngày'; expiryDays = 365;
        } else if (amount >= 149000) { 
            packageName = 'VIP 6 Tháng'; duration = '180 ngày'; expiryDays = 180;
        } else if (amount >= 39000) { 
            packageName = 'VIP 1 Tháng'; duration = '30 ngày'; expiryDays = 30;
        } else if (amount >= 19000) { 
            packageName = 'VIP 1 Tuần'; duration = '7 ngày'; expiryDays = 7;
        } else if (amount >= 5000) { 
            packageName = 'Gói Lẻ'; duration = '10 lượt tải'; maxDownloads = 10; expiryDays = 30;
        } else {
            // Số tiền quá nhỏ hoặc không khớp
            return res.status(200).json({ status: 'error', message: 'Số tiền không khớp gói nào' });
        }

        // --- 3. LẤY FILE KEYS.JSON CŨ TỪ GITHUB ---
        const gitUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
        const gitRes = await fetch(gitUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        
        if (!gitRes.ok) throw new Error('Không đọc được file keys.json từ GitHub');
        
        const gitData = await gitRes.json();
        const currentContent = Buffer.from(gitData.content, 'base64').toString('utf-8');
        let keysDB = [];
        try {
            keysDB = JSON.parse(currentContent);
        } catch (e) {
            keysDB = []; // Nếu file rỗng hoặc lỗi thì tạo mảng mới
        }

        // Kiểm tra xem transaction này đã được cấp key chưa (Tránh spam F5 tạo nhiều key)
        const existingKey = keysDB.find(k => k.transaction_code === content || k.transaction_id === matchingTrans.id);
        if (existingKey) {
            return res.status(200).json({ 
                status: 'success', 
                key: existingKey.key, 
                package: existingKey.package 
            });
        }

        // --- 4. TẠO KEY ĐÚNG CHUẨN XXXX-XXXX-XXXX-XXXX ---
        function generateFormattedKey() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const part = () => Array.from({length:4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            return `${part()}-${part()}-${part()}-${part()}`;
        }
        
        const newKey = generateFormattedKey(); // Ví dụ: A1B2-C3D4-E5F6-G7H8

        // Tính ngày hết hạn
        const createdDate = new Date();
        const expiryDate = new Date();
        expiryDate.setDate(createdDate.getDate() + expiryDays);

        // Tạo object key mới (Format chuẩn để web tải dùng được)
        const newOrder = {
            key: newKey,
            package: packageName,
            amount: amount,
            transaction_code: content,      // Mã người dùng nhập (ABC123)
            transaction_id: matchingTrans.id, // ID giao dịch ngân hàng
            duration: duration,
            max_downloads: maxDownloads,
            downloads_used: 0,
            created_at: createdDate.toISOString(),
            expires_at: expiryDate.toISOString(),
            status: "active"
        };

        // Thêm vào danh sách
        keysDB.push(newOrder);

        // --- 5. LƯU LẠI LÊN GITHUB ---
        const newContentBase64 = Buffer.from(JSON.stringify(keysDB, null, 2)).toString('base64');

        await fetch(gitUrl, {
            method: 'PUT',
            headers: { 
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Auto-generated key for ${content} - ${amount}vnd`,
                content: newContentBase64,
                sha: gitData.sha
            })
        });

        // --- 6. TRẢ KẾT QUẢ VỀ CHO KHÁCH ---
        return res.status(200).json({ 
            status: 'success', 
            key: newKey, 
            package: packageName 
        });

    } catch (error) {
        console.error("System Error:", error);
        // Quan trọng: Trả về lỗi 500 để Frontend không báo thành công bậy bạ
        return res.status(500).json({ error: 'Lỗi hệ thống kiểm tra: ' + error.message });
    }
}
