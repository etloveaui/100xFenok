/**
 * 🏝️ Miyako Performance Monitor
 * Tracks and validates performance improvements after refactoring
 *
 * Metrics tracked:
 * - CSS load time and file sizes
 * - JavaScript execution time
 * - DOM complexity and rendering performance
 * - User interaction response times
 */

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      cssMetrics: {},
      jsMetrics: {},
      domMetrics: {},
      interactionMetrics: {},
      coreWebVitals: {}
    };

    this.startTime = performance.now();
    this.init();
  }

  init() {
    // Start monitoring immediately
    this.measureCSSLoad();
    this.measureJSLoad();
    this.measureDOMComplexity();
    this.setupInteractionMonitoring();
    this.measureCoreWebVitals();

    console.log('📊 Miyako Performance Monitor initialized');
  }

  /* ==========================================================================
     📊 CSS Performance Measurement
     ========================================================================== */

  measureCSSLoad() {
    const cssFiles = [
      'miyako-design-system.css',
      'main-optimized.css'
    ];

    cssFiles.forEach(fileName => {
      const link = document.querySelector(`link[href*="${fileName}"]`);
      if (link) {
        const startTime = performance.now();

        link.addEventListener('load', () => {
          const loadTime = performance.now() - startTime;
          this.metrics.cssMetrics[fileName] = {
            loadTime: Math.round(loadTime * 100) / 100,
            timestamp: new Date().toISOString()
          };

          // Fetch file size
          this.fetchFileSize(`./css/${fileName}`, fileName);
        });
      }
    });
  }

  async fetchFileSize(url, fileName) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      const contentLength = response.headers.get('content-length');

      if (contentLength) {
        const sizeKB = Math.round(parseInt(contentLength) / 1024 * 100) / 100;
        this.metrics.cssMetrics[fileName].sizeKB = sizeKB;

        // Check if we met our 68% reduction target (from 63KB to ~20KB)
        if (fileName === 'main-optimized.css') {
          const reductionPercentage = ((63 - sizeKB) / 63 * 100).toFixed(1);
          this.metrics.cssMetrics[fileName].reductionFromOriginal = `${reductionPercentage}%`;

          console.log(`📉 CSS Size: ${sizeKB}KB (${reductionPercentage}% reduction from original 63KB)`);
        }
      }
    } catch (error) {
      console.warn(`Could not fetch file size for ${fileName}:`, error);
    }
  }

  /* ==========================================================================
     ⚡ JavaScript Performance Measurement
     ========================================================================== */

  measureJSLoad() {
    const jsStartTime = performance.now();

    // Measure time to interactive
    document.addEventListener('DOMContentLoaded', () => {
      const domLoadTime = performance.now() - this.startTime;
      this.metrics.jsMetrics.domLoadTime = Math.round(domLoadTime * 100) / 100;
    });

    // Measure when UI components are ready
    if (window.MiyakoUI) {
      const uiReadyTime = performance.now() - this.startTime;
      this.metrics.jsMetrics.uiReadyTime = Math.round(uiReadyTime * 100) / 100;
    }
  }

  /* ==========================================================================
     🏗️ DOM Complexity Analysis
     ========================================================================== */

  measureDOMComplexity() {
    // Count elements before and after refactoring
    const totalElements = document.querySelectorAll('*').length;
    const buttonsWithComplexClasses = document.querySelectorAll('button[class*="inline-flex"]').length;
    const simplifiedButtons = document.querySelectorAll('.btn-primary, .btn-secondary, .btn-ghost').length;

    // Calculate average class length
    const allElements = document.querySelectorAll('[class]');
    let totalClassLength = 0;
    let elementsWithClasses = 0;

    allElements.forEach(el => {
      if (el.className && typeof el.className === 'string') {
        totalClassLength += el.className.length;
        elementsWithClasses++;
      }
    });

    const avgClassLength = elementsWithClasses > 0 ?
      Math.round(totalClassLength / elementsWithClasses * 100) / 100 : 0;

    this.metrics.domMetrics = {
      totalElements,
      simplifiedButtons,
      complexButtons: buttonsWithComplexClasses,
      avgClassLength,
      classLengthReduction: avgClassLength < 50 ? 'GOOD' : 'NEEDS_IMPROVEMENT'
    };

    console.log(`🏗️ DOM Complexity: ${simplifiedButtons} simplified buttons, avg class length: ${avgClassLength} chars`);
  }

  /* ==========================================================================
     🖱️ Interaction Response Time Monitoring
     ========================================================================== */

  setupInteractionMonitoring() {
    // Monitor button click response times
    document.addEventListener('click', (e) => {
      if (e.target.matches('button, .btn-primary, .btn-secondary, .btn-ghost')) {
        const clickTime = performance.now();
        const button = e.target;

        // Measure time to visual feedback
        requestAnimationFrame(() => {
          const responseTime = performance.now() - clickTime;

          if (!this.metrics.interactionMetrics.buttonResponses) {
            this.metrics.interactionMetrics.buttonResponses = [];
          }

          this.metrics.interactionMetrics.buttonResponses.push({
            responseTime: Math.round(responseTime * 100) / 100,
            buttonType: button.className.split(' ')[0],
            timestamp: Date.now()
          });

          // Target: All button responses under 100ms
          if (responseTime > 100) {
            console.warn(`⚠️ Slow button response: ${responseTime}ms (target: <100ms)`);
          }
        });
      }
    });
  }

  /* ==========================================================================
     📈 Core Web Vitals Measurement
     ========================================================================== */

  measureCoreWebVitals() {
    // Largest Contentful Paint (LCP)
    new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];

      this.metrics.coreWebVitals.lcp = {
        value: Math.round(lastEntry.startTime),
        rating: lastEntry.startTime < 2500 ? 'GOOD' : lastEntry.startTime < 4000 ? 'NEEDS_IMPROVEMENT' : 'POOR'
      };
    }).observe({ entryTypes: ['largest-contentful-paint'] });

    // First Input Delay (FID)
    new PerformanceObserver((entryList) => {
      const firstInput = entryList.getEntries()[0];
      if (firstInput) {
        this.metrics.coreWebVitals.fid = {
          value: Math.round(firstInput.processingStart - firstInput.startTime),
          rating: firstInput.processingStart - firstInput.startTime < 100 ? 'GOOD' : 'NEEDS_IMPROVEMENT'
        };
      }
    }).observe({ entryTypes: ['first-input'] });

    // Cumulative Layout Shift (CLS)
    let clsValue = 0;
    new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
        }
      }

      this.metrics.coreWebVitals.cls = {
        value: Math.round(clsValue * 1000) / 1000,
        rating: clsValue < 0.1 ? 'GOOD' : clsValue < 0.25 ? 'NEEDS_IMPROVEMENT' : 'POOR'
      };
    }).observe({ entryTypes: ['layout-shift'] });
  }

  /* ==========================================================================
     📊 Reporting and Analysis
     ========================================================================== */

  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: this.generateSummary(),
      detailedMetrics: this.metrics,
      recommendations: this.generateRecommendations()
    };

    return report;
  }

  generateSummary() {
    const cssReduction = this.metrics.cssMetrics['main-optimized.css']?.reductionFromOriginal || 'calculating...';
    const avgClassLength = this.metrics.domMetrics.avgClassLength;
    const lcpRating = this.metrics.coreWebVitals.lcp?.rating || 'measuring...';

    return {
      cssOptimization: cssReduction,
      codeReadability: avgClassLength < 30 ? 'EXCELLENT' : avgClassLength < 50 ? 'GOOD' : 'NEEDS_IMPROVEMENT',
      coreWebVitals: lcpRating,
      buttonSimplification: `${this.metrics.domMetrics.simplifiedButtons} buttons refactored`,
      overallStatus: this.calculateOverallStatus()
    };
  }

  calculateOverallStatus() {
    const checks = [
      this.metrics.domMetrics.avgClassLength < 50, // Code readability
      this.metrics.coreWebVitals.lcp?.rating === 'GOOD', // Performance
      this.metrics.domMetrics.simplifiedButtons > 10 // Refactoring completion
    ];

    const passedChecks = checks.filter(Boolean).length;

    if (passedChecks === checks.length) return 'EXCELLENT';
    if (passedChecks >= checks.length * 0.75) return 'GOOD';
    if (passedChecks >= checks.length * 0.5) return 'FAIR';
    return 'NEEDS_IMPROVEMENT';
  }

  generateRecommendations() {
    const recommendations = [];

    // CSS optimization recommendations
    if (this.metrics.cssMetrics['main-optimized.css']?.sizeKB > 25) {
      recommendations.push({
        type: 'CSS',
        priority: 'MEDIUM',
        message: 'Consider further CSS optimization to reach target size < 20KB'
      });
    }

    // DOM complexity recommendations
    if (this.metrics.domMetrics.avgClassLength > 50) {
      recommendations.push({
        type: 'HTML',
        priority: 'HIGH',
        message: 'Average class length is still high. Continue simplifying CSS classes.'
      });
    }

    // Performance recommendations
    if (this.metrics.coreWebVitals.lcp?.rating !== 'GOOD') {
      recommendations.push({
        type: 'PERFORMANCE',
        priority: 'HIGH',
        message: 'Largest Contentful Paint needs improvement. Optimize critical rendering path.'
      });
    }

    // Interaction recommendations
    const slowInteractions = this.metrics.interactionMetrics.buttonResponses?.filter(r => r.responseTime > 100).length || 0;
    if (slowInteractions > 0) {
      recommendations.push({
        type: 'INTERACTION',
        priority: 'MEDIUM',
        message: `${slowInteractions} slow button responses detected. Consider CSS animation optimizations.`
      });
    }

    return recommendations;
  }

  /* ==========================================================================
     🎯 Public API Methods
     ========================================================================== */

  printReport() {
    const report = this.generateReport();

    console.group('📊 Miyako Performance Report');
    console.log('🎯 Summary:', report.summary);

    if (report.recommendations.length > 0) {
      console.group('💡 Recommendations');
      report.recommendations.forEach(rec => {
        console.log(`${rec.priority}: ${rec.message} (${rec.type})`);
      });
      console.groupEnd();
    }

    console.log('📈 Detailed Metrics:', report.detailedMetrics);
    console.groupEnd();

    return report;
  }

  exportMetrics() {
    return {
      ...this.generateReport(),
      rawMetrics: this.metrics
    };
  }

  // Method to validate specific SOLID refactoring goals
  validateSOLIDRefactoring() {
    const validation = {
      singleResponsibility: {
        check: 'CSS classes have single, clear purposes',
        passed: this.metrics.domMetrics.avgClassLength < 40,
        score: this.metrics.domMetrics.avgClassLength
      },
      openClosed: {
        check: 'Component system is extensible',
        passed: document.querySelectorAll('[data-action]').length > 5,
        score: document.querySelectorAll('[data-action]').length
      },
      interfaceSegregation: {
        check: 'Focused, specific button types',
        passed: this.metrics.domMetrics.simplifiedButtons > 8,
        score: this.metrics.domMetrics.simplifiedButtons
      },
      dependencyInversion: {
        check: 'Theme-based abstraction implemented',
        passed: !!document.querySelector('link[href*="miyako-design-system"]'),
        score: 1
      }
    };

    console.log('🏗️ SOLID Principles Validation:', validation);
    return validation;
  }
}

/* ==========================================================================
   🚀 Initialization and Global Access
   ========================================================================== */

// Initialize performance monitoring
const performanceMonitor = new PerformanceMonitor();

// Make available globally for debugging
window.MiyakoPerf = performanceMonitor;

// Auto-generate report after page load
window.addEventListener('load', () => {
  setTimeout(() => {
    performanceMonitor.printReport();
    performanceMonitor.validateSOLIDRefactoring();
  }, 2000);
});

// Export for ES6 modules
export default PerformanceMonitor;