(() => {
  // Treat local hosts, LAN addresses like 192.168.* and file:// protocol as local
  const isLocalHost = /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname);
  const isLocalProtocol = location.protocol === 'file:';
  const isLocal = isLocalHost || isLocalProtocol;

  const isPreview = window.location.pathname.includes('/preview/');
  const baseHref = isLocal ? '/' : isPreview ? '/100xFenok/preview/' : '/100xFenok/';
  window.baseHref = baseHref;
  if (!document.querySelector('base')) {
    document.head.insertAdjacentHTML('afterbegin', `<base href="${baseHref}">`);
  }
})();

