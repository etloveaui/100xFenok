const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    console.log('Testing Spinner...');
    await page.goto('http://localhost:8083/index.html');

    // Force show spinner
    await page.evaluate(() => {
        const spinner = document.getElementById('global-spinner');
        if (spinner) spinner.classList.remove('hidden');
    });

    await page.waitForTimeout(500); // Wait for transition
    await page.screenshot({ path: '_verification_screenshots/Spinner_Verification.png' });
    console.log('Saved Spinner_Verification.png');

    await browser.close();
})();
