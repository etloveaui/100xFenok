#!/usr/bin/env python3
"""
Production-Grade POI Expansion System for Miyakojima Travel Web App

This system expands the current POI database from 25 to 50 POIs while maintaining
data integrity, geographic distribution, and category balance.

Author: Claude Code
Created: 2025-09-10
Version: 1.0.0
"""

import sys
import json
import uuid
import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
import logging

# Configuration
@dataclass
class ExpansionConfig:
    """Configuration settings for POI expansion."""
    
    # File paths
    source_database_path: str = "docs/knowledge/miyakojima_database.json"
    current_pois_path: str = "data/miyakojima_pois.json"
    backup_dir: str = "backups"
    log_dir: str = "logs"
    
    # Expansion settings
    target_total_pois: int = 50
    current_pois_count: int = 25
    pois_to_add: int = 25
    
    # Geographic bounds for Miyakojima
    coordinate_bounds: Dict[str, Tuple[float, float]] = None
    
    # Category balance settings
    maintain_proportional_distribution: bool = True
    min_rating_threshold: float = 4.0
    
    # Data quality settings
    required_fields: List[str] = None
    
    def __post_init__(self):
        """Initialize default values that can't be set in field defaults."""
        if self.coordinate_bounds is None:
            self.coordinate_bounds = {
                "lat": (24.6, 24.9),
                "lng": (125.1, 125.5)
            }
        
        if self.required_fields is None:
            self.required_fields = [
                "name", "nameEn", "category", "rating", 
                "coordinates", "description", "features"
            ]


class CoordinateValidator:
    """Validates coordinates are within Miyakojima bounds."""
    
    def __init__(self, bounds: Dict[str, Tuple[float, float]]):
        self.bounds = bounds
        
    def is_valid(self, lat: float, lng: float) -> bool:
        """Check if coordinates are within valid bounds."""
        lat_min, lat_max = self.bounds["lat"]
        lng_min, lng_max = self.bounds["lng"]
        
        return (lat_min <= lat <= lat_max and 
                lng_min <= lng <= lng_max)
    
    def validate_poi_coordinates(self, poi: Dict[str, Any]) -> bool:
        """Validate POI coordinates."""
        try:
            coords = poi.get("coordinates", {})
            lat = coords.get("lat")
            lng = coords.get("lng")
            
            if lat is None or lng is None:
                return False
                
            return self.is_valid(lat, lng)
            
        except (TypeError, KeyError):
            return False


class DataQualityValidator:
    """Validates POI data quality and completeness."""
    
    def __init__(self, required_fields: List[str]):
        self.required_fields = required_fields
        
    def validate_poi(self, poi: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Validate POI data completeness and quality.
        
        Returns:
            Tuple of (is_valid: bool, errors: List[str])
        """
        errors = []
        
        # Check required fields
        for field in self.required_fields:
            if field not in poi or poi[field] is None:
                errors.append(f"Missing required field: {field}")
                
        # Validate specific field types and values
        if "rating" in poi:
            try:
                rating = float(poi["rating"])
                if not 1.0 <= rating <= 5.0:
                    errors.append(f"Invalid rating: {rating}. Must be between 1.0 and 5.0")
            except (ValueError, TypeError):
                errors.append("Rating must be a valid number")
                
        if "category" in poi:
            valid_categories = ["beaches", "culture", "activities", "restaurants", "nature", "shopping"]
            if poi["category"] not in valid_categories:
                errors.append(f"Invalid category: {poi['category']}. Must be one of {valid_categories}")
                
        # Validate coordinates structure
        if "coordinates" in poi:
            coords = poi["coordinates"]
            if not isinstance(coords, dict) or "lat" not in coords or "lng" not in coords:
                errors.append("Invalid coordinates structure. Must have 'lat' and 'lng' keys")
                
        return len(errors) == 0, errors


class POIDataExtractor:
    """Extracts and transforms POI data from source database."""
    
    def __init__(self, config: ExpansionConfig):
        self.config = config
        self.coordinate_validator = CoordinateValidator(config.coordinate_bounds)
        self.quality_validator = DataQualityValidator(config.required_fields)
        
    def load_source_database(self) -> Dict[str, Any]:
        """Load the source database with error handling."""
        try:
            with open(self.config.source_database_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            raise FileNotFoundError(f"Source database not found: {self.config.source_database_path}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in source database: {e}")
            
    def load_current_pois(self) -> Dict[str, Any]:
        """Load current POI data."""
        try:
            with open(self.config.current_pois_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            raise FileNotFoundError(f"Current POI file not found: {self.config.current_pois_path}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in current POI file: {e}")
            
    def extract_candidate_pois(self, source_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Extract candidate POIs from various sections of the source database.
        
        This method intelligently parses the complex source database structure
        and extracts POI information from different sections.
        """
        candidates = []
        
        # Extract from extensions.poi_locations sections
        extensions = source_data.get("extensions", {}).get("poi_locations", {})
        
        # Process different POI categories
        self._extract_nature_views(extensions.get("nature_views", {}), candidates)
        self._extract_dining_cafe(extensions.get("dining_cafe", {}), candidates)
        self._extract_shopping(extensions.get("shopping", {}), candidates)
        self._extract_marine_activities(extensions.get("marine_activities", {}), candidates)
        self._extract_culture_spots(extensions.get("culture_spots", {}), candidates)
        self._extract_experience_activities(extensions.get("experience_activities", {}), candidates)
        
        # Filter candidates by coordinates and quality
        valid_candidates = []
        for candidate in candidates:
            if self.coordinate_validator.validate_poi_coordinates(candidate):
                is_valid, errors = self.quality_validator.validate_poi(candidate)
                if is_valid:
                    valid_candidates.append(candidate)
                else:
                    logging.warning(f"Invalid candidate POI {candidate.get('name', 'Unknown')}: {errors}")
            else:
                logging.warning(f"Invalid coordinates for POI: {candidate.get('name', 'Unknown')}")
                
        return valid_candidates
    
    def _extract_nature_views(self, nature_data: Dict[str, Any], candidates: List[Dict[str, Any]]):
        """Extract POIs from nature views section."""
        # Extract beaches
        beaches = nature_data.get("beaches_detailed", {})
        for beach_key, beach_info in beaches.items():
            candidates.append(self._create_poi_from_beach(beach_key, beach_info))
            
        # Extract viewpoints
        viewpoints = nature_data.get("viewpoints_detailed", {})
        for viewpoint_key, viewpoint_info in viewpoints.items():
            candidates.append(self._create_poi_from_viewpoint(viewpoint_key, viewpoint_info))
            
        # Extract unique spots
        unique_spots = nature_data.get("unique_spots_detailed", {})
        for spot_key, spot_info in unique_spots.items():
            candidates.append(self._create_poi_from_unique_spot(spot_key, spot_info))
    
    def _extract_dining_cafe(self, dining_data: Dict[str, Any], candidates: List[Dict[str, Any]]):
        """Extract POIs from dining and cafe section."""
        # Extract premium restaurants
        premium = dining_data.get("premium_restaurants", {})
        for restaurant_key, restaurant_info in premium.items():
            candidates.append(self._create_poi_from_restaurant(restaurant_key, restaurant_info))
            
        # Extract local soba restaurants
        soba = dining_data.get("local_soba", {})
        for soba_key, soba_info in soba.items():
            candidates.append(self._create_poi_from_restaurant(soba_key, soba_info))
            
        # Extract cafes
        cafes = dining_data.get("cafes", {})
        for cafe_key, cafe_info in cafes.items():
            candidates.append(self._create_poi_from_cafe(cafe_key, cafe_info))
    
    def _extract_shopping(self, shopping_data: Dict[str, Any], candidates: List[Dict[str, Any]]):
        """Extract POIs from shopping section."""
        # Extract specialty stores
        specialty = shopping_data.get("specialty_stores", {})
        for store_key, store_info in specialty.items():
            candidates.append(self._create_poi_from_shop(store_key, store_info))
            
        # Extract supermarkets
        supermarkets = shopping_data.get("supermarkets", {})
        for market_key, market_info in supermarkets.items():
            candidates.append(self._create_poi_from_shop(market_key, market_info))
    
    def _extract_marine_activities(self, marine_data: Dict[str, Any], candidates: List[Dict[str, Any]]):
        """Extract POIs from marine activities section."""
        # Extract diving shops
        diving = marine_data.get("diving_shops", {})
        for dive_key, dive_info in diving.items():
            candidates.append(self._create_poi_from_activity(dive_key, dive_info))
            
        # Extract marine sports
        sports = marine_data.get("marine_sports", {})
        for sport_key, sport_info in sports.items():
            candidates.append(self._create_poi_from_activity(sport_key, sport_info))
    
    def _extract_culture_spots(self, culture_data: Dict[str, Any], candidates: List[Dict[str, Any]]):
        """Extract POIs from culture spots section."""
        # Extract bridges and landmarks
        bridges = culture_data.get("bridges_landmarks", {})
        for bridge_key, bridge_info in bridges.items():
            candidates.append(self._create_poi_from_culture(bridge_key, bridge_info))
            
        # Extract museums
        museums = culture_data.get("museums_cultural", {})
        for museum_key, museum_info in museums.items():
            candidates.append(self._create_poi_from_culture(museum_key, museum_info))
            
        # Extract hot springs
        onsen = culture_data.get("hot_springs", {})
        for onsen_key, onsen_info in onsen.items():
            candidates.append(self._create_poi_from_culture(onsen_key, onsen_info))
    
    def _extract_experience_activities(self, activity_data: Dict[str, Any], candidates: List[Dict[str, Any]]):
        """Extract POIs from experience activities section."""
        # Extract traditional crafts
        crafts = activity_data.get("traditional_crafts", {})
        for craft_key, craft_info in crafts.items():
            candidates.append(self._create_poi_from_activity(craft_key, craft_info))
            
        # Extract cultural experiences
        experiences = activity_data.get("cultural_experiences", {})
        for exp_key, exp_info in experiences.items():
            candidates.append(self._create_poi_from_activity(exp_key, exp_info))
    
    def _create_poi_from_beach(self, key: str, info: Dict[str, Any]) -> Dict[str, Any]:
        """Create standardized POI from beach data."""
        coordinates = info.get("coordinates", [])
        if len(coordinates) >= 2:
            lat, lng = coordinates[0], coordinates[1]
        else:
            lat, lng = 24.7, 125.2  # Default fallback
            
        return {
            "id": f"beach_{key}_{self._generate_short_id()}",
            "name": self._beautify_name(key),
            "nameEn": self._create_english_name(key),
            "category": "beaches",
            "rating": 4.5,  # Default rating
            "coordinates": {"lat": lat, "lng": lng},
            "description": f"아름다운 {self._beautify_name(key)} 해변",
            "features": info.get("activities", ["해수욕", "휴식", "경치 감상"]),
            "openHours": "24시간",
            "estimatedTime": "2-3시간",
            "cost": {"min": 0, "max": 0, "currency": "JPY"},
            "tips": "사전 정보 확인 권장",
            "accessibility": "일반",
            "weather": {"sunny": "최적", "cloudy": "좋음", "rainy": "주의"}
        }
    
    def _create_poi_from_restaurant(self, key: str, info: Dict[str, Any]) -> Dict[str, Any]:
        """Create standardized POI from restaurant data."""
        coordinates = info.get("coordinates", [])
        if len(coordinates) >= 2:
            lat, lng = coordinates[0], coordinates[1]
        else:
            lat, lng = 24.8, 125.28  # Default fallback
            
        # Extract price range
        price_range = info.get("price_range", "1,000-3,000 JPY")
        min_cost, max_cost = self._parse_price_range(price_range)
        
        return {
            "id": f"restaurant_{key}_{self._generate_short_id()}",
            "name": self._beautify_name(key),
            "nameEn": self._create_english_name(key),
            "category": "restaurants",
            "rating": 4.4,
            "coordinates": {"lat": lat, "lng": lng},
            "description": f"{self._beautify_name(key)} - {info.get('specialty', '현지 음식')}",
            "features": ["현지 음식", info.get('specialty', '특선 메뉴'), "맛있는 요리"],
            "openHours": info.get("hours", "11:00-21:00"),
            "estimatedTime": "1-2시간",
            "cost": {"min": min_cost, "max": max_cost, "currency": "JPY"},
            "tips": "예약 권장",
            "accessibility": "일반",
            "weather": {"sunny": "좋음", "cloudy": "좋음", "rainy": "좋음"}
        }
    
    def _create_poi_from_cafe(self, key: str, info: Dict[str, Any]) -> Dict[str, Any]:
        """Create standardized POI from cafe data."""
        coordinates = info.get("coordinates", [])
        if len(coordinates) >= 2:
            lat, lng = coordinates[0], coordinates[1]
        else:
            lat, lng = 24.75, 125.25
            
        price_range = info.get("price_range", "500-1,500 JPY")
        min_cost, max_cost = self._parse_price_range(price_range)
        
        return {
            "id": f"cafe_{key}_{self._generate_short_id()}",
            "name": self._beautify_name(key),
            "nameEn": self._create_english_name(key),
            "category": "restaurants",
            "rating": 4.3,
            "coordinates": {"lat": lat, "lng": lng},
            "description": f"{self._beautify_name(key)} - {info.get('specialty', '카페')}",
            "features": ["카페", "음료", info.get('specialty', '디저트')],
            "openHours": info.get("hours", "10:00-18:00"),
            "estimatedTime": "1시간",
            "cost": {"min": min_cost, "max": max_cost, "currency": "JPY"},
            "tips": "휴식하기 좋은 곳",
            "accessibility": "일반",
            "weather": {"sunny": "좋음", "cloudy": "좋음", "rainy": "좋음"}
        }
    
    def _create_poi_from_shop(self, key: str, info: Dict[str, Any]) -> Dict[str, Any]:
        """Create standardized POI from shop data."""
        coordinates = info.get("coordinates", [])
        if len(coordinates) >= 2:
            lat, lng = coordinates[0], coordinates[1]
        else:
            lat, lng = 24.78, 125.28
            
        return {
            "id": f"shop_{key}_{self._generate_short_id()}",
            "name": self._beautify_name(key),
            "nameEn": self._create_english_name(key),
            "category": "shopping",
            "rating": 4.2,
            "coordinates": {"lat": lat, "lng": lng},
            "description": f"{self._beautify_name(key)} - 쇼핑 및 특산품",
            "features": info.get("specialties", ["쇼핑", "특산품", "기념품"]),
            "openHours": info.get("hours", "09:00-18:00"),
            "estimatedTime": "1-2시간",
            "cost": {"min": 500, "max": 5000, "currency": "JPY"},
            "tips": "다양한 특산품 구매 가능",
            "accessibility": "일반",
            "weather": {"sunny": "좋음", "cloudy": "좋음", "rainy": "좋음"}
        }
    
    def _create_poi_from_viewpoint(self, key: str, info: Dict[str, Any]) -> Dict[str, Any]:
        """Create standardized POI from viewpoint data."""
        coordinates = info.get("coordinates", [])
        if len(coordinates) >= 2:
            lat, lng = coordinates[0], coordinates[1]
        else:
            lat, lng = 24.7, 125.3
            
        return {
            "id": f"nature_{key}_{self._generate_short_id()}",
            "name": self._beautify_name(key),
            "nameEn": self._create_english_name(key),
            "category": "nature",
            "rating": 4.6,
            "coordinates": {"lat": lat, "lng": lng},
            "description": f"{self._beautify_name(key)} - 절경 전망대",
            "features": info.get("features", ["전망대", "경치 감상", "사진 촬영"]),
            "openHours": "24시간",
            "estimatedTime": "1-2시간",
            "cost": {"min": 0, "max": 0, "currency": "JPY"},
            "tips": "일출/일몰 시간 방문 권장",
            "accessibility": "일반",
            "weather": {"sunny": "최적", "cloudy": "좋음", "rainy": "주의"}
        }
    
    def _create_poi_from_unique_spot(self, key: str, info: Dict[str, Any]) -> Dict[str, Any]:
        """Create standardized POI from unique spot data."""
        coordinates = info.get("coordinates", [])
        if len(coordinates) >= 2:
            lat, lng = coordinates[0], coordinates[1]
        else:
            lat, lng = 24.65, 125.15
            
        return {
            "id": f"nature_{key}_{self._generate_short_id()}",
            "name": self._beautify_name(key),
            "nameEn": self._create_english_name(key),
            "category": "nature",
            "rating": 4.7,
            "coordinates": {"lat": lat, "lng": lng},
            "description": f"{self._beautify_name(key)} - 특별한 자연 명소",
            "features": ["자연", "특별한 경험", "신비로운 곳"],
            "openHours": "09:00-17:00",
            "estimatedTime": "2-3시간",
            "cost": {"min": 0, "max": 1000, "currency": "JPY"},
            "tips": "안전에 주의하여 관람",
            "accessibility": "제한적",
            "weather": {"sunny": "최적", "cloudy": "좋음", "rainy": "취소"}
        }
    
    def _create_poi_from_activity(self, key: str, info: Dict[str, Any]) -> Dict[str, Any]:
        """Create standardized POI from activity data."""
        coordinates = info.get("coordinates", [])
        if len(coordinates) >= 2:
            lat, lng = coordinates[0], coordinates[1]
        else:
            lat, lng = 24.74, 125.24
            
        price_range = info.get("price_range", info.get("price", "2,000-8,000 JPY"))
        min_cost, max_cost = self._parse_price_range(str(price_range))
        
        return {
            "id": f"activity_{key}_{self._generate_short_id()}",
            "name": self._beautify_name(key),
            "nameEn": self._create_english_name(key),
            "category": "activities",
            "rating": 4.5,
            "coordinates": {"lat": lat, "lng": lng},
            "description": f"{self._beautify_name(key)} - {info.get('specialty', '액티비티')}",
            "features": info.get("amenities", ["액티비티", "체험", "모험"]),
            "openHours": info.get("hours", "09:00-17:00"),
            "estimatedTime": "2-4시간",
            "cost": {"min": min_cost, "max": max_cost, "currency": "JPY"},
            "tips": "사전 예약 권장",
            "accessibility": "일반",
            "weather": {"sunny": "최적", "cloudy": "좋음", "rainy": "취소"}
        }
    
    def _create_poi_from_culture(self, key: str, info: Dict[str, Any]) -> Dict[str, Any]:
        """Create standardized POI from culture data."""
        coordinates = info.get("coordinates", [])
        if len(coordinates) >= 2:
            lat, lng = coordinates[0], coordinates[1]
        else:
            lat, lng = 24.8, 125.25
            
        # Determine if it's a paid attraction
        price = info.get("price", info.get("admission", "0 JPY"))
        min_cost, max_cost = self._parse_price_range(str(price))
        
        return {
            "id": f"culture_{key}_{self._generate_short_id()}",
            "name": self._beautify_name(key),
            "nameEn": self._create_english_name(key),
            "category": "culture",
            "rating": 4.4,
            "coordinates": {"lat": lat, "lng": lng},
            "description": f"{self._beautify_name(key)} - 문화 및 역사 명소",
            "features": ["문화", "역사", "교육적 가치"],
            "openHours": info.get("hours", "09:00-17:00"),
            "estimatedTime": "1-3시간",
            "cost": {"min": min_cost, "max": max_cost, "currency": "JPY"},
            "tips": "역사와 문화를 체험할 수 있는 곳",
            "accessibility": "일반",
            "weather": {"sunny": "좋음", "cloudy": "좋음", "rainy": "좋음"}
        }
    
    def _beautify_name(self, key: str) -> str:
        """Convert key to beautiful Korean name."""
        # Simple name beautification mapping
        name_map = {
            "dougs_burger": "다그즈 버거",
            "dougs_grill": "다그즈 그릴",
            "sunayama_beach": "스나야마 비치",
            "painagama_beach": "파이나가마 비치",
            "aragusuku_beach": "아라구스쿠 비치",
            "makiyama_observatory": "마키야마 전망대",
            "higashihenna_lighthouse": "히가시헨나자키 등대",
            "irabu_bridge": "이라부 대교",
            "kurima_bridge": "쿠리마 대교",
            "toriike": "도리이케",
            "17end": "17END",
            "shigira_golden_onsen": "시기라 황금온천",
            "miyako_blue_diving": "미야코 블루 다이빙"
        }
        
        return name_map.get(key, key.replace("_", " ").title())
    
    def _create_english_name(self, key: str) -> str:
        """Create English name from key."""
        return key.replace("_", " ").title()
    
    def _parse_price_range(self, price_str: str) -> Tuple[int, int]:
        """Parse price range string to min/max values."""
        try:
            # Remove 'JPY' and other text
            price_clean = price_str.replace("JPY", "").replace("¥", "").strip()
            
            if "-" in price_clean:
                min_str, max_str = price_clean.split("-")
                min_cost = int(min_str.replace(",", "").strip())
                max_cost = int(max_str.replace(",", "").strip())
            else:
                # Single price value
                cost = int(price_clean.replace(",", "").strip())
                min_cost = max_cost = cost
                
            return min_cost, max_cost
            
        except (ValueError, AttributeError):
            # Default fallback
            return 0, 1000
    
    def _generate_short_id(self) -> str:
        """Generate short unique identifier."""
        return str(uuid.uuid4())[:8]


class CategoryBalancer:
    """Maintains proportional category distribution when selecting new POIs."""
    
    def __init__(self, current_distribution: Dict[str, int], target_total: int):
        self.current_distribution = current_distribution
        self.current_total = sum(current_distribution.values())
        self.target_total = target_total
        self.pois_to_add = target_total - self.current_total
        
    def calculate_target_distribution(self) -> Dict[str, int]:
        """Calculate how many POIs should be added to each category."""
        target_distribution = {}
        
        # Calculate proportional targets
        for category, current_count in self.current_distribution.items():
            proportion = current_count / self.current_total
            target_count = round(proportion * self.target_total)
            pois_to_add = max(0, target_count - current_count)
            target_distribution[category] = pois_to_add
            
        # Adjust if total doesn't match exactly
        total_to_add = sum(target_distribution.values())
        difference = self.pois_to_add - total_to_add
        
        if difference != 0:
            # Distribute difference to categories with highest current counts
            sorted_categories = sorted(self.current_distribution.items(), 
                                     key=lambda x: x[1], reverse=True)
            
            for category, _ in sorted_categories:
                if difference == 0:
                    break
                if difference > 0:
                    target_distribution[category] += 1
                    difference -= 1
                else:
                    if target_distribution[category] > 0:
                        target_distribution[category] -= 1
                        difference += 1
                        
        return target_distribution
    
    def select_balanced_pois(self, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Select POIs maintaining category balance."""
        target_distribution = self.calculate_target_distribution()
        
        # Group candidates by category
        candidates_by_category = {}
        for candidate in candidates:
            category = candidate.get("category")
            if category not in candidates_by_category:
                candidates_by_category[category] = []
            candidates_by_category[category].append(candidate)
        
        # Sort candidates within each category by rating (descending)
        for category in candidates_by_category:
            candidates_by_category[category].sort(
                key=lambda x: x.get("rating", 0), reverse=True
            )
        
        # Select POIs according to target distribution
        selected_pois = []
        for category, needed_count in target_distribution.items():
            if category in candidates_by_category:
                available_pois = candidates_by_category[category]
                selected_count = min(needed_count, len(available_pois))
                selected_pois.extend(available_pois[:selected_count])
                
        return selected_pois


class BackupManager:
    """Manages backup and rollback functionality."""
    
    def __init__(self, backup_dir: str):
        self.backup_dir = Path(backup_dir)
        self.backup_dir.mkdir(exist_ok=True)
        
    def create_backup(self, file_path: str, backup_name: Optional[str] = None) -> str:
        """
        Create backup of a file.
        
        Returns:
            str: Path to the backup file
        """
        source_path = Path(file_path)
        
        if not source_path.exists():
            raise FileNotFoundError(f"Source file not found: {file_path}")
            
        if backup_name is None:
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            backup_name = f"{source_path.stem}_backup_{timestamp}{source_path.suffix}"
            
        backup_path = self.backup_dir / backup_name
        
        # Copy file content
        with open(source_path, 'r', encoding='utf-8') as src:
            content = src.read()
            
        with open(backup_path, 'w', encoding='utf-8') as dst:
            dst.write(content)
            
        logging.info(f"Backup created: {backup_path}")
        return str(backup_path)
    
    def restore_backup(self, backup_path: str, target_path: str) -> bool:
        """
        Restore file from backup.
        
        Returns:
            bool: Success status
        """
        try:
            backup_file = Path(backup_path)
            target_file = Path(target_path)
            
            if not backup_file.exists():
                raise FileNotFoundError(f"Backup file not found: {backup_path}")
                
            with open(backup_file, 'r', encoding='utf-8') as src:
                content = src.read()
                
            with open(target_file, 'w', encoding='utf-8') as dst:
                dst.write(content)
                
            logging.info(f"Backup restored: {backup_path} -> {target_path}")
            return True
            
        except Exception as e:
            logging.error(f"Failed to restore backup: {e}")
            return False
    
    def list_backups(self) -> List[str]:
        """List all backup files."""
        if not self.backup_dir.exists():
            return []
            
        return [str(f) for f in self.backup_dir.glob("*_backup_*")]


class POIExpansionSystem:
    """Main orchestrator for the POI expansion process."""
    
    def __init__(self, config: ExpansionConfig):
        self.config = config
        self.extractor = POIDataExtractor(config)
        self.backup_manager = BackupManager(config.backup_dir)
        
        # Setup logging
        self._setup_logging()
        
    def _setup_logging(self):
        """Setup comprehensive logging."""
        log_dir = Path(self.config.log_dir)
        log_dir.mkdir(exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = log_dir / f"poi_expansion_{timestamp}.log"
        
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_file, encoding='utf-8'),
                logging.StreamHandler(sys.stdout)
            ]
        )
        
        logging.info("POI Expansion System initialized")
        logging.info(f"Configuration: {asdict(self.config)}")
    
    def expand_pois(self, dry_run: bool = False) -> Dict[str, Any]:
        """
        Main method to expand POI database.
        
        Args:
            dry_run: If True, show what would be done without making changes
            
        Returns:
            Dict containing expansion results and statistics
        """
        try:
            logging.info("Starting POI expansion process...")
            
            # Step 1: Load and analyze current data
            logging.info("Step 1: Loading current POI data...")
            current_data = self.extractor.load_current_pois()
            current_pois = current_data.get("pois", [])
            
            logging.info(f"Current POI count: {len(current_pois)}")
            
            # Analyze current distribution
            current_distribution = {}
            for poi in current_pois:
                category = poi.get("category")
                current_distribution[category] = current_distribution.get(category, 0) + 1
            
            logging.info(f"Current distribution: {current_distribution}")
            
            # Step 2: Load source database and extract candidates
            logging.info("Step 2: Loading source database and extracting candidates...")
            source_data = self.extractor.load_source_database()
            candidates = self.extractor.extract_candidate_pois(source_data)
            
            logging.info(f"Extracted {len(candidates)} candidate POIs")
            
            # Step 3: Remove duplicates (basic check by coordinates proximity)
            logging.info("Step 3: Filtering duplicates...")
            filtered_candidates = self._remove_duplicates(current_pois, candidates)
            
            logging.info(f"After duplicate removal: {len(filtered_candidates)} candidates")
            
            # Step 4: Select balanced POIs
            logging.info("Step 4: Selecting balanced POIs...")
            balancer = CategoryBalancer(current_distribution, self.config.target_total_pois)
            selected_pois = balancer.select_balanced_pois(filtered_candidates)
            
            logging.info(f"Selected {len(selected_pois)} POIs for addition")
            
            # Log selection by category
            selection_distribution = {}
            for poi in selected_pois:
                category = poi.get("category")
                selection_distribution[category] = selection_distribution.get(category, 0) + 1
            
            logging.info(f"Selection distribution: {selection_distribution}")
            
            # Step 5: Create backup and update data
            if not dry_run:
                logging.info("Step 5: Creating backup and updating data...")
                
                # Create backup
                backup_path = self.backup_manager.create_backup(self.config.current_pois_path)
                
                # Update POI data
                updated_data = current_data.copy()
                updated_data["pois"].extend(selected_pois)
                updated_data["totalPOIs"] = len(updated_data["pois"])
                updated_data["lastUpdated"] = datetime.now(timezone.utc).isoformat()
                updated_data["version"] = self._increment_version(current_data.get("version", "1.0.0"))
                
                # Write updated data
                with open(self.config.current_pois_path, 'w', encoding='utf-8') as f:
                    json.dump(updated_data, f, ensure_ascii=False, indent=2)
                
                logging.info(f"POI data updated successfully. New total: {updated_data['totalPOIs']}")
                
                # Verify expansion
                verification_result = self._verify_expansion(updated_data)
                
                return {
                    "success": True,
                    "dry_run": False,
                    "backup_path": backup_path,
                    "original_count": len(current_pois),
                    "added_count": len(selected_pois),
                    "new_total": updated_data["totalPOIs"],
                    "current_distribution": current_distribution,
                    "selection_distribution": selection_distribution,
                    "verification": verification_result
                }
            else:
                logging.info("Step 5: Dry run - no changes made")
                
                return {
                    "success": True,
                    "dry_run": True,
                    "original_count": len(current_pois),
                    "would_add_count": len(selected_pois),
                    "would_be_total": len(current_pois) + len(selected_pois),
                    "current_distribution": current_distribution,
                    "selection_distribution": selection_distribution,
                    "selected_pois": selected_pois[:5]  # Show first 5 as preview
                }
                
        except Exception as e:
            logging.error(f"POI expansion failed: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "dry_run": dry_run
            }
    
    def _remove_duplicates(self, existing_pois: List[Dict[str, Any]], 
                          candidates: List[Dict[str, Any]], 
                          distance_threshold: float = 0.001) -> List[Dict[str, Any]]:
        """
        Remove duplicate POIs based on coordinate proximity and name similarity.
        
        Args:
            existing_pois: Current POI list
            candidates: Candidate POI list
            distance_threshold: Maximum coordinate difference to consider as duplicate
            
        Returns:
            List of candidates with duplicates removed
        """
        filtered_candidates = []
        
        for candidate in candidates:
            is_duplicate = False
            candidate_coords = candidate.get("coordinates", {})
            candidate_lat = candidate_coords.get("lat")
            candidate_lng = candidate_coords.get("lng")
            candidate_name = candidate.get("name", "").lower()
            
            if candidate_lat is None or candidate_lng is None:
                continue
                
            for existing_poi in existing_pois:
                existing_coords = existing_poi.get("coordinates", {})
                existing_lat = existing_coords.get("lat")
                existing_lng = existing_coords.get("lng")
                existing_name = existing_poi.get("name", "").lower()
                
                if existing_lat is None or existing_lng is None:
                    continue
                
                # Check coordinate proximity
                lat_diff = abs(candidate_lat - existing_lat)
                lng_diff = abs(candidate_lng - existing_lng)
                
                if lat_diff < distance_threshold and lng_diff < distance_threshold:
                    is_duplicate = True
                    logging.debug(f"Duplicate found (coordinates): {candidate_name} vs {existing_name}")
                    break
                    
                # Check name similarity (simple check)
                if candidate_name and existing_name:
                    if candidate_name in existing_name or existing_name in candidate_name:
                        is_duplicate = True
                        logging.debug(f"Duplicate found (name): {candidate_name} vs {existing_name}")
                        break
                        
            if not is_duplicate:
                filtered_candidates.append(candidate)
                
        return filtered_candidates
    
    def _verify_expansion(self, updated_data: Dict[str, Any]) -> Dict[str, Any]:
        """Verify the expanded POI data integrity."""
        verification_result = {
            "coordinate_validation": {"passed": 0, "failed": 0, "errors": []},
            "data_quality": {"passed": 0, "failed": 0, "errors": []},
            "category_balance": {},
            "total_pois": len(updated_data.get("pois", []))
        }
        
        coordinate_validator = CoordinateValidator(self.config.coordinate_bounds)
        quality_validator = DataQualityValidator(self.config.required_fields)
        
        category_counts = {}
        
        for poi in updated_data.get("pois", []):
            # Coordinate validation
            if coordinate_validator.validate_poi_coordinates(poi):
                verification_result["coordinate_validation"]["passed"] += 1
            else:
                verification_result["coordinate_validation"]["failed"] += 1
                verification_result["coordinate_validation"]["errors"].append(
                    f"Invalid coordinates: {poi.get('name', 'Unknown')}"
                )
                
            # Data quality validation
            is_valid, errors = quality_validator.validate_poi(poi)
            if is_valid:
                verification_result["data_quality"]["passed"] += 1
            else:
                verification_result["data_quality"]["failed"] += 1
                verification_result["data_quality"]["errors"].extend(
                    [f"{poi.get('name', 'Unknown')}: {error}" for error in errors]
                )
                
            # Category counting
            category = poi.get("category")
            category_counts[category] = category_counts.get(category, 0) + 1
            
        verification_result["category_balance"] = category_counts
        
        return verification_result
    
    def _increment_version(self, current_version: str) -> str:
        """Increment version number."""
        try:
            parts = current_version.split(".")
            if len(parts) >= 2:
                parts[1] = str(int(parts[1]) + 1)
                return ".".join(parts)
            else:
                return "2.0.0"
        except (ValueError, IndexError):
            return "2.0.0"
    
    def rollback(self, backup_path: str) -> bool:
        """Rollback to a previous backup."""
        return self.backup_manager.restore_backup(backup_path, self.config.current_pois_path)
    
    def list_backups(self) -> List[str]:
        """List available backups."""
        return self.backup_manager.list_backups()


def main():
    """Main entry point for the POI expansion system."""
    parser = argparse.ArgumentParser(description="Miyakojima POI Expansion System")
    parser.add_argument(
        "--dry-run", 
        action="store_true", 
        help="Show what would be done without making changes"
    )
    parser.add_argument(
        "--target-total", 
        type=int, 
        default=50, 
        help="Target total number of POIs (default: 50)"
    )
    parser.add_argument(
        "--rollback", 
        type=str, 
        help="Rollback to specified backup file"
    )
    parser.add_argument(
        "--list-backups", 
        action="store_true", 
        help="List available backup files"
    )
    parser.add_argument(
        "--config-file",
        type=str,
        help="Custom configuration file path"
    )
    
    args = parser.parse_args()
    
    # Initialize configuration
    config = ExpansionConfig()
    config.target_total_pois = args.target_total
    config.pois_to_add = config.target_total_pois - config.current_pois_count
    
    # Initialize system
    expansion_system = POIExpansionSystem(config)
    
    try:
        if args.list_backups:
            # List backups
            backups = expansion_system.list_backups()
            if backups:
                print("Available backups:")
                for backup in backups:
                    print(f"  {backup}")
            else:
                print("No backups found.")
                
        elif args.rollback:
            # Rollback operation
            print(f"Rolling back to: {args.rollback}")
            success = expansion_system.rollback(args.rollback)
            if success:
                print("Rollback completed successfully.")
            else:
                print("Rollback failed. Check logs for details.")
                
        else:
            # Expansion operation
            print(f"Starting POI expansion (target: {args.target_total} POIs)")
            if args.dry_run:
                print("DRY RUN MODE - No changes will be made")
                
            result = expansion_system.expand_pois(dry_run=args.dry_run)
            
            if result["success"]:
                print("\n=== Expansion Results ===")
                if result["dry_run"]:
                    print(f"Would add: {result['would_add_count']} POIs")
                    print(f"Would total: {result['would_be_total']} POIs")
                    print(f"Current distribution: {result['current_distribution']}")
                    print(f"Selection distribution: {result['selection_distribution']}")
                    print("\nPreview of selected POIs:")
                    for poi in result.get('selected_pois', []):
                        print(f"  - {poi['name']} ({poi['category']})")
                else:
                    print(f"Added: {result['added_count']} POIs")
                    print(f"New total: {result['new_total']} POIs")
                    print(f"Backup created: {result['backup_path']}")
                    print(f"Original distribution: {result['current_distribution']}")
                    print(f"Added distribution: {result['selection_distribution']}")
                    
                    verification = result.get("verification", {})
                    print(f"\n=== Verification Results ===")
                    print(f"Total POIs: {verification.get('total_pois', 'Unknown')}")
                    print(f"Coordinate validation: {verification.get('coordinate_validation', {})}")
                    print(f"Data quality: {verification.get('data_quality', {})}")
                    print(f"Final category balance: {verification.get('category_balance', {})}")
                    
            else:
                print(f"Expansion failed: {result.get('error', 'Unknown error')}")
                sys.exit(1)
                
    except KeyboardInterrupt:
        print("\nOperation cancelled by user.")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        logging.error(f"Unexpected error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()