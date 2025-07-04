(() => {
  const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const isPreview = window.location.pathname.includes('/preview/');
  const baseHref = isLocal ? '/' : isPreview ? '/100xFenok/preview/' : '/100xFenok/';
  window.baseHref = baseHref;
  if (!document.querySelector('base')) {
    document.head.insertAdjacentHTML('afterbegin', `<base href="${baseHref}">`);
  }
})();

