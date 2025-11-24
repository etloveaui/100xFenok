const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    console.log('Starting browser...');
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const devices = [
        { name: 'Mobile', width: 375, height: 667 },
        { name: 'Tablet', width: 768, height: 1024 },
        { name: 'Desktop', width: 1920, height: 1080 }
    ];

    const files = [
        'index.html',
        'tools/fed/fed-monitor-widget.html',
        'tools/fed/fed-rates-detail.html',
        'preview/tools/asset/multichart.html'
    ];

    for (const device of devices) {
        const context = await browser.newContext({
            viewport: { width: device.width, height: device.height },
            deviceScaleFactor: 1
        });
        const page = await context.newPage();

        for (const file of files) {
            const url = `http://localhost:8083/${file}`;
            console.log(`Testing ${file} on ${device.name}...`);

            try {
                await page.goto(url, { waitUntil: 'networkidle' });

                // Custom checks
                if (file.includes('widget') && device.name === 'Mobile') {
                    const gridCols = await page.evaluate(() => {
                        const el = document.querySelector('.rates-grid');
                        return getComputedStyle(el).gridTemplateColumns;
                    });
                    console.log(`  [${device.name}] Widget Grid: ${gridCols}`);
                }

                // Toast Verification (only on Desktop index.html for simplicity)
                if (file.includes('index.html') && device.name === 'Desktop') {
                    const footerBtn = await page.$('#footer-share-btn');
                    if (footerBtn) {
                        await footerBtn.click();
                        await page.waitForTimeout(500); // Wait for toast animation
                        await page.screenshot({ path: `_verification_screenshots/Toast_Verification.png` });
                        console.log('  Saved Toast_Verification.png');
                    }

                    // Spinner Verification
                    // Force show spinner to guarantee capture
                    await page.evaluate(() => {
                        const spinner = document.getElementById('global-spinner');
                        if (spinner) spinner.classList.remove('hidden');
                    });
                    await page.waitForTimeout(500); // Wait for transition
                    await page.screenshot({ path: `_verification_screenshots/Spinner_Verification.png` });
                    console.log('  Saved Spinner_Verification.png');
                }

                const screenshotName = `_verification_screenshots/${device.name}_${file.split('/').pop().replace('.html', '')}.png`;
                await page.screenshot({ path: screenshotName, fullPage: true });
                console.log(`  Saved ${screenshotName}`);

            } catch (e) {
                console.error(`  Failed ${file} on ${device.name}:`, e);
            }
        }
        await context.close();
    }

    await browser.close();
})();
