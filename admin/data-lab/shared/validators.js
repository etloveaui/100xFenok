/**
 * Data Lab 검증 로직 (최소형)
 */

function validateDamodaranErp(data) {
  const issues = [];
  const metadata = data?.metadata || {};
  const countries = data?.countries || {};

  if (!data || !metadata || !countries) issues.push('필수 필드 누락 (metadata/countries)');

  const declared = metadata.country_count;
  const actual = Object.keys(countries).length;
  if (declared && declared !== actual) {
    issues.push(`country_count 불일치: ${declared} vs ${actual}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: { declaredCount: declared || 0, actualCount: actual }
  };
}

function validateDamodaranEvSales(data) {
  const issues = [];
  const metadata = data?.metadata || {};
  const sectors = data?.sectors || {};

  if (!data || !metadata || !sectors) issues.push('필수 필드 누락 (metadata/sectors)');

  const declared = metadata.sector_count;
  const actual = Object.keys(sectors).length;
  if (declared && declared !== actual) {
    issues.push(`sector_count 불일치: ${declared} vs ${actual}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: { declaredCount: declared || 0, actualCount: actual }
  };
}

function validateGlobalScouter(data) {
  const issues = [];
  const metadata = data?.metadata || {};
  const stocks = data?.stocks || {};

  if (!data || !metadata || !stocks) issues.push('필수 필드 누락 (metadata/stocks)');

  const declared = metadata.stock_count;
  const actual = Object.keys(stocks).length;
  if (declared && declared !== actual) {
    issues.push(`stock_count 불일치: ${declared} vs ${actual}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: { declaredCount: declared || 0, actualCount: actual }
  };
}

function validateBenchmarkFile(data) {
  const issues = [];
  const metadata = data?.metadata || {};
  const sections = data?.sections || {};

  if (!data || !metadata || !sections) issues.push('필수 필드 누락 (metadata/sections)');

  const sectionCount = Object.keys(sections).length;
  if (sectionCount === 0) issues.push('sections 비어있음');

  return {
    ok: issues.length === 0,
    issues,
    stats: { sectionCount }
  };
}
