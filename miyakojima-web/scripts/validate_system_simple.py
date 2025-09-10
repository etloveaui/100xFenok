#!/usr/bin/env python3
"""
Simple System Validation Script for POI Expansion System.
Windows-compatible version without Unicode characters.
"""

import sys
import json
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

def main():
    """Simple validation routine."""
    print("POI Expansion System - Simple Validation")
    print("=" * 50)
    
    # Check Python version
    print(f"\nPython Version: {sys.version}")
    required_version = (3, 7)
    current_version = sys.version_info[:2]
    
    if current_version >= required_version:
        print("[OK] Python version is compatible")
    else:
        print(f"[FAIL] Python version too old. Need {required_version[0]}.{required_version[1]}+")
        return 1
    
    # Check if we can import the system
    try:
        from poi_expansion_system.orchestrator import POIExpansionOrchestrator
        print("[OK] System imports successful")
    except ImportError as e:
        print(f"[FAIL] Import error: {e}")
        return 1
    
    # Check file structure
    project_root = Path(__file__).parent.parent
    
    essential_files = [
        "data/miyakojima_pois.json",
        "config/base.json",
        "poi_expansion_system/__init__.py"
    ]
    
    print("\nFile Structure Check:")
    all_files_exist = True
    
    for file_path in essential_files:
        full_path = project_root / file_path
        if full_path.exists():
            print(f"[OK] {file_path}")
        else:
            print(f"[FAIL] Missing: {file_path}")
            all_files_exist = False
    
    if not all_files_exist:
        print("[FAIL] Some essential files are missing")
        return 1
    
    # Test system initialization
    print("\nSystem Initialization Test:")
    try:
        orchestrator = POIExpansionOrchestrator("config", "production")
        
        if orchestrator.initialize_system():
            print("[OK] System initialized successfully")
            
            # Get basic status
            status = orchestrator.get_system_status()
            poi_count = status.get('pois', {}).get('current_count', 0)
            print(f"[OK] Current POI count: {poi_count}")
            
            # Test validation
            validation_result = orchestrator.validate_current_data()
            if validation_result.is_valid:
                print("[OK] Data validation passed")
            else:
                print(f"[WARN] Data validation has {len(validation_result.errors)} errors")
            
        else:
            print("[FAIL] System initialization failed")
            return 1
            
    except Exception as e:
        print(f"[FAIL] System test error: {e}")
        return 1
    
    # Success
    print("\n" + "=" * 50)
    print("VALIDATION COMPLETE")
    print("[OK] All essential checks passed!")
    print("System is ready for POI expansion operations")
    print("=" * 50)
    
    return 0

if __name__ == '__main__':
    exit(main())