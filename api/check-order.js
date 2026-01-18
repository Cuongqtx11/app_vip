// api/check-order.js
export default async function handler(req, res) {
    // 1. Chỉ chấp nhận POST
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { content } = req.body; 
    
    if (!content || content.length < 4) {
        return res.status(400).json({ status: 'error', message: 'Mã giao dịch không hợp lệ' });
    }

    const SEPAY_API_TOKEN = process.env.SEPAY_API_TOKEN;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'cuongqtx11'; 
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const FILE_PATH = 'public/data/keys.json';

    try {
        // --- BƯỚC 1: KIỂM TRA GIAO DỊCH VỚI SEPAY ---
        const sepayUrl = `https://my.sepay.vn/userapi/transactions/list?limit=50`; // Lấy nhiều hơn để chắc chắn
        
        const sepayRes = await fetch(sepayUrl, {
            headers: { 
                'Authorization': `Bearer ${SEPAY_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!sepayRes.ok) throw new Error(`SePay API Error: ${sepayRes.statusText}`);
        const sepayData = await sepayRes.json();
        
        if (!sepayData.transactions || sepayData.transactions.length === 0) {
            return res.status(200).json({ status: 'pending', message: 'Chưa có giao dịch nào' });
        }

        // Tìm giao dịch chứa mã code (content)
        const matchingTrans = sepayData.transactions.find(t => 
            t.transaction_content.toUpperCase().includes(content.toUpperCase())
        );

        if (!matchingTrans) {
            return res.status(200).json({ status: 'pending', message: 'Chưa tìm thấy tiền' });
        }

        // --- BƯỚC 2: CẤU HÌNH GÓI CƯỚC (Logic chuẩn /create [days] [uses]) ---
        const amount = parseFloat(matchingTrans.amount_in);
        let days = 0;   // 0 = Không giới hạn thời gian
        let uses = 0;   // 0 = Không giới hạn lượt dùng
        let packageName = '';

        if (amount >= 199000) { 
            packageName = 'VIP 1 Năm'; days = 365; uses = 0;
        } else if (amount >= 149000) { 
            packageName = 'VIP 6 Tháng'; days = 180; uses = 0;
        } else if (amount >= 39000) { 
            packageName = 'VIP 1 Tháng'; days = 30; uses = 0;
        } else if (amount >= 19000) { 
            packageName = 'VIP 1 Tuần'; days = 7; uses = 0;
        } else if (amount >= 5000) { 
            packageName = 'Gói Lẻ'; days = 0; uses = 10; // Không giới hạn ngày, 10 lượt
        } else {
            return res.status(200).json({ status: 'error', message: 'Số tiền không khớp gói nào' });
        }

        // --- BƯỚC 3: LẤY FILE KEYS TỪ GITHUB ---
        const gitUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const gitRes = await fetch(gitUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        
        if (!gitRes.ok) throw new Error('Không đọc được file keys.json từ GitHub');
        
        const gitData = await gitRes.json();
        const currentContent = Buffer.from(gitData.content, 'base64').toString('utf-8');
        let keysDB = [];
        try { keysDB = JSON.parse(currentContent); } catch (e) { keysDB = []; }

        // Kiểm tra trùng lặp (nếu giao dịch này đã tạo key rồi thì trả lại key cũ)
        const existingKey = keysDB.find(k => k.transaction_code === content || k.transaction_id === matchingTrans.id);
        if (existingKey) {
            return res.status(200).json({ status: 'success', key: existingKey.key, package: existingKey.package });
        }

        // --- BƯỚC 4: TẠO KEY MỚI (ĐÚNG FORMAT CỦA verify.js) ---
        function generateKey() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const part = () => Array.from({length:4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            return `${part()}-${part()}-${part()}-${part()}`; // XXXX-XXXX-XXXX-XXXX
        }
        
        const newKeyStr = generateKey();
        const now = new Date();

        // Tính ngày hết hạn (expiresAt)
        let expiresAt = null;
        if (days > 0) {
            const expiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
            expiresAt = expiryDate.toISOString();
        }

        // Cấu trúc Key chuẩn (CamelCase khớp với file keys.json của bạn)
        const newKeyEntry = {
            id: `key_${Math.floor(Date.now() / 1000)}_${Math.floor(Math.random() * 10000)}`,
            key: newKeyStr,
            createdAt: now.toISOString(),
            expiresAt: expiresAt, // null nếu không giới hạn
            maxUses: uses > 0 ? uses : null, // null nếu không giới hạn
            currentUses: 0,
            active: true,
            createdBy: 'auto_payment',
            transaction_code: content, // Lưu lại để đối chiếu
            transaction_id: matchingTrans.id,
            package: packageName,
            notes: `${days > 0 ? days + ' days' : '∞ days'}, ${uses > 0 ? uses + ' uses' : '∞ uses'}`
        };

        // Thêm key mới vào đầu danh sách
        keysDB.unshift(newKeyEntry);

        // --- BƯỚC 5: LƯU LẠI LÊN GITHUB ---
        const newContentBase64 = Buffer.from(JSON.stringify(keysDB, null, 2)).toString('base64');

        await fetch(gitUrl, {
            method: 'PUT',
            headers: { 
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Auto-generated key: ${newKeyStr} (${packageName})`,
                content: newContentBase64,
                sha: gitData.sha
            })
        });

        // --- BƯỚC 6: TRẢ KẾT QUẢ ---
        return res.status(200).json({ 
            status: 'success', 
            key: newKeyStr, 
            package: packageName 
        });

    } catch (error) {
        console.error("System Error:", error);
        return res.status(500).json({ error: 'Lỗi hệ thống: ' + error.message });
    }
}
