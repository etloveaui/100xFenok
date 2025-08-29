export async function loadNav(siteVersion, containerId = 'nav') {

    // 1. CSS 로딩 완료를 확실히 기다리기
    if (!document.getElementById('global-css-loaded')) {
        const globalCSS = document.createElement('link');
        globalCSS.id = 'global-css-loaded';
        globalCSS.rel = 'stylesheet';
        globalCSS.href = `${window.baseHref}global.css?v=${siteVersion}`;

        // CSS 로딩 완료 대기
        await new Promise((resolve, reject) => {
            globalCSS.onload = resolve;
            globalCSS.onerror = reject;
            document.head.appendChild(globalCSS);
        });
    }



    const res = await fetch(`${window.baseHref}nav.html?v=${siteVersion}`);
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Use global base href computed by the host page
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

    const navContainer = document.getElementById(containerId);
    navContainer.innerHTML = doc.body.innerHTML;
    navContainer.querySelectorAll('script').forEach(oldScript => {
        const script = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => script.setAttribute(attr.name, attr.value));
        script.textContent = oldScript.textContent;
        oldScript.replaceWith(script);
    });

    // ----- Post init tweaks -----
    // 1) Rename menu label "분석" -> "Insights"
    try {
        navContainer.querySelectorAll('a.nav-item, a').forEach(a => {
            const href = (a.getAttribute('href') || '') + (a.getAttribute('data-path') || '');
            const text = (a.textContent || '').trim();
            if (/posts\/posts-main\.html$/.test(href) && text === '분석') {
                a.textContent = 'Insights';
            }
        });
    } catch {}

    // 2) Mobile dropdown fold logic (click to open, outside/ESC to close)
    try {
        const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
        const wrappers = Array.from(navContainer.querySelectorAll('.relative.group'));

        function closeAll() {
            wrappers.forEach(w => {
                w.removeAttribute('data-open');
                const menu = w.querySelector('div.absolute');
                if (menu) { menu.style.opacity = ''; menu.style.visibility = ''; }
            });
        }

        function toggleWrapper(w) {
            const open = w.hasAttribute('data-open');
            closeAll();
            if (!open) {
                w.setAttribute('data-open', '1');
                const menu = w.querySelector('div.absolute');
                if (menu) { menu.style.opacity = '1'; menu.style.visibility = 'visible'; }
            }
        }

        function attach()
        {
            // Button click toggles
            wrappers.forEach(w => {
                const btn = w.querySelector('button.nav-item');
                const menu = w.querySelector('div.absolute');
                if (!btn || !menu) return;
                btn.addEventListener('click', (e) => {
                    if (!isMobile()) return; // desktop unaffected
                    e.preventDefault();
                    e.stopPropagation();
                    toggleWrapper(w);
                });
                // Menu item click closes
                menu.querySelectorAll('a').forEach(link => {
                    link.addEventListener('click', () => { if (isMobile()) closeAll(); });
                });
            });

            // Outside click
            document.addEventListener('click', (e) => {
                if (!isMobile()) return;
                if (!navContainer.contains(e.target)) closeAll();
            });

            // ESC key
            document.addEventListener('keydown', (e) => {
                if (!isMobile()) return;
                if (e.key === 'Escape') closeAll();
            });
        }

        attach();

        // On resize, close all and keep desktop behavior intact
        window.addEventListener('resize', () => { if (!isMobile()) closeAll(); });
    } catch {}
}
