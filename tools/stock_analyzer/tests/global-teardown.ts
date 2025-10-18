import { FullConfig } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Global Teardown for Stock Analyzer E2E Tests
 * Runs once after all test suites complete
 */
async function globalTeardown(config: FullConfig) {
  console.log('\n🏁 Stock Analyzer E2E Test Suite Complete');

  try {
    // Read test results
    const resultsPath = './test-results/results.json';

    if (await fileExists(resultsPath)) {
      const resultsData = await fs.readFile(resultsPath, 'utf-8');
      const results = JSON.parse(resultsData);

      // Generate summary report
      const summary = {
        totalTests: results.suites?.reduce((acc: number, suite: any) => {
          return acc + (suite.specs?.length || 0);
        }, 0) || 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
      };

      // Calculate statistics
      results.suites?.forEach((suite: any) => {
        suite.specs?.forEach((spec: any) => {
          spec.tests?.forEach((test: any) => {
            if (test.status === 'passed') summary.passed++;
            else if (test.status === 'failed') summary.failed++;
            else if (test.status === 'skipped') summary.skipped++;

            summary.duration += test.results?.[0]?.duration || 0;
          });
        });
      });

      // Display summary
      console.log('\n📊 Test Execution Summary:');
      console.log(`   Total Tests: ${summary.totalTests}`);
      console.log(`   ✅ Passed: ${summary.passed}`);
      console.log(`   ❌ Failed: ${summary.failed}`);
      console.log(`   ⏭️  Skipped: ${summary.skipped}`);
      console.log(`   ⏱️  Duration: ${(summary.duration / 1000).toFixed(2)}s`);

      // Calculate pass rate
      const passRate = summary.totalTests > 0
        ? ((summary.passed / summary.totalTests) * 100).toFixed(2)
        : '0.00';
      console.log(`   📈 Pass Rate: ${passRate}%`);

      // Quality gate check
      const qualityGate = {
        passRateThreshold: 95, // 95% pass rate required
        passed: parseFloat(passRate) >= 95,
      };

      if (qualityGate.passed) {
        console.log('\n✅ Quality Gate: PASSED');
      } else {
        console.log('\n⚠️  Quality Gate: FAILED');
        console.log(`   Required pass rate: ${qualityGate.passRateThreshold}%`);
        console.log(`   Actual pass rate: ${passRate}%`);
      }

      // Save summary report
      await fs.writeFile(
        './test-results/summary.json',
        JSON.stringify({ summary, qualityGate }, null, 2)
      );
    }

    // Clean up temporary files
    console.log('\n🧹 Cleaning up temporary files...');

    const tempFiles = [
      './test-results/.tmp',
      './test-results/env-info.json',
    ];

    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch {
        // Ignore if file doesn't exist
      }
    }

    console.log('✓ Cleanup complete');

    // Generate links to reports
    console.log('\n📄 Reports Generated:');
    console.log('   HTML Report: playwright-report/index.html');
    console.log('   JSON Results: test-results/results.json');
    console.log('   JUnit XML: test-results/junit.xml');
    console.log('   Summary: test-results/summary.json');

    console.log('\n✨ Teardown completed successfully\n');
  } catch (error) {
    console.error('\n❌ Teardown error:', error);
    // Don't throw - teardown failures shouldn't fail the build
  }
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export default globalTeardown;
