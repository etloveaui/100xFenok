export async function loadNav(siteVersion, containerId = 'nav') {
    const res = await fetch(`${window.baseHref}nav.html?v=${siteVersion}`);
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Detect base href
    let baseHref;
    const baseEl = doc.querySelector('base');
    if (baseEl) {
        baseHref = baseEl.getAttribute('href');
    } else {
        const scriptEl = Array.from(doc.scripts).find(s => s.textContent.includes('baseHref'));
        if (scriptEl) {
            const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
            const isPreview = window.location.pathname.includes('/preview/');
            if (isLocal) baseHref = '/';
            else if (isPreview) baseHref = '/100xFenok/preview/';
            else baseHref = '/100xFenok/';
        }
    }

    if (baseHref) {
        let base = document.head.querySelector('base');
        if (!base) {
            base = document.createElement('base');
            document.head.prepend(base);
        }
        base.setAttribute('href', baseHref);

        doc.querySelectorAll('a[data-path]').forEach(a => {
            const path = a.getAttribute('data-path');
            if (path) a.setAttribute('href', baseHref + path);
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
}
