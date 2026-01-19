import { Octokit } from "@octokit/rest";
import fetch from 'node-fetch'; // Giữ nguyên thư viện node-fetch bạn đang dùng

// CẤU HÌNH
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
const SEPAY_API_TOKEN = process.env.SEPAY_API_TOKEN; 
const REPO_OWNER = "cuongqtx11";
const REPO_NAME = "app_vip";
const DATA_PATH = "public/data/vpn_data.json";

export default async function handler(req, res) {
    // 1. Cấu hình CORS
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

    console.log(`👉 [START] Khách check mã: "${content}"`);

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

        // --- 3. CHECK ĐÃ MUA (Chống trùng lặp thông minh - Bỏ qua dấu cách) ---
        // Chuẩn hóa: Viết hoa hết và xóa sạch dấu cách (VD: "Code 123" -> "CODE123")
        const cleanInput = content.toUpperCase().replace(/\s/g, '');
        
        // Tìm xem mã này đã mua chưa (so sánh sau khi xóa dấu cách)
        const existing = vpnList.find(k => k.owner_content && k.owner_content.toUpperCase().replace(/\s/g, '') === cleanInput);
        
        if (existing) {
            console.log(`✅ Mã ${content} đã mua rồi -> Trả lại key cũ.`);
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

        // --- 4. CHECK SEPAY (Logic Mới: Bỏ qua dấu cách) ---
        if (!SEPAY_API_TOKEN) {
            console.error("❌ Thiếu SEPAY_API_TOKEN");
            return res.status(500).json({ status: 'error', message: 'Lỗi cấu hình Server (Thiếu Token SePay)' });
        }

        // Gọi hàm check thông minh
        const isPaid = await checkSePaySmart(cleanInput, SEPAY_API_TOKEN);
        
        if (!isPaid) {
            console.log(`⏳ Chưa thấy giao dịch khớp với mã: ${cleanInput}`);
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
            owner_content: content.toUpperCase(), // Lưu mã gốc để tra cứu
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

        // Log 3 giao dịch mới nhất để debug
        if (transactions.length > 0) {
            console.log(`🔎 GD mới nhất: "${transactions[0].transaction_content}" - Cần tìm: "${cleanCode}"`);
        }

        // Tìm giao dịch khớp lệnh (Logic quan trọng: xóa dấu cách cả 2 bên)
        const matching = transactions.find(t => {
            if (!t.transaction_content) return false;
            
            // Xóa sạch dấu cách trong nội dung ngân hàng gửi về
            const transContentClean = t.transaction_content.toUpperCase().replace(/\s/g, '');
            
            // Kiểm tra xem nội dung ngân hàng có CHỨA mã code (đã làm sạch) không
            return transContentClean.includes(cleanCode);
        });

        if (matching) {
            console.log(`✅ KHỚP GIAO DỊCH: ${matching.transaction_content}`);
            return true;
        }

        return false;
    } catch (e) {
        console.error("Lỗi checkSePaySmart:", e);
        return false;
    }
}
