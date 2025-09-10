#!/usr/bin/env python3
"""
Debug script to identify validation issues.
"""

import sys
import json
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from poi_expansion_system.config_manager import ConfigManager
from poi_expansion_system.quality_validator import QualityValidator
from poi_expansion_system.data_manager import POIDataManager

def main():
    """Debug validation issues."""
    print("DEBUG: POI Validation Issues")
    print("=" * 40)
    
    try:
        # Initialize components
        config = ConfigManager("config", "production")
        validator = QualityValidator(config)
        data_manager = POIDataManager(config, validator)
        
        print("Components initialized successfully")
        
        # Load POI data
        print("\nLoading POI data...")
        pois = data_manager.load_pois()
        print(f"Loaded {len(pois)} POI records")
        
        # Test first POI
        if pois:
            first_poi = pois[0]
            print(f"\nFirst POI: {first_poi.id}")
            print(f"Name: {first_poi.name}")
            print(f"Category: {first_poi.category}")
            print(f"Rating: {first_poi.rating}")
            print(f"Coordinates: {first_poi.coordinates}")
            
            # Validate first POI
            result = validator.validate_poi_record(first_poi)
            print(f"\nValidation result: {result.is_valid}")
            
            if result.errors:
                print("Errors:")
                for error in result.errors:
                    print(f"  - {error}")
            
            if result.warnings:
                print("Warnings:")
                for warning in result.warnings:
                    print(f"  - {warning}")
        
        # Test full list validation
        print(f"\nValidating full POI list...")
        full_result = validator.validate_poi_list(pois)
        print(f"Full validation result: {full_result.is_valid}")
        
        if full_result.errors:
            print("Full validation errors:")
            for error in full_result.errors[:5]:  # First 5 errors
                print(f"  - {error}")
        
        return 0
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    exit(main())