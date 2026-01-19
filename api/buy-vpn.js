import { Octokit } from "@octokit/rest";
import fetch from 'node-fetch'; // [Quan trọng] Import thư viện fetch có sẵn trong package.json

// CẤU HÌNH
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
const SEPAY_API_TOKEN = process.env.SEPAY_API_TOKEN; 
const REPO_OWNER = "cuongqtx11";
const REPO_NAME = "app_vip";
const DATA_PATH = "public/data/vpn_data.json";

export default async function handler(req, res) {
    // Cho phép CORS để tránh lỗi kết nối từ trình duyệt
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { content, plan_days } = req.body; 

    // Log để kiểm tra xem request có tới nơi không
    console.log("👉 Nhận Request Check: ", content);

    if (!content) return res.status(400).json({ status: 'error', message: 'Thiếu mã giao dịch' });

    try {
        // --- 1. KẾT NỐI GITHUB ---
        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        
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
            console.error("❌ Lỗi đọc GitHub:", e.message);
            return res.status(500).json({ status: 'error', message: 'Lỗi đọc kho hàng GitHub' });
        }

        // --- 2. CHECK TRÙNG LẶP (Đã mua chưa?) ---
        const existingPurchase = vpnList.find(k => k.owner_content && k.owner_content.toUpperCase() === content.toUpperCase());
        if (existingPurchase) {
            console.log("✅ Đã mua rồi, trả lại key cũ cho:", content);
            return res.status(200).json({
                status: 'success',
                message: 'Đã mua rồi',
                data: {
                    qr_image: existingPurchase.qr_image,
                    conf_text: existingPurchase.conf,
                    expire: existingPurchase.expire_at
                }
            });
        }

        // --- 3. CHECK SEPAY (Kiểm tra tiền) ---
        // Nếu chưa cấu hình Token thì báo lỗi ngay
        if (!SEPAY_API_TOKEN) {
            console.error("❌ Thiếu SEPAY_API_TOKEN trong Environment Variables");
            return res.status(500).json({ status: 'error', message: 'Lỗi cấu hình Server (Thiếu Token)' });
        }

        const isPaid = await checkSePayPayment(content, SEPAY_API_TOKEN);
        
        if (!isPaid) {
            console.log("⏳ Chưa thấy tiền về cho mã:", content);
            return res.status(200).json({ status: 'pending', message: 'Chưa nhận được tiền' });
        }

        console.log("💰 Đã nhận được tiền! Tiến hành xuất kho...");

        // --- 4. XUẤT KHO ---
        const keyIndex = vpnList.findIndex(k => k.status === 'available');

        if (keyIndex === -1) {
            console.error("❌ KHO HẾT HÀNG!");
            return res.status(500).json({ status: 'error', message: 'Kho hết hàng tạm thời, vui lòng đợi 2 phút!' });
        }

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

        // Lưu GitHub
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: DATA_PATH,
            message: `Sold VPN to ${content}`,
            content: Buffer.from(JSON.stringify(vpnList, null, 2)).toString('base64'),
            sha: sha
        });

        console.log("✅ Giao dịch thành công!");

        return res.status(200).json({
            status: 'success',
            data: {
                qr_image: soldKey.qr_image,
                conf_text: soldKey.conf,
                expire: expireDate.toISOString()
            }
        });

    } catch (error) {
        console.error("❌ Lỗi hệ thống:", error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
}

// Hàm check SePay nâng cao (Có Log)
async function checkSePayPayment(contentCode, token) {
    try {
        const sepayUrl = `https://my.sepay.vn/userapi/transactions/list?limit=50`;
        const res = await fetch(sepayUrl, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            console.error(`❌ Lỗi kết nối SePay: ${res.status} ${res.statusText}`);
            return false;
        }

        const data = await res.json();
        
        // Log dữ liệu giao dịch mới nhất để debug (chỉ log 1 cái đầu tiên cho gọn)
        if (data.transactions && data.transactions.length > 0) {
            console.log(`🔎 Check SePay: Tìm mã '${contentCode}' trong ${data.transactions.length} giao dịch gần nhất.`);
        } else {
            console.log("🔎 Check SePay: Không có giao dịch nào.");
            return false;
        }

        const matching = data.transactions.find(t => 
            t.transaction_content.toUpperCase().includes(contentCode.toUpperCase())
        );

        if (matching) {
            console.log(`✅ TÌM THẤY GIAO DỊCH: ${matching.amount_in} VND - ${matching.transaction_content}`);
            return true;
        }

        return false;
    } catch (e) {
        console.error("❌ Lỗi hàm checkSePayPayment:", e);
        return false;
    }
}
