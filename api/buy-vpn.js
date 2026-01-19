import { Octokit } from "@octokit/rest";

// CẤU HÌNH
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
const SEPAY_API_TOKEN = process.env.SEPAY_API_TOKEN; 
const REPO_OWNER = "cuongqtx11";
const REPO_NAME = "app_vip";
const DATA_PATH = "public/data/vpn_data.json";

export default async function handler(req, res) {
    // 1. Cấu hình CORS (Để trình duyệt không chặn)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { content, plan_days } = req.body; 

    // Log đầu vào
    console.log(`👉 [START] Khách check mã: ${content}`);

    if (!content) return res.status(400).json({ status: 'error', message: 'Thiếu mã giao dịch' });

    try {
        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        
        // --- 2. ĐỌC KHO HÀNG TỪ GITHUB ---
        let vpnList, sha;
        try {
            const { data } = await octokit.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: DATA_PATH,
            });
            sha = data.sha;
            vpnList = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
        } catch (e) {
            console.error("❌ Lỗi đọc GitHub:", e.message);
            return res.status(500).json({ status: 'error', message: 'Lỗi hệ thống kho hàng' });
        }

        // --- 3. CHECK ĐÃ MUA (Chống trùng lặp thông minh) ---
        // Chuẩn hóa: Viết hoa hết và xóa sạch dấu cách (VD: "Code 123" -> "CODE123")
        const cleanContent = content.toUpperCase().replace(/\s/g, '');
        
        const existing = vpnList.find(k => k.owner_content && k.owner_content.toUpperCase().replace(/\s/g, '') === cleanContent);
        
        if (existing) {
            console.log(`✅ Khách ${content} đã mua rồi -> Trả lại key cũ.`);
            return res.status(200).json({
                status: 'success',
                message: 'Đã mua rồi',
                data: {
                    qr_image: existing.qr_image,
                    conf_text: existing.conf,
                    expire: existing.expire_at
                }
            });
        }

        // --- 4. CHECK SEPAY (Kiểm tra tiền - Logic Mới) ---
        if (!SEPAY_API_TOKEN) {
            console.error("❌ Thiếu SEPAY_API_TOKEN");
            return res.status(500).json({ status: 'error', message: 'Lỗi cấu hình Server' });
        }

        // Gọi hàm check thông minh
        const isPaid = await checkSePaySmart(cleanContent, SEPAY_API_TOKEN);
        
        if (!isPaid) {
            console.log(`⏳ Chưa thấy tiền cho mã: ${cleanContent}`);
            return res.status(200).json({ status: 'pending', message: 'Chưa nhận được tiền' });
        }

        console.log("💰 Tiền đã về! Đang xuất kho...");

        // --- 5. XUẤT KHO ---
        const keyIndex = vpnList.findIndex(k => k.status === 'available');

        if (keyIndex === -1) {
            console.error("❌ KHO HẾT HÀNG THỰC SỰ!");
            return res.status(500).json({ status: 'error', message: 'Kho đang tạm hết, vui lòng nhắn Admin!' });
        }

        const soldKey = vpnList[keyIndex];
        const now = new Date();
        const expireDate = new Date();
        expireDate.setDate(now.getDate() + (parseInt(plan_days) || 30));

        vpnList[keyIndex] = {
            ...soldKey,
            status: 'sold',
            owner_content: content.toUpperCase(), // Lưu mã gốc
            sold_at: now.toISOString(),
            expire_at: expireDate.toISOString()
        };

        // Lưu lại GitHub
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: DATA_PATH,
            message: `Sold VPN to ${content}`,
            content: Buffer.from(JSON.stringify(vpnList, null, 2)).toString('base64'),
            sha: sha
        });

        console.log("✅ Giao dịch hoàn tất!");

        return res.status(200).json({
            status: 'success',
            data: {
                qr_image: soldKey.qr_image,
                conf_text: soldKey.conf,
                expire: expireDate.toISOString()
            }
        });

    } catch (error) {
        console.error("❌ Lỗi Fatal:", error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
}

// --- HÀM CHECK SEPAY THÔNG MINH (BỎ QUA DẤU CÁCH) ---
async function checkSePaySmart(cleanCode, token) {
    try {
        // Dùng fetch mặc định của Node 18+ (Không cần import)
        const res = await fetch(`https://my.sepay.vn/userapi/transactions/list?limit=50`, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            console.error(`Lỗi kết nối SePay: ${res.status}`);
            return false;
        }

        const data = await res.json();
        const transactions = data.transactions || [];

        // Tìm giao dịch khớp lệnh
        const matching = transactions.find(t => {
            if (!t.transaction_content) return false;
            
            // Xóa sạch dấu cách trong nội dung ngân hàng gửi về
            const transContentClean = t.transaction_content.toUpperCase().replace(/\s/g, '');
            
            // Kiểm tra xem nội dung ngân hàng có CHỨA mã code (đã làm sạch) không
            return transContentClean.includes(cleanCode);
        });

        if (matching) {
            console.log(`✅ Tìm thấy GD khớp: ${matching.transaction_content} (${matching.amount_in}đ)`);
            return true;
        }

        return false;
    } catch (e) {
        console.error("Lỗi checkSePaySmart:", e);
        return false;
    }
}
