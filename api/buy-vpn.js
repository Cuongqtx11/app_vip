import { Octokit } from "@octokit/rest";

// CẤU HÌNH (Lấy từ biến môi trường Vercel cho bảo mật)
// Hãy chắc chắn bạn đã vào Vercel > Settings > Environment Variables để thêm các biến này
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
const SEPAY_API_TOKEN = process.env.SEPAY_API_TOKEN; // Token lấy từ my.sepay.vn
const REPO_OWNER = "cuongqtx11";
const REPO_NAME = "app_vip";
const DATA_PATH = "public/data/vpn_data.json";

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { content, plan_days } = req.body; // content là mã giao dịch (VD: X82KA)

    if (!content) return res.status(400).json({ status: 'error', message: 'Thiếu mã giao dịch' });

    try {
        // =========================================================
        // BƯỚC 1: KIỂM TRA KHO HÀNG TRƯỚC (Để xem đã mua chưa)
        // =========================================================
        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        
        // Lấy dữ liệu vpn_data.json từ GitHub
        let fileData, sha, vpnList;
        try {
            const { data } = await octokit.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: DATA_PATH,
            });
            fileData = data;
            sha = data.sha;
            const jsonContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
            vpnList = JSON.parse(jsonContent);
        } catch (e) {
            return res.status(500).json({ status: 'error', message: 'Lỗi đọc kho hàng GitHub' });
        }

        // --- CHECK TRÙNG LẶP (IDEMPOTENCY) ---
        // Nếu mã giao dịch này (content) đã có key trong hệ thống -> Trả lại key đó luôn
        const existingPurchase = vpnList.find(k => k.owner_content && k.owner_content.toUpperCase() === content.toUpperCase());
        
        if (existingPurchase) {
            return res.status(200).json({
                status: 'success',
                message: 'Đã mua rồi, trả lại key cũ',
                data: {
                    qr_image: existingPurchase.qr_image,
                    conf_text: existingPurchase.conf,
                    expire: existingPurchase.expire_at
                }
            });
        }

        // =========================================================
        // BƯỚC 2: KIỂM TRA TIỀN VỀ (SEPAY)
        // =========================================================
        // Chỉ check tiền nếu chưa mua
        const isPaid = await checkSePayPayment(content, SEPAY_API_TOKEN);
        
        if (!isPaid) {
            return res.status(200).json({ status: 'pending', message: 'Chưa nhận được tiền' });
        }

        // =========================================================
        // BƯỚC 3: XUẤT KHO & GHI NHẬN GIAO DỊCH
        // =========================================================
        
        // Tìm key còn trống (available)
        const keyIndex = vpnList.findIndex(k => k.status === 'available');

        if (keyIndex === -1) {
            return res.status(500).json({ status: 'error', message: 'Kho hết hàng tạm thời, vui lòng đợi 2 phút!' });
        }

        const soldKey = vpnList[keyIndex];
        const now = new Date();
        const expireDate = new Date();
        expireDate.setDate(now.getDate() + (parseInt(plan_days) || 30));

        // Cập nhật thông tin người mua vào key
        vpnList[keyIndex] = {
            ...soldKey,
            status: 'sold',
            owner_content: content.toUpperCase(), // Lưu mã giao dịch để check trùng lần sau
            sold_at: now.toISOString(),
            expire_at: expireDate.toISOString()
        };

        // Lưu ngược lại lên GitHub
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: DATA_PATH,
            message: `Sold VPN to ${content}`,
            content: Buffer.from(JSON.stringify(vpnList, null, 2)).toString('base64'),
            sha: sha
        });

        // Trả hàng
        return res.status(200).json({
            status: 'success',
            data: {
                qr_image: soldKey.qr_image,
                conf_text: soldKey.conf,
                expire: expireDate.toISOString()
            }
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
}

// Hàm check SePay (Tương tự check-order.js cũ của bạn)
async function checkSePayPayment(contentCode, token) {
    try {
        const sepayUrl = `https://my.sepay.vn/userapi/transactions/list?limit=50`;
        const res = await fetch(sepayUrl, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) return false;
        const data = await res.json();
        
        if (!data.transactions) return false;

        // Tìm giao dịch có chứa nội dung code
        const matching = data.transactions.find(t => 
            t.transaction_content.toUpperCase().includes(contentCode.toUpperCase())
        );

        return !!matching; // Trả về true nếu tìm thấy
    } catch (e) {
        console.error("SePay Error:", e);
        return false;
    }
}
