import fetch from 'node-fetch';
import { kv } from '@vercel/kv';

// Cấu hình URL nguồn (AppTesters hoặc nguồn của bạn)
const SOURCE_URL = 'https://raw.githubusercontent.com/swaggyP36000/TrollStore-IPAs/main/apps.json';

// === HELPER: Làm sạch tên App để tìm kiếm chính xác hơn ===
// Ví dụ: "Spotify++ (Spotilife)" -> "Spotify"
function cleanAppName(name) {
    return name
        .replace(/\+\+/g, '') // Xóa ++
        .replace(/\(.*\)/g, '') // Xóa nội dung trong ngoặc (...)
        .replace(/\[.*\]/g, '') // Xóa nội dung trong ngoặc [...]
        .replace(/v\d+(\.\d+)*/g, '') // Xóa version v1.0
        .replace(/hack|mod|tweak|bypassed|unc0ver|taurine/gi, '') // Xóa các từ khóa mod
        .replace(/[^a-zA-Z0-9\s]/g, ' ') // Xóa ký tự đặc biệt
        .trim();
}

// === HELPER: Phân loại thông minh từ danh mục của Apple ===
function mapCategoryToTag(appleGenre) {
    const genre = appleGenre.toLowerCase();

    // GAME
    if (['games', 'action', 'adventure', 'role playing', 'simulation', 'strategy', 'puzzle', 'arcade', 'racing', 'board'].includes(genre)) {
        return 'game';
    }
    // SOCIAL
    if (['social networking', 'communication', 'lifestyle'].includes(genre)) {
        return 'social';
    }
    // TOOL / UTILITIES
    if (['utilities', 'productivity', 'developer tools', 'business', 'finance', 'navigation', 'reference'].includes(genre)) {
        return 'tool';
    }
    // MEDIA / MUSIC
    if (['music', 'entertainment', 'photo & video', 'photography'].includes(genre)) {
        return 'media'; // Hoặc 'music' tùy bạn
    }
    // EDUCATION / BOOKS
    if (['education', 'books', 'news'].includes(genre)) {
        return 'book';
    }

    return 'app'; // Mặc định
}

// === API: Tìm kiếm thông tin trên Apple App Store ===
async function fetchAppStoreInfo(rawName) {
    const cleanName = cleanAppName(rawName);
    if (!cleanName || cleanName.length < 2) return null;

    try {
        // Gọi iTunes Search API (Miễn phí, không cần Key)
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=software&limit=1`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.resultCount > 0) {
            const app = data.results[0];
            return {
                found: true,
                originalName: app.trackName,
                icon: app.artworkUrl512 || app.artworkUrl100, // Lấy icon nét nhất
                developer: app.artistName,
                desc: app.description, // Mô tả đầy đủ từ App Store
                appleGenre: app.primaryGenreName, // Thể loại gốc (VD: Social Networking)
                smartTag: mapCategoryToTag(app.primaryGenreName) // Thẻ đã phân loại (VD: social)
            };
        }
    } catch (e) {
        console.error(`Lỗi tìm App Store cho ${cleanName}:`, e.message);
    }
    return null;
}

export default async function handler(req, res) {
    // Chỉ cho phép POST để trigger sync
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    try {
        console.log('--- Bắt đầu Sync IPA Smart ---');
        
        // 1. Lấy dữ liệu nguồn
        const response = await fetch(SOURCE_URL);
        const sourceData = await response.json();
        
        // Nguồn AppTesters thường là mảng các object app
        // Cấu trúc nguồn giả định: { apps: [...] } hoặc [...]
        const appsList = Array.isArray(sourceData) ? sourceData : (sourceData.apps || []);

        if (appsList.length === 0) {
            return res.status(400).json({ error: 'Không tìm thấy dữ liệu từ nguồn' });
        }

        // 2. Lấy dữ liệu cũ từ KV (để so sánh tránh spam request Apple)
        let currentDB = await kv.get('ipa_data') || { apps: [] };
        let newCount = 0;
        let updatedCount = 0;

        // Giới hạn số lượng request Apple mỗi lần sync để tránh timeout Vercel (giới hạn 10-15 app mỗi lần chạy)
        // Nếu muốn full, bạn cần chạy cronjob nhiều lần
        const BATCH_LIMIT = 50; 
        let processed = 0;

        const processedApps = await Promise.all(appsList.slice(0, BATCH_LIMIT).map(async (app) => {
            // Kiểm tra app đã tồn tại trong DB chưa
            const existingApp = currentDB.apps.find(a => a.name === app.name);
            
            // Nếu app đã có đủ thông tin Tag/Icon rồi thì giữ nguyên để tiết kiệm thời gian
            if (existingApp && existingApp.tags && existingApp.tags.length > 0 && existingApp.icon) {
                return existingApp; 
            }

            // Nếu là app mới hoặc thiếu thông tin -> Gọi App Store
            // ⚠️ Lưu ý: Việc này sẽ làm chậm quá trình sync, nên cần cân nhắc
            let appStoreData = null;
            if (!existingApp || !existingApp.tags) {
                appStoreData = await fetchAppStoreInfo(app.name);
                updatedCount++;
            }

            const baseApp = {
                id: existingApp ? existingApp.id : `ipa-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                name: app.name,
                version: app.version || existingApp?.version || 'Unknown',
                date: app.date || existingApp?.date || new Date().toISOString().split('T')[0],
                fileLink: app.downloadURL || app.link || existingApp?.fileLink,
                
                // Ưu tiên dữ liệu từ App Store, nếu không có thì dùng dữ liệu nguồn
                icon: appStoreData?.icon || app.icon || existingApp?.icon || 'https://placehold.co/100',
                developer: appStoreData?.developer || app.developer || existingApp?.developer || 'Unknown',
                desc: appStoreData?.desc || app.description || existingApp?.desc || 'No description',
                
                // Tự động gắn thẻ
                tags: appStoreData ? [appStoreData.smartTag] : (existingApp?.tags || ['app']),
                
                // Lưu thêm info gốc để debug nếu cần
                badge: app.badge || existingApp?.badge || (appStoreData ? 'new' : null)
            };

            if (!existingApp) newCount++;
            return baseApp;
        }));

        // 3. Hợp nhất dữ liệu mới và dữ liệu cũ (những app không nằm trong batch xử lý)
        // Logic: Lấy kết quả xử lý + những app cũ không nằm trong danh sách nguồn đợt này (nếu muốn giữ lại)
        // Ở đây mình sẽ thay thế list cũ bằng list mới đã xử lý (cộng với phần còn lại của list nguồn chưa xử lý)
        
        // Phần chưa xử lý từ nguồn (nếu list nguồn dài hơn limit)
        const remainingRaw = appsList.slice(BATCH_LIMIT).map(app => ({
             id: `ipa-raw-${Math.random()}`,
             name: app.name,
             version: app.version,
             icon: app.icon || 'https://placehold.co/100',
             desc: app.description,
             fileLink: app.downloadURL || app.link,
             tags: ['app'], // Tag mặc định cho app chưa xử lý
             date: new Date().toISOString().split('T')[0]
        }));

        const finalApps = [...processedApps, ...remainingRaw];

        // 4. Lưu vào Database
        await kv.set('ipa_data', { apps: finalApps });

        return res.status(200).json({ 
            success: true, 
            stats: {
                total: finalApps.length,
                new: newCount,
                updatedWithAppStore: updatedCount
            }
        });

    } catch (error) {
        console.error('Sync Error:', error);
        return res.status(500).json({ error: 'Sync failed', details: error.message });
    }
}
