import fetch from 'node-fetch'; // Dùng thư viện có sẵn trong package.json gốc

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

    // Hàm làm sạch chuỗi: Viết hoa + Xóa hết dấu cách/ký tự lạ
    const cleanStr = (str) => str ? str.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    const cleanContent = cleanStr(content);
    
    console.log(`👉 Check mã: "${content}" (Clean: ${cleanContent})`);

    if (!content) return res.status(400).json({ status: 'error', message: 'Thiếu mã giao dịch' });

    try {
        // --- 2. ĐỌC KHO HÀNG (Dùng fetch trực tiếp) ---
        const gitUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
        const gitRes = await fetch(gitUrl, {
            headers: { 
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!gitRes.ok) {
            console.error("Lỗi đọc GitHub:", gitRes.statusText);
            return res.status(500).json({ status: 'error', message: 'Lỗi kho hàng GitHub' });
        }

        const gitData = await gitRes.json();
        const vpnList = JSON.parse(Buffer.from(gitData.content, 'base64').toString('utf-8'));
        const sha = gitData.sha;

        // --- 3. CHECK ĐÃ MUA (Chống trùng lặp) ---
        const existing = vpnList.find(k => cleanStr(k.owner_content) === cleanContent);
        if (existing) {
            return res.status(200).json({
                status: 'success', message: 'Đã mua rồi',
                data: { qr_image: existing.qr_image, conf_text: existing.conf, expire: existing.expire_at }
            });
        }

        // --- 4. CHECK SEPAY ---
        if (!SEPAY_API_TOKEN) return res.status(500).json({ status: 'error', message: 'Thiếu Token SePay' });

        const sepayRes = await fetch('https://my.sepay.vn/userapi/transactions/list?limit=50', {
            headers: { 
                'Authorization': `Bearer ${SEPAY_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!sepayRes.ok) return res.status(200).json({ status: 'pending', message: 'Lỗi kết nối SePay' });

        const sepayData = await sepayRes.json();
        const transactions = sepayData.transactions || [];

        // Tìm giao dịch khớp mã (Bỏ qua dấu cách)
        const matching = transactions.find(t => {
            if (!t.transaction_content) return false;
            return cleanStr(t.transaction_content).includes(cleanContent);
        });
        
        if (!matching) {
            return res.status(200).json({ status: 'pending', message: 'Chưa nhận được tiền' });
        }

        console.log(`💰 Đã nhận tiền: ${matching.amount_in}`);

        // --- 5. XUẤT KHO & GHI LẠI GITHUB (Dùng fetch) ---
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

        // Update file lên GitHub bằng fetch
        const updateRes = await fetch(gitUrl, {
            method: 'PUT',
            headers: { 
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Sold VPN to ${content}`,
                content: Buffer.from(JSON.stringify(vpnList, null, 2)).toString('base64'),
                sha: sha
            })
        });

        if (!updateRes.ok) {
            console.error("Lỗi ghi GitHub:", await updateRes.text());
            return res.status(500).json({ status: 'error', message: 'Lỗi lưu đơn hàng' });
        }

        return res.status(200).json({
            status: 'success',
            data: {
                qr_image: soldKey.qr_image,
                conf_text: soldKey.conf,
                expire: expireDate.toISOString()
            }
        });

    } catch (error) {
        console.error("Fatal Error:", error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
}
