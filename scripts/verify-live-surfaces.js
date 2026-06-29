const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    console.log('Launching browser for live visual verification...');
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const viewports = [
        { name: 'desktop_1440', width: 1440, height: 900 },
        { name: 'mobile_390', width: 390, height: 844 }
    ];

    const surfaces = [
        { name: 'explore', path: 'explore' },
        { name: 'market-valuation', path: 'market-valuation' },
        { name: 'market-valuation-structure', path: 'market-valuation/structure' },
        { name: 'sectors', path: 'sectors' },
        { name: 'superinvestors', path: 'superinvestors' },
        { name: 'portfolio', path: 'portfolio' },
        { name: 'etfs', path: 'etfs' },
        { name: 'etfs-new', path: 'etfs/new' },
        { name: 'stock-NVDA', path: 'stock/NVDA' },
        { name: 'regime', path: 'regime' },
        { name: 'macro-chart', path: 'macro-chart' }
    ];

    const outDir = path.resolve(__dirname, '../_verification_screenshots/live');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    for (const vp of viewports) {
        console.log(`\nSetting viewport: ${vp.name} (${vp.width}x${vp.height})`);
        const context = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            deviceScaleFactor: 1
        });
        
        // Force V5 design version cookie on the workers domain
        await context.addCookies([
            {
                name: 'fenok_design_version',
                value: 'v5',
                domain: '100xfenok.etloveaui.workers.dev',
                path: '/'
            }
        ]);

        const page = await context.newPage();

        for (const surf of surfaces) {
            const url = `https://100xfenok.etloveaui.workers.dev/${surf.path}?v5=1`;
            const filename = `${vp.name}_${surf.name}.png`;
            const filepath = path.join(outDir, filename);

            console.log(`-> Capturing ${url}...`);
            try {
                await page.goto(url, { waitUntil: 'networkidle', timeout: 35000 });
                // Allow dynamic client logic, graphs, and transitions to settle
                await page.waitForTimeout(2500);

                await page.screenshot({ path: filepath, fullPage: true });
                console.log(`   [PASS] Saved ${filename}`);
            } catch (e) {
                console.error(`   [FAIL] Could not capture ${surf.name}:`, e.message);
            }
        }
        await context.close();
    }

    await browser.close();
    console.log('\nLive visual verification sweep completed.');
})();
