import { Octokit } from "@octokit/rest";

// Token lấy từ biến môi trường Vercel (Cài đặt trong Settings -> Environment Variables)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
const REPO_OWNER = "cuongqtx11";
const REPO_NAME = "app_vip";
const DATA_PATH = "public/data/vpn_data.json";

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { content, plan_days } = req.body; // content = Nội dung CK

    try {
        // 1. Logic kiểm tra tiền (Bạn tích hợp logic check-order.js của bạn vào đây)
        // Giả lập check thành công để demo
        const isPaid = true; // Thay bằng await checkPaymentStatus(content);

        if (!isPaid) {
            return res.status(200).json({ status: 'pending', message: 'Chưa nhận được tiền' });
        }

        // 2. Kết nối GitHub lấy kho hàng
        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        
        // Lấy file data hiện tại
        let fileData, sha;
        try {
            const { data } = await octokit.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: DATA_PATH,
            });
            fileData = data;
            sha = data.sha;
        } catch (e) {
            return res.status(500).json({ status: 'error', message: 'Kho hàng chưa được khởi tạo!' });
        }

        const jsonContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
        let vpnList = JSON.parse(jsonContent);

        // 3. Tìm key còn trống
        const keyIndex = vpnList.findIndex(k => k.status === 'available');

        if (keyIndex === -1) {
            return res.status(500).json({ status: 'error', message: 'Hết hàng tạm thời, vui lòng thử lại sau 5 phút!' });
        }

        // 4. Cập nhật trạng thái -> ĐÃ BÁN
        const soldKey = vpnList[keyIndex];
        const now = new Date();
        const expireDate = new Date();
        expireDate.setDate(now.getDate() + (parseInt(plan_days) || 30));

        vpnList[keyIndex] = {
            ...soldKey,
            status: 'sold',
            owner_content: content,
            sold_at: now.toISOString(),
            expire_at: expireDate.toISOString()
        };

        // 5. Lưu lại lên GitHub
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: DATA_PATH,
            message: `Sold VPN to ${content}`,
            content: Buffer.from(JSON.stringify(vpnList, null, 2)).toString('base64'),
            sha: sha
        });

        // 6. Trả hàng
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
