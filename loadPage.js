import { siteVersion } from './version.js';

export function loadPage(pageUrl) {
  const isExternal = /^(?:[a-z]+:)?\/\//i.test(pageUrl);
  const relative = isExternal
    ? pageUrl
    : pageUrl.replace(window.baseHref, '').replace(/^\.\//, '').replace(/^\//, '');
  const resolved = isExternal ? pageUrl : window.baseHref + relative;
  const fullUrl = `${resolved}?v=${siteVersion}`;
  document.getElementById('content-frame').src = fullUrl;

  const normalize = url => url.replace(window.baseHref, '').replace(/^\.\//, '').replace(/^\//, '');
  const target = normalize(pageUrl);

  document.querySelectorAll('#nav a[data-path]').forEach(a => {
    const isActive = normalize(a.getAttribute('data-path')) === target;
    a.classList.toggle('text-blue-600', isActive);
    a.classList.toggle('font-bold', isActive);
    a.classList.toggle('text-slate-600', !isActive);
    a.classList.toggle('font-medium', !isActive);
  });
}

window.loadPage = loadPage;
