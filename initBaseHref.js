(() => {
  // Treat local hosts, LAN addresses, file:// protocol, and Cloudflare Pages as local (base: /)
  const isLocalHost = /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname);
  const isLocalProtocol = location.protocol === 'file:';
  const isCloudflare = location.hostname.endsWith('pages.dev');
  const isLocal = isLocalHost || isLocalProtocol || isCloudflare;

  const baseHref = isLocal ? '/' : '/100xFenok/';
  window.baseHref = baseHref;
  if (!document.querySelector('base')) {
    document.head.insertAdjacentHTML('afterbegin', `<base href="${baseHref}">`);
  }
})();
