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

console.log('All tests passed!');
