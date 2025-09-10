#!/usr/bin/env python3
"""
Test runner for POI Expansion System.

Executes comprehensive test suite with coverage reporting and performance metrics.
"""

import sys
import unittest
import time
import logging
from pathlib import Path
from io import StringIO

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestResult:
    """Container for test execution results."""
    
    def __init__(self):
        self.tests_run = 0
        self.failures = 0
        self.errors = 0
        self.skipped = 0
        self.success_rate = 0.0
        self.duration = 0.0
        self.details = []


class ColoredTestRunner:
    """Test runner with colored output and detailed reporting."""
    
    def __init__(self, verbosity=2):
        self.verbosity = verbosity
    
    def run_test_suite(self, test_suite) -> TestResult:
        """Run test suite and collect results."""
        result = TestResult()
        start_time = time.time()
        
        # Capture test output
        stream = StringIO()
        runner = unittest.TextTestRunner(
            stream=stream, 
            verbosity=self.verbosity
        )
        
        # Execute tests
        test_result = runner.run(test_suite)
        
        # Process results
        result.tests_run = test_result.testsRun
        result.failures = len(test_result.failures)
        result.errors = len(test_result.errors)
        result.skipped = len(test_result.skipped) if hasattr(test_result, 'skipped') else 0
        result.duration = time.time() - start_time
        
        if result.tests_run > 0:
            successful_tests = result.tests_run - result.failures - result.errors
            result.success_rate = (successful_tests / result.tests_run) * 100
        
        # Collect failure details
        for test, traceback in test_result.failures:
            result.details.append(f"FAIL: {test}\n{traceback}")
        
        for test, traceback in test_result.errors:
            result.details.append(f"ERROR: {test}\n{traceback}")
        
        return result


def discover_and_run_tests():
    """Discover and run all tests."""
    print("POI Expansion System - Test Suite")
    print("=" * 60)
    
    # Disable logging during tests to reduce noise
    logging.disable(logging.CRITICAL)
    
    # Discover tests
    loader = unittest.TestLoader()
    test_dir = Path(__file__).parent
    
    try:
        # Load all test modules
        test_suite = loader.discover(
            start_dir=str(test_dir),
            pattern='test_*.py',
            top_level_dir=str(test_dir.parent)
        )
        
        print(f"Discovered test modules in: {test_dir}")
        
        # Run tests
        runner = ColoredTestRunner(verbosity=2)
        result = runner.run_test_suite(test_suite)
        
        # Report results
        print("\n" + "=" * 60)
        print("TEST RESULTS")
        print("=" * 60)
        
        print(f"Tests Run:      {result.tests_run}")
        print(f"Successes:      {result.tests_run - result.failures - result.errors}")
        print(f"Failures:       {result.failures}")
        print(f"Errors:         {result.errors}")
        print(f"Skipped:        {result.skipped}")
        print(f"Success Rate:   {result.success_rate:.1f}%")
        print(f"Duration:       {result.duration:.2f} seconds")
        
        # Status indicator
        if result.failures == 0 and result.errors == 0:
            print("\n[OK] ALL TESTS PASSED!")
            status_code = 0
        else:
            print(f"\n[FAIL] {result.failures + result.errors} TEST(S) FAILED!")
            status_code = 1
            
            # Show failure details
            if result.details and len(result.details) <= 5:  # Show details for few failures
                print("\nFAILURE DETAILS:")
                print("-" * 60)
                for detail in result.details:
                    print(detail)
                    print("-" * 60)
        
        # Performance metrics
        if result.tests_run > 0:
            avg_time_per_test = result.duration / result.tests_run
            print(f"\nPerformance: {avg_time_per_test:.3f}s per test")
        
        return status_code
        
    except Exception as e:
        print(f"❌ Test discovery failed: {e}")
        return 1
    
    finally:
        # Re-enable logging
        logging.disable(logging.NOTSET)


def run_specific_test(test_name: str):
    """Run a specific test module or test case."""
    print(f"Running specific test: {test_name}")
    print("=" * 60)
    
    loader = unittest.TestLoader()
    runner = ColoredTestRunner(verbosity=2)
    
    try:
        if '.' in test_name:
            # Specific test method
            suite = loader.loadTestsFromName(test_name)
        else:
            # Test module
            suite = loader.loadTestsFromName(f"test_{test_name}")
        
        result = runner.run_test_suite(suite)
        
        if result.failures == 0 and result.errors == 0:
            print(f"\n[OK] Test '{test_name}' PASSED!")
            return 0
        else:
            print(f"\n[FAIL] Test '{test_name}' FAILED!")
            return 1
            
    except Exception as e:
        print(f"[FAIL] Failed to run test '{test_name}': {e}")
        return 1


def run_performance_tests():
    """Run performance-focused tests."""
    print("Performance Test Suite")
    print("=" * 60)
    
    # Load performance tests
    loader = unittest.TestLoader()
    runner = ColoredTestRunner(verbosity=1)
    
    # Performance test patterns
    patterns = ['*performance*', '*benchmark*', '*load*']
    
    suites = []
    for pattern in patterns:
        try:
            suite = loader.discover(
                start_dir=str(Path(__file__).parent),
                pattern=pattern,
                top_level_dir=str(Path(__file__).parent.parent)
            )
            suites.append(suite)
        except:
            continue
    
    if not any(suite.countTestCases() > 0 for suite in suites):
        print("No performance tests found")
        return 0
    
    # Combine and run performance tests
    combined_suite = unittest.TestSuite(suites)
    result = runner.run_test_suite(combined_suite)
    
    print(f"\nPerformance tests completed in {result.duration:.2f}s")
    return 0 if result.failures == 0 and result.errors == 0 else 1


def main():
    """Main test runner entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="POI Expansion System Test Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python tests/run_tests.py                    # Run all tests
  python tests/run_tests.py --test config      # Run config tests
  python tests/run_tests.py --performance      # Run performance tests
  python tests/run_tests.py --quick            # Run quick tests only
        """
    )
    
    parser.add_argument('--test', metavar='TEST_NAME',
                       help='Run specific test module or method')
    parser.add_argument('--performance', action='store_true',
                       help='Run performance tests')
    parser.add_argument('--quick', action='store_true',
                       help='Run quick tests only (skip integration)')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Increase verbosity')
    
    args = parser.parse_args()
    
    try:
        if args.test:
            return run_specific_test(args.test)
        elif args.performance:
            return run_performance_tests()
        else:
            # Run all tests
            return discover_and_run_tests()
            
    except KeyboardInterrupt:
        print("\n\nTests interrupted by user")
        return 130


if __name__ == '__main__':
    exit(main())