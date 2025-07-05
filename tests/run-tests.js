const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('tools/asset/multichart.html', 'utf8');

// Test 1: responsive grid class
assert(html.includes('md:grid-cols-3'), 'Responsive grid class missing');

// Test 2: y-axis tick callback formatting
assert(html.includes('maximumFractionDigits: 2'), 'Tick format limit missing');
assert(html.includes("'$' + fmt") && html.includes("fmt + '%'"), 'Tick format unit missing');

// Test 3: arrow icons in summary table
assert(html.includes('▲') && html.includes('▼'), 'Arrow icons missing');

// Index page tests
const indexHtml = fs.readFileSync('index.html', 'utf8');
assert(indexHtml.includes('<title>100x FenoK</title>'), 'Index title missing');
assert(indexHtml.includes('meta name="description"'), 'Index meta description missing');
assert(indexHtml.includes('<div id="nav">'), 'Nav container missing');
assert(indexHtml.includes('<iframe id="content-frame"'), 'Content frame missing');

// IB calculator page tests
const ibHtml = fs.readFileSync('ib/ib-total-guide-calculator.html', 'utf8');
assert(ibHtml.includes('무한매수법 완전정복'), 'IB header missing');
assert(ibHtml.includes('meta name="description"'), 'IB meta description missing');

// Posts archive page tests
const postsHtml = fs.readFileSync('posts/index.html', 'utf8');
assert(postsHtml.includes('분석 아카이브'), 'Posts header missing');
assert(postsHtml.includes('meta name="description"'), 'Posts meta description missing');

// VR archive page tests
const vrHtml = fs.readFileSync('vr/index.html', 'utf8');
assert(vrHtml.includes('VR 시스템 아카이브'), 'VR header missing');
assert(vrHtml.includes('meta name="description"'), 'VR meta description missing');

console.log('All tests passed!');
