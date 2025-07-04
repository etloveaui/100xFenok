export async function loadNav(siteVersion, containerId = 'nav') {
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
