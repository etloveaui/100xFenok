const fs = require('fs');
const assert = require('assert');

// The native route owns stock comparison; the orphan HTML is retired.
const multichartPage = fs.readFileSync('100xfenok-next/src/app/multichart/page.tsx', 'utf8');
assert(multichartPage.includes('MacroChartClient'), 'Native multichart client missing');
assert(multichartPage.includes('initialMode="stock-compare"'), 'Stock comparison mode missing');

// Legacy GitHub Pages SPA root has been retired; content folders remain as
// static sources for the Next/OpenNext application.

// IB calculator page tests
const ibHtml = fs.readFileSync('ib/ib-total-guide-calculator.html', 'utf8');
assert(ibHtml.includes('무한매수법 완전정복'), 'IB header missing');
assert(ibHtml.includes('meta name="description"'), 'IB meta description missing');

// Posts archive page tests
const postsHtml = fs.readFileSync('posts/posts-main.html', 'utf8');
assert(postsHtml.includes('분석 아카이브'), 'Posts header missing');
assert(postsHtml.includes('meta name="description"'), 'Posts meta description missing');

// VR archive page tests
const vrHtml = fs.readFileSync('vr/vr-main.html', 'utf8');
assert(vrHtml.includes('VR 시스템 아카이브'), 'VR header missing');
assert(vrHtml.includes('meta name="description"'), 'VR meta description missing');

console.log('All tests passed!');
