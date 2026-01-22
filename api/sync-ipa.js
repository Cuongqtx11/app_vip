// api/sync-ipa.js
// AUTO SYNC IPA + LARGE FILE FIX + AUTO TAG AI V5 PRO (GAME & SOCIAL CHUẨN APP STORE)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { syncHours, botSync } = req.body || {};

    // ================= AUTH =================
    const cookie = req.headers.cookie || '';
    const hasAuth =
      cookie.includes('admin_token') ||
      cookie.includes('auth') ||
      botSync === true;

    if (!hasAuth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ================= CONFIG =================
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const REPO = process.env.GITHUB_REPO || 'app_vip';
    const APPTESTER_URL = process.env.APPTESTER_URL;
    const FILE_PATH = 'public/data/ipa.json';

    if (!GITHUB_TOKEN || !APPTESTER_URL) {
      return res.status(500).json({ error: 'Missing ENV config' });
    }

    // ================= FETCH SOURCE =================
    const srcRes = await fetch(APPTESTER_URL, {
      headers: { 'User-Agent': 'KhoAppVIP', 'Accept': 'application/json' }
    });
    if (!srcRes.ok) throw new Error('Source fetch failed');

    const srcJson = await srcRes.json();
    const apps = srcJson.apps || [];

    // ================= FILTER =================
    let filtered = apps;
    if (syncHours > 0) {
      const cutoff = Date.now() - syncHours * 3600000;
      filtered = apps.filter(a => {
        try {
          return new Date(a.versionDate).getTime() >= cutoff;
        } catch {
          return false;
        }
      });
    }

    // ================= LOAD GITHUB LARGE FILE =================
    const rawUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${FILE_PATH}`;
    const dirUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/public/data`;

    let currentData = [];
    let sha = null;

    try {
      const [rawRes, dirRes] = await Promise.all([
        fetch(rawUrl),
        fetch(dirUrl, {
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json'
          }
        })
      ]);

      if (rawRes.ok) {
        const txt = await rawRes.text();
        currentData = txt ? JSON.parse(txt) : [];
      }

      if (dirRes.ok) {
        const files = await dirRes.json();
        const node = files.find(f => f.name === 'ipa.json');
        if (node) sha = node.sha;
      }
    } catch {
      currentData = [];
    }

    // ================= SPLIT =================
    const manual = currentData.filter(a => a.source === 'manual');
    const autoOld = currentData.filter(a => a.source === 'apptesters');
    const other = currentData.filter(a => !a.source);

    // ================= CONVERT + TAG =================
    const newApps = [];

    for (const app of filtered) {
      const tag = aiDetectTag(app);

      const item = {
        id: `ipa-${(app.bundleID || app.name).replace(/\s+/g, '-').toLowerCase()}-${app.version}`,
        type: 'ipa',
        name: app.name,
        icon: app.iconURL || app.icon,
        desc: app.localizedDescription || 'Premium unlocked',
        tags: [tag],
        badge: aiDetectBadge(app),
        fileLink: app.downloadURL || app.down,
        version: app.version,
        developer: app.developerName || 'vip',
        date: app.versionDate,
        source: 'apptesters',
        bundleID: app.bundleID,
        lastSync: new Date().toISOString()
      };

      const exists = autoOld.find(e =>
        e.bundleID === item.bundleID &&
        e.version === item.version
      );

      if (!exists) newApps.push(item);
    }

    // ================= MERGE =================
    const merged = [...autoOld, ...newApps]
      .filter((v, i, a) =>
        i === a.findIndex(x =>
          x.bundleID === v.bundleID && x.version === v.version
        )
      )
      .sort((a, b) =>
        new Date(b.date || 0) - new Date(a.date || 0)
      );

    const finalData = [...merged, ...manual, ...other];

    // ================= UPLOAD =================
    if (newApps.length > 0) {
      const content = Buffer.from(
        JSON.stringify(finalData, null, 2)
      ).toString('base64');

      const upRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `Sync +${newApps.length} (AI Tag V5)`,
            content,
            sha,
            branch: 'main'
          })
        }
      );

      if (!upRes.ok) throw new Error('GitHub upload failed');
    }

    return res.json({
      success: true,
      new: newApps.length,
      total: finalData.length
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

/* =====================================================
   AI TAG ENGINE V5 PRO – LOCAL SEMANTIC CLASSIFIER
===================================================== */

function aiDetectTag(app) {
  const name = (app.name || '').toLowerCase();
  const bundle = (app.bundleID || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();
  const text = `${name} ${bundle} ${desc}`;

  // ----------- GLOBAL BLOCK -----------
  const blockGame = ['guide','tips','news','wiki','assistant','tracker','stats'];
  const isHelper = blockGame.some(k => text.includes(k));

  // ----------- GAME (ABSOLUTE PRIORITY) -----------
  const gameBundle = ['.game','.games','unity','unreal','epic'];
  const gameNames = [
    'minecraft','roblox','pubg','free fire','genshin','honkai',
    'gta','fifa','pes','brawl','clash','cod','pokemon',
    'liên quân','lien quan','toc chien','mobile legends','mlbb'
  ];
  const gameKeywords = [
    'game','rpg','moba','fps','battle','arena','shooter',
    'sandbox','survival','craft'
  ];

  if (
    !isHelper &&
    (
      gameBundle.some(k => bundle.includes(k)) ||
      gameNames.some(k => name.includes(k)) ||
      gameKeywords.filter(k => text.includes(k)).length >= 2
    )
  ) return 'game';

  // ----------- SOCIAL -----------
  const social = [
    'facebook','instagram','tiktok','telegram','zalo',
    'discord','messenger','snapchat','threads','twitter'
  ];
  if (social.some(k => bundle.includes(k) || name.includes(k))) {
    return 'social';
  }

  // ----------- PHOTO & VIDEO -----------
  if (
    ['photo','video','editor','filter','camera']
      .some(k => bundle.includes(k) || text.includes(k))
  ) return 'photo & video';

  // ----------- ENTERTAINMENT -----------
  if (['movie','film','tv','anime','series','stream']
    .some(k => text.includes(k))) return 'entertainment';

  // ----------- MUSIC -----------
  if (['music','audio','song','spotify','mp3']
    .some(k => text.includes(k))) return 'music';

  // ----------- SHOPPING -----------
  if (['shop','buy','order','delivery','shopee','lazada']
    .some(k => text.includes(k))) return 'shopping';

  // ----------- PRODUCTIVITY -----------
  if (['pdf','note','document','office','task','calendar']
    .some(k => text.includes(k))) return 'productivity';

  // ----------- DEFAULT -----------
  return 'utilities';
}

/* ================= BADGE AI ================= */

function aiDetectBadge(app) {
  const name = (app.name || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();

  if (app.versionDate) {
    const d = new Date(app.versionDate);
    if (!isNaN(d) && (Date.now() - d.getTime()) / 86400000 <= 7) {
      return 'new';
    }
  }

  if (
    ['facebook','instagram','tiktok','minecraft','roblox','genshin']
      .some(k => name.includes(k))
  ) return 'trending';

  if (
    ['premium','vip','pro','unlocked','mod']
      .some(k => desc.includes(k) || name.includes(k))
  ) return 'vip';

  return null;
}
