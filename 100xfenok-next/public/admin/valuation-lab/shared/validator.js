/**
 * 데이터 검증 모듈
 *
 * JSON 스키마 검증, 값 범위 체크, null 처리
 *
 * @module validator
 */

const Validator = (function() {

  // 검증 설정
  const SCHEMA = {
    // 필수 필드
    REQUIRED_FIELDS: ['date'],

    // 선택 필드 (하나 이상 있어야 함)
    OPTIONAL_FIELDS: ['best_pe_ratio', 'px_to_book_ratio', 'roe', 'px_last', 'best_eps'],

    // 값 범위
    RANGES: {
      best_pe_ratio: { min: 0, max: 1000 },
      px_to_book_ratio: { min: 0, max: 100 },
      roe: { min: -100, max: 100 },
      px_last: { min: 0, max: 1000000 },
      best_eps: { min: -1000, max: 1000 }
    }
  };

  /**
   * 단일 레코드 검증
   * @param {Object} record - 데이터 레코드
   * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
   */
  function validateRecord(record) {
    const result = { valid: true, errors: [], warnings: [] };

    if (!record || typeof record !== 'object') {
      result.valid = false;
      result.errors.push('Invalid record: not an object');
      return result;
    }

    // 필수 필드 체크
    SCHEMA.REQUIRED_FIELDS.forEach(field => {
      if (!(field in record) || record[field] === null || record[field] === undefined) {
        result.valid = false;
        result.errors.push(`Missing required field: ${field}`);
      }
    });

    // 선택 필드 중 하나 이상 있는지 체크
    const hasOptional = SCHEMA.OPTIONAL_FIELDS.some(field =>
      field in record && record[field] !== null && record[field] !== undefined
    );
    if (!hasOptional) {
      result.warnings.push('No valuation metrics found (PE, PB, ROE)');
    }

    // 값 범위 체크
    Object.keys(SCHEMA.RANGES).forEach(field => {
      if (field in record && record[field] !== null && record[field] !== undefined) {
        const value = record[field];
        const range = SCHEMA.RANGES[field];

        if (typeof value !== 'number' || isNaN(value)) {
          result.warnings.push(`${field}: not a valid number`);
        } else if (value < range.min || value > range.max) {
          result.warnings.push(`${field}: value ${value} out of range [${range.min}, ${range.max}]`);
        }
      }
    });

    return result;
  }

  /**
   * 배열 데이터 검증
   * @param {Array} data - 데이터 배열
   * @returns {Object} { valid: boolean, totalRecords: number, validRecords: number, errors: string[] }
   */
  function validateArray(data) {
    const result = {
      valid: true,
      totalRecords: 0,
      validRecords: 0,
      invalidRecords: 0,
      errors: [],
      warnings: []
    };

    if (!Array.isArray(data)) {
      result.valid = false;
      result.errors.push('Data is not an array');
      return result;
    }

    if (data.length === 0) {
      result.valid = false;
      result.errors.push('Data array is empty');
      return result;
    }

    result.totalRecords = data.length;

    data.forEach((record, index) => {
      const recordResult = validateRecord(record);
      if (recordResult.valid) {
        result.validRecords++;
      } else {
        result.invalidRecords++;
        recordResult.errors.forEach(err => {
          result.errors.push(`Record ${index}: ${err}`);
        });
      }
      recordResult.warnings.forEach(warn => {
        result.warnings.push(`Record ${index}: ${warn}`);
      });
    });

    // 유효 레코드가 80% 미만이면 전체 실패
    if (result.validRecords / result.totalRecords < 0.8) {
      result.valid = false;
      result.errors.push(`Too many invalid records: ${result.invalidRecords}/${result.totalRecords}`);
    }

    return result;
  }

  /**
   * 날짜 형식 검증
   * @param {string} dateStr
   * @returns {boolean}
   */
  function isValidDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return false;
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  }

  /**
   * P/E 값 유효성 체크
   * @param {number} pe
   * @returns {boolean}
   */
  function isValidPE(pe) {
    return pe !== null && pe !== undefined &&
           typeof pe === 'number' && !isNaN(pe) &&
           pe > 0 && pe < 1000;
  }

  /**
   * P/B 값 유효성 체크
   * @param {number} pb
   * @returns {boolean}
   */
  function isValidPB(pb) {
    return pb !== null && pb !== undefined &&
           typeof pb === 'number' && !isNaN(pb) &&
           pb > 0 && pb < 100;
  }

  /**
   * ROE 값 유효성 체크 (음수 허용)
   * @param {number} roe
   * @returns {boolean}
   */
  function isValidROE(roe) {
    return roe !== null && roe !== undefined &&
           typeof roe === 'number' && !isNaN(roe) &&
           roe >= -100 && roe <= 100;
  }

  /**
   * 값 정제 (null/undefined → fallback)
   * @param {any} value
   * @param {any} fallback
   * @returns {any}
   */
  function sanitize(value, fallback = null) {
    if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
      return fallback;
    }
    return value;
  }

  /**
   * 레코드 정제 (모든 필드 sanitize)
   * @param {Object} record
   * @returns {Object}
   */
  function sanitizeRecord(record) {
    if (!record || typeof record !== 'object') return null;

    return {
      date: sanitize(record.date),
      symbol: sanitize(record.symbol),
      ticker: sanitize(record.ticker),
      name: sanitize(record.name),
      px_last: sanitize(record.px_last),
      best_eps: sanitize(record.best_eps),
      best_pe_ratio: sanitize(record.best_pe_ratio),
      px_to_book_ratio: sanitize(record.px_to_book_ratio),
      roe: sanitize(record.roe)
    };
  }

  return {
    validateRecord,
    validateArray,
    isValidDate,
    isValidPE,
    isValidPB,
    isValidROE,
    sanitize,
    sanitizeRecord,
    SCHEMA
  };
})();
