#!/usr/bin/env python3
"""
System Validation Script for POI Expansion System.

Comprehensive system health check and validation.
"""

import sys
import json
from pathlib import Path
from typing import Dict, List, Any

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from poi_expansion_system.orchestrator import POIExpansionOrchestrator
    from poi_expansion_system.interfaces import ExpansionPhase
    IMPORTS_AVAILABLE = True
except ImportError as e:
    print(f"❌ Import error: {e}")
    IMPORTS_AVAILABLE = False


def check_python_version() -> bool:
    """Check if Python version is compatible."""
    required_version = (3, 7)
    current_version = sys.version_info[:2]
    
    print(f"Python Version: {sys.version}")
    
    if current_version >= required_version:
        print(f"[OK] Python {current_version[0]}.{current_version[1]} is compatible")
        return True
    else:
        print(f"[FAIL] Python {current_version[0]}.{current_version[1]} is too old. Requires {required_version[0]}.{required_version[1]}+")
        return False


def check_file_structure() -> bool:
    """Check if required files and directories exist."""
    print("\nFile Structure Check:")
    
    project_root = Path(__file__).parent.parent
    
    required_files = [
        "data/miyakojima_pois.json",
        "docs/knowledge/miyakojima_database.json", 
        "js/poi.js",
        "config/base.json",
        "scripts/expand_pois.py",
        "poi_expansion_system/__init__.py"
    ]
    
    required_dirs = [
        "poi_expansion_system",
        "config", 
        "scripts",
        "tests"
    ]
    
    all_good = True
    
    # Check directories
    for dir_path in required_dirs:
        full_path = project_root / dir_path
        if full_path.exists() and full_path.is_dir():
            print(f"[OK] Directory: {dir_path}")
        else:
            print(f"[FAIL] Missing directory: {dir_path}")
            all_good = False
    
    # Check files
    for file_path in required_files:
        full_path = project_root / file_path
        if full_path.exists() and full_path.is_file():
            print(f"[OK] File: {file_path}")
        else:
            print(f"[FAIL] Missing file: {file_path}")
            all_good = False
    
    return all_good


def check_data_integrity() -> bool:
    """Check integrity of POI data files."""
    print("\nData Integrity Check:")
    
    project_root = Path(__file__).parent.parent
    
    # Check current POI data
    current_poi_path = project_root / "data/miyakojima_pois.json"
    
    try:
        if not current_poi_path.exists():
            print("[FAIL] Current POI file not found")
            return False
        
        with open(current_poi_path, 'r', encoding='utf-8') as f:
            current_data = json.load(f)
        
        # Validate structure
        required_keys = ['version', 'totalPOIs', 'categories', 'pois']
        for key in required_keys:
            if key not in current_data:
                print(f"❌ Missing key in current POIs: {key}")
                return False
        
        poi_count = len(current_data.get('pois', []))
        reported_count = current_data.get('totalPOIs', 0)
        
        if poi_count != reported_count:
            print(f"❌ POI count mismatch: {poi_count} actual vs {reported_count} reported")
            return False
        
        print(f"✅ Current POI data valid: {poi_count} POIs")
        
        # Check source database
        source_db_path = project_root / "docs/knowledge/miyakojima_database.json"
        
        if source_db_path.exists():
            with open(source_db_path, 'r', encoding='utf-8') as f:
                source_data = json.load(f)
            
            print("✅ Source database accessible")
        else:
            print("⚠️  Source database not found - expansion may be limited")
        
        return True
        
    except json.JSONDecodeError as e:
        print(f"❌ JSON parsing error: {e}")
        return False
    except Exception as e:
        print(f"❌ Data check error: {e}")
        return False


def check_system_initialization() -> bool:
    """Check if system can initialize properly."""
    print("\n🚀 System Initialization Check:")
    
    if not IMPORTS_AVAILABLE:
        print("❌ Cannot test initialization - import failures")
        return False
    
    try:
        # Initialize orchestrator
        orchestrator = POIExpansionOrchestrator("config", "production")
        
        print("✅ Orchestrator created")
        
        # Test initialization
        init_success = orchestrator.initialize_system()
        
        if init_success:
            print("✅ System initialized successfully")
            
            # Get system status
            status = orchestrator.get_system_status()
            
            if 'pois' in status:
                current_count = status['pois']['current_count']
                print(f"✅ Current POI count: {current_count}")
            
            return True
        else:
            print("❌ System initialization failed")
            return False
            
    except Exception as e:
        print(f"❌ Initialization error: {e}")
        return False


def check_critical_path_integrity() -> bool:
    """Check that the critical js/poi.js:65 path is not modified."""
    print("\n🔒 Critical Path Integrity Check:")
    
    project_root = Path(__file__).parent.parent
    poi_js_path = project_root / "js/poi.js"
    
    if not poi_js_path.exists():
        print("❌ js/poi.js file not found")
        return False
    
    try:
        with open(poi_js_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check for the critical path
        expected_path = "./data/miyakojima_pois.json"
        
        if expected_path in content:
            print(f"✅ Critical path preserved: {expected_path}")
            
            # Count occurrences
            occurrences = content.count(expected_path)
            print(f"✅ Path found {occurrences} time(s) in js/poi.js")
            
            return True
        else:
            print(f"❌ Critical path missing: {expected_path}")
            print("❌ POI expansion may break existing functionality!")
            return False
            
    except Exception as e:
        print(f"❌ Error reading js/poi.js: {e}")
        return False


def run_quick_functional_test() -> bool:
    """Run quick functional test of core components."""
    print("\n⚡ Quick Functional Test:")
    
    if not IMPORTS_AVAILABLE:
        print("❌ Cannot run functional test - import failures")
        return False
    
    try:
        orchestrator = POIExpansionOrchestrator("config", "development")
        
        if not orchestrator.initialize_system():
            print("❌ System initialization failed")
            return False
        
        print("✅ System initialization: PASS")
        
        # Test validation
        validation_result = orchestrator.validate_current_data()
        
        if validation_result.is_valid:
            print("✅ Data validation: PASS")
        else:
            print(f"❌ Data validation: FAIL ({len(validation_result.errors)} errors)")
            return False
        
        # Test backup creation
        backup_id = orchestrator.create_manual_backup("Validation test")
        
        if backup_id:
            print("✅ Backup creation: PASS")
        else:
            print("❌ Backup creation: FAIL")
            return False
        
        # Test backup listing
        backups = orchestrator.list_available_backups()
        
        if len(backups) > 0:
            print(f"✅ Backup listing: PASS ({len(backups)} backups)")
        else:
            print("❌ Backup listing: FAIL")
            return False
        
        # Test recommendations
        recommendations = orchestrator.get_expansion_recommendations()
        
        if 'next_phase' in recommendations:
            print("✅ Recommendations: PASS")
        else:
            print("❌ Recommendations: FAIL")
            return False
        
        print("✅ All functional tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Functional test error: {e}")
        return False


def print_system_summary(orchestrator) -> None:
    """Print comprehensive system summary."""
    print("\n" + "="*60)
    print("📋 SYSTEM SUMMARY")
    print("="*60)
    
    try:
        status = orchestrator.get_system_status()
        recommendations = orchestrator.get_expansion_recommendations()
        
        # System info
        system = status.get('system', {})
        print(f"System Version: {system.get('version', 'Unknown')}")
        print(f"Environment: {system.get('environment', 'Unknown')}")
        print(f"Initialized: {system.get('initialized', False)}")
        
        # POI info
        pois = status.get('pois', {})
        print(f"\nCurrent POIs: {pois.get('current_count', 0)}")
        print(f"Average Rating: {pois.get('average_rating', 0):.2f}")
        
        categories = pois.get('categories', {})
        if categories:
            print("\nCategory Distribution:")
            for category, count in categories.items():
                print(f"  {category}: {count}")
        
        # Expansion info
        print(f"\nNext Phase: {recommendations.get('next_phase', 'Unknown')}")
        print(f"Target Count: {recommendations.get('target_count', 0)}")
        print(f"Candidates Needed: {recommendations.get('candidates_needed', 0)}")
        
        # Backup info
        backups = status.get('backups', {})
        print(f"\nBackups Available: {backups.get('total_backups', 0)}")
        print(f"Latest Backup: {backups.get('latest_backup', 'None')}")
        print(f"Backup Size: {backups.get('total_size_mb', 0):.1f} MB")
        
    except Exception as e:
        print(f"Error generating summary: {e}")


def main():
    """Main validation routine."""
    print("POI Expansion System - Validation Suite")
    print("="*60)
    
    checks = [
        ("Python Version", check_python_version),
        ("File Structure", check_file_structure), 
        ("Data Integrity", check_data_integrity),
        ("Critical Path", check_critical_path_integrity),
        ("System Init", check_system_initialization),
        ("Functional Test", run_quick_functional_test)
    ]
    
    results = {}
    all_passed = True
    
    for check_name, check_func in checks:
        try:
            result = check_func()
            results[check_name] = result
            if not result:
                all_passed = False
        except Exception as e:
            print(f"❌ {check_name} check failed with exception: {e}")
            results[check_name] = False
            all_passed = False
    
    # Summary
    print("\n" + "="*60)
    print("📊 VALIDATION RESULTS")
    print("="*60)
    
    for check_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{check_name:<20}: {status}")
    
    print("\n" + "="*60)
    
    if all_passed:
        print("🎉 ALL VALIDATIONS PASSED!")
        print("✅ System is ready for POI expansion")
        
        # Show system summary if available
        if IMPORTS_AVAILABLE:
            try:
                orchestrator = POIExpansionOrchestrator("config", "production")
                if orchestrator.initialize_system():
                    print_system_summary(orchestrator)
            except:
                pass  # Summary is optional
        
        return 0
    else:
        print("❌ SOME VALIDATIONS FAILED!")
        print("🔧 Please fix the issues above before proceeding")
        return 1


if __name__ == '__main__':
    exit(main())