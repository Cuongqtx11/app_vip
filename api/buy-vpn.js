import { Octokit } from "@octokit/rest";
import fetch from 'node-fetch'; // Dùng thư viện gốc của bạn

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

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { content, plan_days } = req.body; 

    // Hàm làm sạch chuỗi: Viết hoa + Xóa hết dấu cách/ký tự lạ (chỉ giữ Chữ và Số)
    // Ví dụ: "VPN Code 123" -> "VPNCODE123"
    const cleanStr = (str) => str ? str.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    
    const cleanContent = cleanStr(content);
    console.log(`👉 [START] Khách check mã: "${content}" -> Đã lọc: "${cleanContent}"`);

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
            console.error("❌ Lỗi đọc GitHub (Check Token/Repo):", e.message);
            return res.status(500).json({ status: 'error', message: 'Lỗi kho hàng GitHub' });
        }

        // --- 3. CHECK ĐÃ MUA (Chống trùng lặp thông minh) ---
        // So sánh mã đã làm sạch để tìm lại key cũ nếu khách lỡ tắt tab
        const existing = vpnList.find(k => cleanStr(k.owner_content) === cleanContent);
        
        if (existing) {
            console.log(`✅ Mã ${cleanContent} đã mua -> Trả lại key cũ.`);
            return res.status(200).json({
                status: 'success', message: 'Đã mua rồi',
                data: {
                    qr_image: existing.qr_image,
                    conf_text: existing.conf,
                    expire: existing.expire_at
                }
            });
        }

        // --- 4. CHECK SEPAY (Kiểm tra tiền) ---
        if (!SEPAY_API_TOKEN) {
            return res.status(500).json({ status: 'error', message: 'Thiếu Token SePay' });
        }

        // Gọi SePay
        const sepayRes = await fetch('https://my.sepay.vn/userapi/transactions/list?limit=50', {
            headers: { 
                'Authorization': `Bearer ${SEPAY_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!sepayRes.ok) {
            console.error(`Lỗi SePay API: ${sepayRes.status}`);
            return res.status(200).json({ status: 'pending', message: 'Lỗi kết nối SePay' });
        }

        const sepayData = await sepayRes.json();
        const transactions = sepayData.transactions || [];

        // LOGIC QUAN TRỌNG: Tìm giao dịch khớp mã (Bỏ qua dấu cách)
        const matching = transactions.find(t => {
            if (!t.transaction_content) return false;
            // Làm sạch nội dung ngân hàng gửi về
            const bankContentClean = cleanStr(t.transaction_content);
            // Kiểm tra xem nội dung ngân hàng có CHỨA mã web không
            return bankContentClean.includes(cleanContent);
        });
        
        if (!matching) {
            console.log(`⏳ Chưa thấy giao dịch khớp mã: ${cleanContent}`);
            return res.status(200).json({ status: 'pending', message: 'Chưa nhận được tiền' });
        }

        console.log(`💰 Đã nhận tiền: ${matching.amount_in} - Nội dung: ${matching.transaction_content}`);

        // --- 5. XUẤT KHO VÀ GHI LẠI VÀO GITHUB ---
        const keyIndex = vpnList.findIndex(k => k.status === 'available');
        if (keyIndex === -1) return res.status(500).json({ status: 'error', message: 'Hết hàng tạm thời' });

        const soldKey = vpnList[keyIndex];
        const now = new Date();
        const expireDate = new Date();
        expireDate.setDate(now.getDate() + (parseInt(plan_days) || 30));

        vpnList[keyIndex] = {
            ...soldKey,
            status: 'sold',
            owner_content: content.toUpperCase(),
            sold_at: now.toISOString(),
            expire_at: expireDate.toISOString()
        };

        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER, repo: REPO_NAME, path: DATA_PATH,
            message: `Sold VPN to ${content}`,
            content: Buffer.from(JSON.stringify(vpnList, null, 2)).toString('base64'),
            sha: sha
        });

        return res.status(200).json({
            status: 'success',
            data: {
                qr_image: soldKey.qr_image,
                conf_text: soldKey.conf,
                expire: expireDate.toISOString()
            }
        });

    } catch (error) {
        console.error("❌ Fatal Error:", error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
}
