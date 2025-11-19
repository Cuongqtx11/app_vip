// api/test-apptester.js - Test API với format đúng

export default async function handler(req, res) {
  try {
    console.log('🧪 Testing AppTesters API...');
    
    const APPTESTER_URL = 'https://repository.apptesters.org/';
    
    const response = await fetch(APPTESTER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      return res.status(500).json({
        error: 'API request failed',
        status: response.status
      });
    }
    
    const jsonData = await response.json();
    
    // Kiểm tra cấu trúc
    if (!jsonData.apps || !Array.isArray(jsonData.apps)) {
      return res.status(500).json({
        error: 'Invalid format',
        hasAppsKey: !!jsonData.apps,
        isArray: Array.isArray(jsonData.apps),
        keys: Object.keys(jsonData)
      });
    }
    
    const allApps = jsonData.apps;
    const today = new Date().toISOString().split('T')[0];
    const todayApps = allApps.filter(app => 
      app.versionDate && app.versionDate.startsWith(today)
    );
    
    return res.status(200).json({
      success: true,
      repoName: jsonData.name || 'Unknown',
      totalApps: allApps.length,
      todayApps: todayApps.length,
      today: today,
      sampleApp: allApps[0],
      todaySample: todayApps[0] || null,
      recentApps: allApps.slice(0, 5).map(a => ({
        name: a.name,
        version: a.version,
        date: a.versionDate
      }))
    });
    
  } catch (error) {
    return res.status(500).json({
      error: 'Test failed',
      details: error.message
    });
  }
}
