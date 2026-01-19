import { Octokit } from "@octokit/rest";

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
    console.log(`👉 [START] Khách check mã: "${content}"`);

    if (!content) return res.status(400).json({ status: 'error', message: 'Thiếu mã giao dịch' });

    try {
        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        
        // --- 2. ĐỌC KHO HÀNG ---
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
            return res.status(500).json({ status: 'error', message: 'Lỗi kho hàng' });
        }

        // --- 3. CHECK ĐÃ MUA (Bỏ qua dấu cách, ký tự lạ) ---
        // Hàm làm sạch chuỗi: Chỉ giữ lại CHỮ và SỐ, viết hoa hết
        const cleanStr = (str) => str ? str.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
        const cleanInput = cleanStr(content);
        
        const existing = vpnList.find(k => cleanStr(k.owner_content) === cleanInput);
        
        if (existing) {
            console.log(`✅ Mã ${content} đã mua -> Trả lại key cũ.`);
            return res.status(200).json({
                status: 'success', message: 'Đã mua rồi',
                data: {
                    qr_image: existing.qr_image,
                    conf_text: existing.conf,
                    expire: existing.expire_at
                }
            });
        }

        // --- 4. CHECK SEPAY (Dùng fetch native của Node.js 18+) ---
        if (!SEPAY_API_TOKEN) {
            return res.status(500).json({ status: 'error', message: 'Thiếu Token SePay' });
        }

        const isPaid = await checkSePayNative(cleanInput, SEPAY_API_TOKEN);
        
        if (!isPaid) {
            console.log(`⏳ Chưa thấy giao dịch khớp mã: ${cleanInput}`);
            return res.status(200).json({ status: 'pending', message: 'Chưa nhận được tiền' });
        }

        // --- 5. XUẤT KHO ---
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

// Hàm Check SePay KHÔNG DÙNG THƯ VIỆN NGOÀI
async function checkSePayNative(cleanCode, token) {
    try {
        // Dùng fetch có sẵn của Node.js
        const res = await fetch('https://my.sepay.vn/userapi/transactions/list?limit=50', {
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

        // Log giao dịch mới nhất để debug (Xem trong Vercel Logs)
        if (transactions.length > 0) {
            console.log(`🔎 GD mới nhất SePay: "${transactions[0].transaction_content}"`);
        }

        // Tìm giao dịch khớp (Logic: Nội dung chuyển khoản CHỨA mã code)
        const matching = transactions.find(t => {
            if (!t.transaction_content) return false;
            // Làm sạch nội dung từ ngân hàng (Xóa dấu cách, ký tự lạ)
            const bankContentClean = t.transaction_content.toUpperCase().replace(/[^A-Z0-9]/g, '');
            return bankContentClean.includes(cleanCode);
        });

        if (matching) {
            console.log(`✅ KHỚP GIAO DỊCH: ${matching.transaction_content}`);
            return true;
        }
        return false;
    } catch (e) {
        console.error("Lỗi checkSePayNative:", e);
        return false;
    }
}
