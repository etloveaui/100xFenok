/**
 * 보안 모듈 - XSS/CSP 방어
 *
 * innerHTML 대신 안전한 DOM 조작, 입력 검증
 *
 * @module security
 */

const Security = (function() {

  /**
   * HTML 엔티티 이스케이프
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 안전한 텍스트 설정 (XSS 방지)
   * @param {HTMLElement} element
   * @param {string} text
   */
  function setTextSafe(element, text) {
    if (!element) return;
    element.textContent = text;
  }

  /**
   * 안전한 HTML 설정 (신뢰할 수 있는 소스만)
   * innerHTML 대신 사용, 입력은 반드시 이스케이프
   * @param {HTMLElement} element
   * @param {string} html - 이미 이스케이프된 HTML
   */
  function setHtmlSafe(element, html) {
    if (!element) return;
    // 위험한 태그 제거
    const sanitized = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=/gi, 'data-blocked=')
      .replace(/javascript:/gi, 'blocked:');
    element.innerHTML = sanitized;
  }

  /**
   * URL 검증 (안전한 프로토콜만 허용)
   * @param {string} url
   * @returns {boolean}
   */
  function isValidUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url, window.location.origin);
      return ['http:', 'https:', 'data:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * 안전한 링크 생성
   * @param {string} url
   * @param {string} text
   * @returns {HTMLAnchorElement|null}
   */
  function createSafeLink(url, text) {
    if (!isValidUrl(url)) return null;

    const link = document.createElement('a');
    link.href = url;
    link.textContent = text;
    link.rel = 'noopener noreferrer';
    return link;
  }

  /**
   * 숫자 입력 검증
   * @param {any} value
   * @param {Object} options - { min, max, allowNaN, allowNull }
   * @returns {number|null}
   */
  function sanitizeNumber(value, options = {}) {
    const { min = -Infinity, max = Infinity, allowNaN = false, allowNull = true } = options;

    if (value === null || value === undefined) {
      return allowNull ? null : 0;
    }

    const num = Number(value);

    if (isNaN(num)) {
      return allowNaN ? NaN : (allowNull ? null : 0);
    }

    return Math.min(Math.max(num, min), max);
  }

  /**
   * 문자열 입력 검증 (길이 제한)
   * @param {any} value
   * @param {number} maxLength
   * @returns {string}
   */
  function sanitizeString(value, maxLength = 1000) {
    if (value === null || value === undefined) return '';
    return String(value).slice(0, maxLength);
  }

  /**
   * CSP 메타 태그 생성 문자열
   * @returns {string}
   */
  function getCSPMeta() {
    return `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: https:; connect-src 'self' https:;">`;
  }

  /**
   * DOM에서 위험한 요소 제거
   * @param {HTMLElement} container
   */
  function sanitizeDOM(container) {
    if (!container) return;

    // script 태그 제거
    container.querySelectorAll('script').forEach(el => el.remove());

    // 인라인 이벤트 핸들러 제거
    container.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      });
    });
  }

  return {
    escapeHtml,
    setTextSafe,
    setHtmlSafe,
    isValidUrl,
    createSafeLink,
    sanitizeNumber,
    sanitizeString,
    getCSPMeta,
    sanitizeDOM
  };
})();
