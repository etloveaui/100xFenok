/**
 * SchemaValidator - Generic JSON schema validation
 *
 * Validates data against schema.json definitions.
 * Replaces 40+ hardcoded validator functions with config-driven validation.
 *
 * @module schema-validator
 * @version 1.0.0
 */

const SchemaValidator = (function() {

  /**
   * Validate data against a schema definition
   * @param {Object} data - data to validate
   * @param {Object} schema - schema.json content
   * @returns {Object} { valid, issues, warnings, stats }
   */
  function validate(data, schema) {
    const issues = [];
    const warnings = [];
    const stats = {};

    if (!data) {
      issues.push('Data is null or undefined');
      return { valid: false, issues, warnings, stats };
    }

    if (!schema) {
      warnings.push('No schema provided - skipping validation');
      return { valid: true, issues, warnings, stats };
    }

    // Validate root fields
    if (schema.required_fields) {
      validateRequiredFields(data, schema.required_fields, issues);
    }

    // Validate field types
    if (schema.field_types) {
      validateFieldTypes(data, schema.field_types, issues);
    }

    // Validate files section (if present in schema)
    if (schema.files) {
      stats.declaredFiles = Object.keys(schema.files).length;
    }

    // Validate counts consistency
    if (schema.metadata && data.metadata) {
      validateCountsConsistency(data, schema, issues, stats);
    }

    return {
      valid: issues.length === 0,
      issues: issues,
      warnings: warnings,
      stats: stats
    };
  }

  /**
   * Validate required fields exist
   * @param {Object} data
   * @param {string[]} requiredFields
   * @param {string[]} issues
   */
  function validateRequiredFields(data, requiredFields, issues) {
    requiredFields.forEach(field => {
      const parts = field.split('.');
      let current = data;

      for (const part of parts) {
        if (current === undefined || current === null) {
          issues.push(`Missing required field: ${field}`);
          return;
        }
        current = current[part];
      }

      if (current === undefined || current === null) {
        issues.push(`Missing required field: ${field}`);
      }
    });
  }

  /**
   * Validate field types match schema
   * @param {Object} data
   * @param {Object} fieldTypes - { 'path.to.field': 'type' }
   * @param {string[]} issues
   */
  function validateFieldTypes(data, fieldTypes, issues) {
    Object.entries(fieldTypes).forEach(([path, expectedType]) => {
      const value = getNestedValue(data, path);

      if (value === undefined || value === null) {
        return; // Skip - handled by required fields
      }

      const actualType = getValueType(value);
      if (actualType !== expectedType) {
        issues.push(`Type mismatch at ${path}: expected ${expectedType}, got ${actualType}`);
      }
    });
  }

  /**
   * Validate counts consistency between metadata and actual data
   * @param {Object} data
   * @param {Object} schema
   * @param {string[]} issues
   * @param {Object} stats
   */
  function validateCountsConsistency(data, schema, issues, stats) {
    // Check declared vs actual counts
    if (data.metadata && data.metadata.count !== undefined) {
      const declared = data.metadata.count;
      let actual = 0;

      // Determine what to count based on data structure
      if (Array.isArray(data.data)) {
        actual = data.data.length;
      } else if (data.items && Array.isArray(data.items)) {
        actual = data.items.length;
      } else if (data.records && Array.isArray(data.records)) {
        actual = data.records.length;
      }

      stats.declaredCount = declared;
      stats.actualCount = actual;

      if (declared !== actual && actual > 0) {
        issues.push(`Count mismatch: declared ${declared}, actual ${actual}`);
      }
    }
  }

  /**
   * Get nested value from object using dot notation
   * @param {Object} obj
   * @param {string} path - 'a.b.c'
   * @returns {any}
   */
  function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * Get type of value as string
   * @param {any} value
   * @returns {string}
   */
  function getValueType(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
  }

  /**
   * Validate a single file against its schema
   * @param {string} url - file URL
   * @param {Object} fileSchema - schema definition for this file
   * @returns {Promise<Object>} { valid, data, issues, stats }
   */
  async function validateFile(url, fileSchema) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return {
          valid: false,
          data: null,
          issues: [`HTTP ${response.status}: ${response.statusText}`],
          stats: {}
        };
      }

      const data = await response.json();
      const result = validate(data, fileSchema);

      return {
        valid: result.valid,
        data: data,
        issues: result.issues,
        warnings: result.warnings,
        stats: result.stats
      };
    } catch (error) {
      return {
        valid: false,
        data: null,
        issues: [`Fetch error: ${error.message}`],
        stats: {}
      };
    }
  }

  /**
   * Validate multiple files in parallel
   * @param {Object} filesToValidate - { key: { url, schema }, ... }
   * @returns {Promise<Object>} { key: result, ... }
   */
  async function validateFiles(filesToValidate) {
    const results = {};

    await Promise.all(Object.entries(filesToValidate).map(async ([key, config]) => {
      results[key] = await validateFile(config.url, config.schema);
    }));

    return results;
  }

  /**
   * Quick validation - just check if data exists and has content
   * @param {Object} data
   * @returns {Object} { valid, reason }
   */
  function quickValidate(data) {
    if (!data) {
      return { valid: false, reason: 'No data' };
    }

    if (Array.isArray(data)) {
      return {
        valid: data.length > 0,
        reason: data.length > 0 ? `${data.length} items` : 'Empty array'
      };
    }

    if (typeof data === 'object') {
      const keys = Object.keys(data);
      return {
        valid: keys.length > 0,
        reason: keys.length > 0 ? `${keys.length} keys` : 'Empty object'
      };
    }

    return { valid: true, reason: 'Primitive value' };
  }

  /**
   * Extract sample data for display
   * @param {Object|Array} data
   * @param {number} limit
   * @returns {string}
   */
  function extractSample(data, limit = 3) {
    if (!data) return '-';

    if (Array.isArray(data)) {
      const samples = data.slice(0, limit);
      if (samples[0]?.name) {
        return samples.map(s => s.name).join(', ');
      }
      if (samples[0]?.ticker || samples[0]?.symbol) {
        return samples.map(s => s.ticker || s.symbol).join(', ');
      }
      return `${data.length} items`;
    }

    if (typeof data === 'object') {
      const keys = Object.keys(data).slice(0, limit);
      return keys.join(', ');
    }

    return String(data).substring(0, 50);
  }

  return {
    validate,
    validateFile,
    validateFiles,
    quickValidate,
    extractSample,
    getNestedValue,
    getValueType
  };
})();
