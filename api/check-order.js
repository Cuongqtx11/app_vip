export default async function handler(req, res) {
    // 1. Chỉ chấp nhận phương thức POST và có nội dung chuyển khoản
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
    const { content } = req.body; // Mã chuyển khoản khách nhập (VD: AH7X91)
    if (!content) return res.status(400).json({ error: 'Thiếu nội dung chuyển khoản' });

    // --- CẤU HÌNH ---
    const SEPAY_API_TOKEN = process.env.SEPAY_API_TOKEN;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO_OWNER = 'cuongqtx11'; // Tên username GitHub của bạn
    const REPO_NAME = 'app_vip';     // Tên Repo của bạn
    const FILE_PATH = 'public/data/keys.json'; // Đường dẫn file lưu key
    // ----------------

    try {
        // BƯỚC 1: HỎI SEPAY XEM CÓ TIỀN CHƯA
        const sepayUrl = `https://my.sepay.vn/userapi/transactions/list?content=${content}&limit=1`;
        const sepayRes = await fetch(sepayUrl, {
            headers: { 'Authorization': `Bearer ${SEPAY_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        const sepayData = await sepayRes.json();

        if (!sepayData.transactions || sepayData.transactions.length === 0) {
            return res.status(200).json({ status: 'pending', message: 'Chưa nhận được tiền' });
        }

        const transaction = sepayData.transactions[0];
        const amount = parseFloat(transaction.amount_in);

        // BƯỚC 2: XÁC ĐỊNH GÓI DỰA TRÊN SỐ TIỀN
        let duration = '';
        let packageName = '';
        
        // Logic so sánh giá tiền (Bạn có thể chỉnh sửa lại cho khớp bảng giá)
        if (amount >= 199000) { duration = '1 Year'; packageName = 'VIP 1 Năm'; }
        else if (amount >= 149000) { duration = '6 Months'; packageName = 'VIP 6 Tháng'; }
        else if (amount >= 39000) { duration = '30 Days'; packageName = 'VIP Tháng'; }
        else if (amount >= 19000) { duration = '7 Days'; packageName = 'VIP Tuần'; }
        else if (amount >= 5000) { duration = '10 Downloads'; packageName = 'Gói Lẻ'; }
        else {
             return res.status(200).json({ status: 'error', message: 'Số tiền không khớp gói nào' });
        }

        // BƯỚC 3: LẤY FILE KEYS.JSON TỪ GITHUB VỀ ĐỂ KIỂM TRA
        const gitUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
        const gitRes = await fetch(gitUrl, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        const gitData = await gitRes.json();
        
        // Giải mã nội dung file từ Base64
        const currentContent = Buffer.from(gitData.content, 'base64').toString('utf-8');
        let keysDB = JSON.parse(currentContent);

        // Kiểm tra xem giao dịch này đã được cấp Key chưa (tránh tạo 2 lần)
        const existingOrder = keysDB.find(k => k.transaction_code === content);
        if (existingOrder) {
            return res.status(200).json({ 
                status: 'success', 
                key: existingOrder.key, 
                package: existingOrder.package 
            });
        }

        // BƯỚC 4: TẠO KEY MỚI VÀ LƯU LẠI
        const newKey = `VIP-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        const newOrder = {
            transaction_code: content,
            amount: amount,
            package: packageName,
            duration: duration,
            key: newKey,
            created_at: new Date().toISOString()
        };

        // Thêm vào danh sách
        keysDB.push(newOrder);

        // BƯỚC 5: UPDATE FILE LÊN GITHUB (QUAN TRỌNG)
        // Mã hóa ngược lại sang Base64
        const newContentBase64 = Buffer.from(JSON.stringify(keysDB, null, 2)).toString('base64');

        await fetch(gitUrl, {
            method: 'PUT',
            headers: { 
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Auto-generated key for ${content}`,
                content: newContentBase64,
                sha: gitData.sha // Bắt buộc phải có SHA cũ để ghi đè
            })
        });

        // TRẢ VỀ KẾT QUẢ CHO KHÁCH HÀNG
        return res.status(200).json({ 
            status: 'success', 
            key: newKey, 
            package: packageName 
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Lỗi server' });
    }
}
