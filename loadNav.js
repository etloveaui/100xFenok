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
}
