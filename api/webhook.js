// api/webhook.js
export default async function handler(req, res) {
    // Chỉ chấp nhận method POST từ SePay
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const data = req.body;
        console.log("SePay Data:", data);

        // Lấy thông tin từ Webhook SePay gửi qua
        // data.transferAmount: Số tiền
        // data.content: Nội dung chuyển khoản
        // data.accountNumber: Số tài khoản nhận
        // data.transactionDate: Thời gian giao dịch

        // CẤU HÌNH TELEGRAM
        // Lưu ý: Tốt nhất nên dùng biến môi trường (Environment Variables) trên Vercel
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8239107520:AAFl8V8W5IZNOuWoP63LDuzuFlqtmIf1WFs'; 
        const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID || '5654107862';

        const message = `
🔔 *GIAO DỊCH MỚI!*
-------------------------
💰 Số tiền: ${new Intl.NumberFormat('vi-VN').format(data.transferAmount || 0)} đ
📝 Nội dung: \`${data.content}\`
🏦 Ngân hàng: ${data.gateway}
⏰ Thời gian: ${data.transactionDate}
-------------------------
_Hệ thống SePay Webhook_
        `;

        // Gửi tin nhắn về Telegram
        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        await fetch(telegramUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        // Trả về success cho SePay
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
