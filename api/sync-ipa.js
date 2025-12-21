// api/sync-ipa.js - BẢO MẬT URL + AUTO TAG V3 PRO (CHUẨN APP STORE)

export default async function handler(req, res) {
  // CRITICAL: CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🔄 Sync API called:', new Date().toISOString());

  try {
    const { syncHours, botSync } = req.body || {};

    // 🔐 AUTH CHECK
    const cookie = req.headers.cookie || '';
    const hasAuthCookie = 
      cookie.includes('admin_token') || 
      cookie.includes('auth') ||
      botSync === true;
    
    if (!hasAuthCookie) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        code: 'NO_AUTH_COOKIE'
      });
    }

    console.log('✅ Auth passed');

    // 🔒 CONFIGURATION: Sử dụng Environment Variables
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const APPTESTER_URL = process.env.APPTESTER_URL;
    const FILE_PATH = 'public/data/ipa.json';

    // Kiểm tra biến môi trường bắt buộc
    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'Server Error: GITHUB_TOKEN not configured' });
    }
    if (!APPTESTER_URL) {
      return res.status(500).json({ error: 'Server Error: APPTESTER_URL not configured' });
    }

    // 1. Fetch từ AppTesters (URL lấy từ Env)
    console.log('📦 Fetching from Source...');
    const response = await fetch(APPTESTER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Source API returned ${response.status}`);
    }
    
    const jsonData = await response.json();
    const allAppTestersData = jsonData.apps || [];
    console.log(`✅ Found ${allAppTestersData.length} apps`);

    // 2. Filter by time range
    let filteredApps = allAppTestersData;
    let filterText = '';
    
    if (syncHours > 0) {
      const cutoffTime = new Date(Date.now() - syncHours * 60 * 60 * 1000);
      filteredApps = allAppTestersData.filter(app => {
        if (!app.versionDate) return false;
        try {
          const appDate = new Date(app.versionDate);
          return appDate >= cutoffTime;
        } catch {
          return false;
        }
      });
      filterText = `${syncHours}h`;
      console.log(`📅 Apps in last ${syncHours}h: ${filteredApps.length}`);
    } else {
      const today = new Date().toISOString().split('T')[0];
      filteredApps = allAppTestersData.filter(app => {
        return app.versionDate && app.versionDate.startsWith(today);
      });
      filterText = 'Today';
      console.log(`📅 Apps today: ${filteredApps.length}`);
    }

    // 3. Get current data from GitHub
    console.log('📄 Fetching from GitHub...');
    const getFileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    
    let currentData = [];
    let sha = null;

    try {
      const getResponse = await fetch(getFileUrl, {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'KhoAppVIP'
        }
      });

      if (getResponse.ok) {
        const fileData = await getResponse.json();
        sha = fileData.sha;
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        currentData = JSON.parse(content);
        console.log(`✅ Current: ${currentData.length} apps`);
      }
    } catch (githubError) {
      console.error('❌ GitHub error:', githubError.message);
      return res.status(500).json({ 
        error: 'Failed to fetch from GitHub', 
        details: githubError.message 
      });
    }

    // 4. Phân loại apps hiện tại
    const manualApps = currentData.filter(app => app.source === 'manual');
    const existingAutoApps = currentData.filter(app => app.source === 'apptesters');
    const otherApps = currentData.filter(app => !app.source || 
      (app.source !== 'manual' && app.source !== 'apptesters'));
    
    console.log(`✋ Manual: ${manualApps.length} | 🤖 Auto: ${existingAutoApps.length}`);

    // 5. 🎯 LOGIC MỚI: GIỮ TẤT CẢ PHIÊN BẢN
    const newApps = [];
    const skippedApps = [];
    const keptOldVersions = [];

    filteredApps.forEach(app => {
      try {
        const convertedApp = {
          id: `ipa-${app.bundleID || app.name.replace(/\s+/g, '-').toLowerCase()}-${app.version}`,
          type: 'ipa',
          name: app.name,
          icon: app.iconURL || app.icon,
          desc: app.localizedDescription || 'Injected with Premium',
          tags: smartDetectTags(app), // V3 Logic - CHUẨN APP STORE
          badge: smartDetectBadge(app),
          fileLink: app.downloadURL || app.down,
          version: app.version,
          developer: app.developerName || 'khomodvip',
          date: app.versionDate,
          source: 'apptesters',
          bundleID: app.bundleID,
          lastSync: new Date().toISOString()
        };

        // 🔍 Kiểm tra trùng HOÀN TOÀN (tên + bundleID + version)
        const exactDuplicate = existingAutoApps.find(e => 
          e.name === convertedApp.name && 
          e.bundleID === convertedApp.bundleID &&
          e.version === convertedApp.version
        );

        if (exactDuplicate) {
          skippedApps.push(convertedApp);
          console.log(`⏭️ Skip (exact): ${app.name} v${app.version}`);
        } else {
          newApps.push(convertedApp);
          
          const oldVersions = existingAutoApps.filter(e => 
            e.name === convertedApp.name && 
            e.bundleID === convertedApp.bundleID &&
            e.version !== convertedApp.version
          );
          
          if (oldVersions.length > 0) {
            console.log(`📦 New version: ${app.name} v${app.version} (keeping ${oldVersions.length} old version(s))`);
            keptOldVersions.push(...oldVersions);
          } else {
            console.log(`✨ Brand new: ${app.name} v${app.version}`);
          }
        }
      } catch (err) {
        console.error('⚠️ Convert error:', app.name, err.message);
      }
    });

    // 6. 🔄 MERGE: GIỮ TẤT CẢ + THÊM MỚI
    const allAutoApps = [...existingAutoApps, ...newApps];
    
    const uniqueApps = [];
    const seenKeys = new Set();
    
    allAutoApps.forEach(app => {
      const key = `${app.name}|${app.bundleID}|${app.version}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueApps.push(app);
      }
    });
    
    uniqueApps.sort((a, b) => {
      const dateA = new Date(a.date || a.lastSync || 0);
      const dateB = new Date(b.date || b.lastSync || 0);
      return dateB - dateA;
    });

    manualApps.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });

    const mergedData = [...uniqueApps, ...manualApps, ...otherApps];

    // 7. Upload to GitHub
    if (newApps.length > 0) {
      console.log('📤 Uploading...');
      
      const newContent = Buffer.from(JSON.stringify(mergedData, null, 2)).toString('base64');
      
      const updatePayload = {
        message: `Sync: +${newApps.length} new (kept all versions) - Auto Tag V3 Pro`,
        content: newContent,
        branch: 'main'
      };

      if (sha) updatePayload.sha = sha;

      const updateResponse = await fetch(getFileUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'KhoAppVIP'
        },
        body: JSON.stringify(updatePayload)
      });

      if (!updateResponse.ok) {
        throw new Error('Upload failed');
      }

      console.log('✅ Success!');
      
      return res.status(200).json({ 
        success: true,
        message: `Sync thành công: +${newApps.length} mới/phiên bản mới`,
        filterRange: filterText,
        stats: {
          new: newApps.length,
          kept: keptOldVersions.length,
          skipped: skippedApps.length,
          total: mergedData.length
        }
      });
    } else {
      return res.status(200).json({ 
        success: true,
        message: 'Không có app/phiên bản mới',
        filterRange: filterText,
        stats: {
          new: 0,
          kept: keptOldVersions.length,
          skipped: skippedApps.length,
          total: mergedData.length
        }
      });
    }

  } catch (error) {
    console.error('💥 ERROR:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message
    });
  }
}

// ==================== V3 PRO - TAG SYSTEM (CHUẨN APP STORE 100%) ====================

function smartDetectTags(app) {
  const name = (app.name || '').toLowerCase();
  const bundleID = (app.bundleID || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();
  const combined = `${name} ${bundleID} ${desc}`;

  // 🎮 GAMES - Ưu tiên cao nhất
  const gamePatterns = {
    // Mobile Games nổi tiếng
    exact: [
      'minecraft', 'roblox', 'pubg', 'free fire', 'freefire', 'genshin impact', 
      'honkai', 'call of duty', 'cod mobile', 'fifa', 'pes', 'among us',
      'brawl stars', 'clash of clans', 'clash royale', 'gta', 'grand theft auto',
      'asphalt', 'need for speed', 'subway surfers', 'temple run', 'candy crush',
      '8 ball pool', 'shadow fight', 'dragon ball', 'naruto', 'one piece', 'pokemon',
      'geometry dash', 'plants vs zombies', 'angry birds', 'fruit ninja',
      'hill climb racing', 'jetpack joyride', 'cut the rope', 'doodle jump',
      'stumble guys', 'fall guys', 'fortnite', 'apex legends', 'valorant',
      'league of legends', 'dota', 'mobile legends', 'mlbb', 'arena of valor',
      'liên quân', 'lien quan', 'tốc chiến', 'toc chien', 'võ lâm', 'vo lam',
      'gunny', 'audition', 'mu origin', 'blade & soul', 'crossfire', 'counter strike'
    ],
    // Game genres & keywords
    keywords: [
      'game', 'play', 'gaming', 'racing', 'shooter', 'shooting', 'battle',
      'rpg', 'mmorpg', 'moba', 'fps', 'tps', 'strategy', 'arcade', 'puzzle',
      'adventure', 'action', 'simulation', 'casual', 'sports', 'fighting',
      'zombie', 'war', 'survival', 'craft', 'build', 'sandbox', 'multiplayer',
      'online game', 'offline game', 'io game', 'battle royale', 'tower defense',
      'stick', 'warrior', 'hero', 'legend', 'quest', 'dungeon', 'arena'
    ]
  };

  if (gamePatterns.exact.some(k => name.includes(k))) return ['game'];
  if (gamePatterns.keywords.some(k => combined.includes(k))) {
    // Double check không phải app khác
    if (!combined.includes('video game news') && !combined.includes('game guide')) {
      return ['game'];
    }
  }

  // 📱 SOCIAL NETWORKING
  const socialPatterns = {
    exact: [
      'facebook', 'messenger', 'instagram', 'threads', 'whatsapp', 'telegram',
      'twitter', 'x', 'tiktok', 'douyin', 'snapchat', 'reddit', 'discord',
      'zalo', 'viber', 'wechat', 'qq', 'line', 'kakaotalk', 'signal',
      'skype', 'zoom', 'teams', 'google meet', 'facetime', 'imo',
      'linkedin', 'pinterest', 'tumblr', 'vk', 'badoo', 'meetme',
      'tinder', 'bumble', 'hinge', 'okcupid', 'match', 'grindr', 'tantan'
    ],
    keywords: [
      'social', 'chat', 'messaging', 'dating', 'meet people', 'friends',
      'community', 'network', 'connect', 'hẹn hò', 'kết bạn', 'nhắn tin'
    ]
  };

  if (socialPatterns.exact.some(k => name.includes(k))) return ['social'];
  if (bundleID.includes('.social') || bundleID.includes('.messenger')) return ['social'];

  // 📸 PHOTO & VIDEO
  const photoVideoPatterns = {
    exact: [
      'youtube', 'tiktok', 'instagram', 'capcut', 'inshot', 'videoleap',
      'picsart', 'lightroom', 'photoshop', 'vsco', 'snapseed', 'canva',
      'camera', 'b612', 'soda', 'ulike', 'snow', 'foodie', 'epik',
      'faceapp', 'facetune', 'remini', 'prisma', 'prequel', 'meitu',
      'kinemeter', 'vllo', 'videoshop', 'splice', 'quik', 'filmic',
      'procreate', 'adobe premiere', 'final cut', 'davinci',
      'nomo', 'dazz', 'kuji', 'molotov', 'hypic', 'pixlr', 'polarr'
    ],
    keywords: [
      'photo', 'video', 'camera', 'editor', 'editing', 'filter', 'effect',
      'selfie', 'beauty', 'retouch', 'collage', 'sticker', 'frame',
      'film', 'cinema', 'vlog', 'clip', 'movie', 'montage', 'slideshow',
      'photo editor', 'video editor', 'ảnh', 'hình', 'chỉnh sửa'
    ]
  };

  if (photoVideoPatterns.exact.some(k => name.includes(k))) return ['photo & video'];
  if (bundleID.includes('photo') || bundleID.includes('video') || bundleID.includes('camera')) {
    return ['photo & video'];
  }

  // 🎵 MUSIC
  const musicPatterns = {
    exact: [
      'spotify', 'apple music', 'youtube music', 'soundcloud', 'deezer',
      'tidal', 'amazon music', 'pandora', 'shazam', 'musixmatch',
      'zing mp3', 'nhaccuatui', 'nct', 'keeng', 'deezer vietnam',
      'garage band', 'fl studio', 'bandlab', 'groovepad', 'drum pad'
    ],
    keywords: [
      'music', 'audio', 'song', 'playlist', 'streaming', 'radio',
      'podcast', 'mp3', 'player', 'sound', 'beat', 'melody',
      'piano', 'guitar', 'drum', 'dj', 'mixer', 'synthesizer',
      'nhạc', 'âm nhạc', 'bài hát'
    ]
  };

  if (musicPatterns.exact.some(k => name.includes(k))) return ['music'];
  if (bundleID.includes('music') || bundleID.includes('audio')) return ['music'];

  // 🎬 ENTERTAINMENT
  const entertainmentPatterns = {
    exact: [
      'netflix', 'disney+', 'hbo', 'prime video', 'hulu', 'paramount',
      'apple tv', 'peacock', 'crunchyroll', 'funimation', 'viu',
      'fpt play', 'vieon', 'galaxy play', 'tv360', 'vtv go',
      'pops', 'fim+', 'iq', 'wetv', 'viki', 'animax', 'cartoon'
    ],
    keywords: [
      'streaming', 'tv', 'movie', 'film', 'series', 'show', 'drama',
      'anime', 'cartoon', 'entertainment', 'watch', 'video on demand',
      'phim', 'truyền hình', 'giải trí'
    ]
  };

  if (entertainmentPatterns.exact.some(k => name.includes(k))) return ['entertainment'];

  // 📰 NEWS & MAGAZINES
  const newsPatterns = {
    keywords: [
      'news', 'newspaper', 'magazine', 'journal', 'press', 'media',
      'tin tức', 'báo', 'tạp chí', 'vnexpress', 'zing news', 'kenh14',
      'tuoi tre', 'thanh nien', 'dantri', '24h', 'bao moi'
    ]
  };

  if (newsPatterns.keywords.some(k => combined.includes(k))) return ['news'];

  // 🛍️ SHOPPING & FOOD
  const shoppingPatterns = {
    exact: [
      'shopee', 'lazada', 'tiki', 'sendo', 'grab', 'gojek', 'be',
      'now', 'foody', 'baemin', 'loship', 'ahamove', 'fastgo',
      'amazon', 'ebay', 'alibaba', 'etsy', 'shein', 'zalora', 'temu',
      'grab food', 'shopee food', 'now food', 'gofood'
    ],
    keywords: [
      'shopping', 'shop', 'store', 'mall', 'market', 'buy', 'sell',
      'ecommerce', 'delivery', 'food delivery', 'order food',
      'mua sắm', 'đặt hàng', 'giao hàng'
    ]
  };

  if (shoppingPatterns.exact.some(k => name.includes(k))) return ['shopping'];

  // 💰 FINANCE
  const financePatterns = {
    keywords: [
      'bank', 'banking', 'finance', 'payment', 'wallet', 'pay',
      'momo', 'zalopay', 'vnpay', 'viettel money', 'viettelpay',
      'vietcombank', 'techcombank', 'acb', 'tpbank', 'mb bank',
      'crypto', 'bitcoin', 'trading', 'stock', 'invest',
      'ngân hàng', 'tài chính', 'thanh toán', 'ví điện tử'
    ]
  };

  if (financePatterns.keywords.some(k => combined.includes(k))) return ['finance'];

  // 🏃 HEALTH & FITNESS
  const healthPatterns = {
    keywords: [
      'health', 'fitness', 'workout', 'exercise', 'gym', 'yoga',
      'running', 'cycling', 'meditation', 'sleep', 'diet', 'nutrition',
      'calorie', 'step', 'tracker', 'sức khỏe', 'tập luyện'
    ]
  };

  if (healthPatterns.keywords.some(k => combined.includes(k))) return ['health & fitness'];

  // 📚 EDUCATION
  const educationPatterns = {
    keywords: [
      'education', 'learning', 'study', 'course', 'class', 'lesson',
      'duolingo', 'khan academy', 'coursera', 'udemy', 'skillshare',
      'elsa', 'cake', 'busuu', 'babbel', 'quizlet', 'photomath',
      'học', 'giáo dục', 'từ điển', 'dictionary', 'translate', 'dịch'
    ]
  };

  if (educationPatterns.keywords.some(k => combined.includes(k))) return ['education'];

  // 📖 BOOKS & REFERENCE
  const booksPatterns = {
    keywords: [
      'book', 'ebook', 'reader', 'reading', 'library', 'novel',
      'kindle', 'wattpad', 'webtoon', 'manga', 'comic',
      'sách', 'truyện', 'đọc', 'waka', 'pops comic'
    ]
  };

  if (booksPatterns.keywords.some(k => combined.includes(k))) return ['books'];

  // 🚗 NAVIGATION & TRAVEL
  const navigationPatterns = {
    keywords: [
      'map', 'maps', 'navigation', 'gps', 'travel', 'trip',
      'hotel', 'flight', 'booking', 'airbnb', 'agoda',
      'google maps', 'waze', 'grab', 'be', 'uber',
      'bản đồ', 'du lịch', 'đặt phòng'
    ]
  };

  if (navigationPatterns.keywords.some(k => combined.includes(k))) return ['navigation'];

  // 💼 PRODUCTIVITY & BUSINESS
  const productivityPatterns = {
    keywords: [
      'office', 'word', 'excel', 'powerpoint', 'pdf', 'document',
      'note', 'notes', 'notebook', 'todo', 'task', 'calendar',
      'email', 'gmail', 'outlook', 'zoom', 'teams', 'meet',
      'slack', 'notion', 'evernote', 'onenote', 'goodnotes',
      'productivity', 'business', 'work', 'văn phòng'
    ]
  };

  if (productivityPatterns.keywords.some(k => combined.includes(k))) return ['productivity'];

  // 🛠️ UTILITIES
  const utilityPatterns = {
    keywords: [
      'utility', 'tool', 'vpn', 'cleaner', 'battery', 'wifi',
      'file manager', 'scanner', 'qr', 'flashlight', 'calculator',
      'weather', 'clock', 'alarm', 'compass', 'speedtest',
      'adblock', 'browser', 'chrome', 'firefox', 'safari',
      'tiện ích', 'công cụ'
    ]
  };

  if (utilityPatterns.keywords.some(k => combined.includes(k))) return ['utilities'];

  // 🎨 GRAPHICS & DESIGN
  const designPatterns = {
    keywords: [
      'design', 'graphic', 'draw', 'paint', 'sketch', 'illustrator',
      'procreate', 'adobe', 'figma', 'canva', 'logo', 'poster',
      'thiết kế', 'vẽ', 'họa'
    ]
  };

  if (designPatterns.keywords.some(k => combined.includes(k))) return ['graphics & design'];

  // 👶 KIDS & FAMILY
  const kidsPatterns = {
    keywords: [
      'kids', 'children', 'baby', 'toddler', 'family', 'parent',
      'cartoon', 'coloring', 'abc', 'learning for kids',
      'trẻ em', 'bé', 'gia đình'
    ]
  };

  if (kidsPatterns.keywords.some(k => combined.includes(k))) return ['kids'];

  // 🏠 LIFESTYLE
  const lifestylePatterns = {
    keywords: [
      'lifestyle', 'home', 'diy', 'recipe', 'cooking', 'food',
      'fashion', 'style', 'beauty', 'makeup', 'salon',
      'lối sống', 'nấu ăn', 'thời trang', 'làm đẹp'
    ]
  };

  if (lifestylePatterns.keywords.some(k => combined.includes(k))) return ['lifestyle'];

  // 🌐 DEVELOPER TOOLS (ít khi có trong IPA consumer)
  if (bundleID.includes('developer') || bundleID.includes('xcode') || 
      combined.includes('coding') || combined.includes('programming')) {
    return ['developer tools'];
  }

  // ⚙️ DEFAULT: UTILITIES (nếu không match gì)
  return ['utilities'];
}

function smartDetectBadge(app) {
  const name = (app.name || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();
  const versionDate = app.versionDate;
  
  // 🆕 NEW BADGE - Apps mới trong 7 ngày
  let isRecent = false;
  if (versionDate) {
    try {
      const appDate = new Date(versionDate);
      const now = new Date();
      const diffDays = Math.ceil((now - appDate) / (1000 * 60 * 60 * 24));
      isRecent = diffDays <= 7;
    } catch (e) {
      isRecent = false;
    }
  }
  
  if (isRecent) return 'new';
  
  // 🔥 TRENDING - Apps hot nhất
  const trendingKeywords = [
    'spotify', 'youtube', 'tiktok', 'instagram', 'facebook', 'threads',
    'whatsapp', 'telegram', 'netflix', 'disney', 'capcut',
    'minecraft', 'roblox', 'genshin', 'honkai', 'pubg', 'free fire',
    'gta', 'call of duty', 'fifa', 'brawl stars'
  ];
  
  if (trendingKeywords.some(keyword => name.includes(keyword))) {
    return Math.random() > 0.5 ? 'trending' : 'top';
  }
  
  // 💎 VIP - Apps Premium/Pro
  const premiumKeywords = [
    'premium', 'pro', 'plus', 'gold', 'vip', 'elite', 'ultimate',
    'unlocked', 'mod', 'hack', 'full', 'paid', 'cracked'
  ];
  
  if (premiumKeywords.some(keyword => desc.includes(keyword) || name.includes(keyword))) {
    return 'vip';
  }
  
  // ⭐ TOP - Random cho apps còn lại (10% chance)
  if (Math.random() > 0.9) {
    return 'top';
  }
  
  return null;
}
