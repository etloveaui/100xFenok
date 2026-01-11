/**
 * loadNav.js - Nav V11 Loader
 * - Loads global.css and nav.css
 * - Fetches nav.html and processes data-path attributes
 * - Loads navScript.js for v11 functionality
 */
export async function loadNav(siteVersion, containerId = 'nav') {

    // 1. Load global CSS
    if (!document.getElementById('global-css-loaded')) {
        const globalCSS = document.createElement('link');
        globalCSS.id = 'global-css-loaded';
        globalCSS.rel = 'stylesheet';
        globalCSS.href = `${window.baseHref}global.css?v=${siteVersion}`;

        await new Promise((resolve, reject) => {
            globalCSS.onload = resolve;
            globalCSS.onerror = reject;
            document.head.appendChild(globalCSS);
        });
    }

    // 2. Load nav CSS (v11)
    if (!document.getElementById('nav-css-loaded')) {
        const navCSS = document.createElement('link');
        navCSS.id = 'nav-css-loaded';
        navCSS.rel = 'stylesheet';
        navCSS.href = `${window.baseHref}nav.css?v=${siteVersion}`;

        await new Promise((resolve, reject) => {
            navCSS.onload = resolve;
            navCSS.onerror = reject;
            document.head.appendChild(navCSS);
        });
    }

    // 3. Fetch nav.html
    const res = await fetch(`${window.baseHref}nav.html?v=${siteVersion}`);
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 4. Process data-path attributes with baseHref
    const baseHref = window.baseHref;

    if (baseHref) {
        let base = document.head.querySelector('base');
        if (!base) {
            base = document.createElement('base');
            document.head.prepend(base);
        }
        base.setAttribute('href', baseHref);

        doc.querySelectorAll('a[data-path]').forEach(a => {
            let path = a.getAttribute('data-path');
            if (path) {
                path = path.replace(/^\/+/, '');
                a.setAttribute('data-path', path);
                a.setAttribute('href', baseHref + path);
            }
        });
    }

    // 5. Insert nav HTML into container
    const navContainer = document.getElementById(containerId);
    navContainer.innerHTML = doc.body.innerHTML;

    // 6. Load navScript.js (v11 - handles all nav functionality)
    const navScript = document.createElement('script');
    navScript.src = `${window.baseHref}navScript.js?v=${siteVersion}`;
    navScript.async = false;
    document.body.appendChild(navScript);

    // 7. Wire up SPA navigation for all data-path links
    navContainer.querySelectorAll('[data-path]').forEach(link => {
        link.addEventListener('click', (e) => {
            const path = link.getAttribute('data-path');
            if (path && window.handleNavigation) {
                e.preventDefault();
                window.handleNavigation(path);
            }
        });
    });
}
