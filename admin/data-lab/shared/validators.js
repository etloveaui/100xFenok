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

function validateGlobalScouter(metadata, indexData, dashboard) {
  const issues = [];
  const warnings = [];

  if (!metadata) issues.push('필수 필드 누락 (metadata)');
  if (!indexData) issues.push('필수 필드 누락 (stocks_index)');
  if (!dashboard) issues.push('필수 필드 누락 (dashboard)');

  const metaCounts = metadata?.counts || {};
  const metaStocks = metaCounts?.stocks;
  const metaGenerated = metadata?.generated_at;
  const metaSource = metadata?.source_date;

  if (!metaGenerated || !metaSource) issues.push('metadata 필수 필드 누락 (generated_at/source_date)');
  if (typeof metaStocks !== 'number' || metaStocks < 1) issues.push('metadata counts.stocks 이상');

  const indexStocks = indexData?.stocks || {};
  const indexCount = indexData?.count;
  const indexGenerated = indexData?.generated_at;
  const indexSource = indexData?.source_date;

  if (!indexGenerated || !indexSource) issues.push('stocks_index 필수 필드 누락 (generated_at/source_date)');
  if (typeof indexCount !== 'number' || indexCount < 1) issues.push('stocks_index count 이상');
  if (typeof indexStocks !== 'object' || Object.keys(indexStocks).length === 0) {
    issues.push('stocks_index stocks 비어있음');
  }

  const indexKeys = Object.keys(indexStocks || {});
  const actualIndexCount = indexKeys.length;
  if (indexCount && actualIndexCount && indexCount !== actualIndexCount) {
    issues.push(`stocks_index count 불일치: ${indexCount} vs ${actualIndexCount}`);
  }
  if (metaStocks && indexCount && metaStocks !== indexCount) {
    issues.push(`metadata vs index count 불일치: ${metaStocks} vs ${indexCount}`);
  }

  const firstKey = indexKeys[0];
  const first = firstKey ? indexStocks[firstKey] : null;
  const requiredKeys = ['n', 'x', 's', 'c', 'p', 'mc', 'pe', 'pb', 'dy', 'r12'];
  if (!first) {
    issues.push('stocks_index 샘플 티커 없음');
  } else {
    requiredKeys.forEach(key => {
      if (!(key in first)) issues.push(`stocks_index 필수 키 누락: ${key}`);
    });
    const numberKeys = ['p', 'mc', 'pe', 'pb', 'dy', 'r12'];
    numberKeys.forEach(key => {
      if (key in first && typeof first[key] !== 'number') {
        issues.push(`stocks_index 타입 불일치: ${key} (number)`);
      }
    });
    const stringKeys = ['n', 'x', 's', 'c'];
    stringKeys.forEach(key => {
      if (key in first && typeof first[key] !== 'string') {
        issues.push(`stocks_index 타입 불일치: ${key} (string)`);
      }
    });
  }

  const dashSummary = dashboard?.summary || {};
  const dashTotal = dashSummary?.total_stocks;
  const dashGenerated = dashboard?.generated_at;
  const dashSource = dashboard?.source_date;

  if (!dashGenerated || !dashSource) issues.push('dashboard 필수 필드 누락 (generated_at/source_date)');
  if (typeof dashTotal !== 'number' || dashTotal < 1) issues.push('dashboard summary.total_stocks 이상');
  if (metaStocks && dashTotal && metaStocks !== dashTotal) {
    issues.push(`metadata vs dashboard total_stocks 불일치: ${metaStocks} vs ${dashTotal}`);
  }

  if (metadata?.version && metadata.version !== '2.0.0') {
    warnings.push(`metadata version 경고: ${metadata.version}`);
  }
  if (dashboard?.sectors && Object.keys(dashboard.sectors).length === 0) {
    warnings.push('dashboard sectors 비어있음');
  }
  if (dashboard?.countries && Object.keys(dashboard.countries).length === 0) {
    warnings.push('dashboard countries 비어있음');
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    stats: {
      metaCount: metaStocks || 0,
      indexCount: indexCount || 0,
      actualIndexCount,
      dashboardCount: dashTotal || 0,
      sampleTicker: firstKey || '-'
    }
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
