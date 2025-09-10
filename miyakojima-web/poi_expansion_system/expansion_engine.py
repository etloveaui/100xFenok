"""
Expansion Engine for POI Expansion System.

Implements Single Responsibility Principle by handling only expansion logic.
Orchestrates phased POI database growth with quality controls.
"""

import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum
import random

from .interfaces import (
    IExpansionStrategy, POIRecord, ExpansionPhase, 
    IConfigManager, IDataValidator, ValidationResult
)


@dataclass
class ExpansionPlan:
    """Plan for POI database expansion."""
    phase: ExpansionPhase
    current_count: int
    target_count: int
    candidates_needed: int
    category_targets: Dict[str, int]
    priority_categories: List[str]


class CategoryBalanceStrategy(Enum):
    """Strategies for balancing POI categories."""
    PROPORTIONAL = "proportional"  # Maintain current proportions
    UNIFORM = "uniform"            # Equal distribution
    PRIORITY_BASED = "priority"    # Focus on priority categories


class ExpansionEngine(IExpansionStrategy):
    """
    Intelligent POI database expansion engine.
    
    Features:
    - Phased expansion with configurable targets
    - Category balancing and distribution
    - Quality-based candidate selection
    - Geographic distribution optimization
    - Rollback capabilities via backup integration
    """
    
    def __init__(self, config_manager: IConfigManager, validator: IDataValidator):
        self.config = config_manager
        self.validator = validator
        self.logger = logging.getLogger(__name__)
        
        # Expansion configuration
        self.expansion_config = self.config.get_config('expansion_phases', {})
        self.categories = self.config.get_config('categories', {})
        
        # Selection parameters
        self.quality_threshold = 0.7
        self.max_distance_km = 50.0  # Max distance between POIs for diversity
        
    def create_expansion_plan(self, current_pois: List[POIRecord], phase: ExpansionPhase) -> ExpansionPlan:
        """
        Create detailed expansion plan for specified phase.
        
        Args:
            current_pois: Currently active POI records
            phase: Target expansion phase
        
        Returns:
            ExpansionPlan with detailed expansion strategy
        """
        current_count = len(current_pois)
        
        # Get phase configuration
        phase_config = self.expansion_config.get(phase.value.replace('_to_', '_'))
        if not phase_config:
            target_count = self._get_default_target(phase)
        else:
            target_count = phase_config['target']
        
        candidates_needed = target_count - current_count
        
        # Analyze current category distribution
        current_distribution = self._analyze_category_distribution(current_pois)
        
        # Calculate target distribution
        category_targets = self._calculate_category_targets(
            current_distribution, 
            candidates_needed,
            CategoryBalanceStrategy.PROPORTIONAL
        )
        
        # Determine priority categories (underrepresented ones)
        priority_categories = self._identify_priority_categories(current_distribution, category_targets)
        
        plan = ExpansionPlan(
            phase=phase,
            current_count=current_count,
            target_count=target_count,
            candidates_needed=candidates_needed,
            category_targets=category_targets,
            priority_categories=priority_categories
        )
        
        self.logger.info(f"Created expansion plan: {current_count} → {target_count} POIs ({candidates_needed} new)")
        return plan
    
    def select_candidates(self, 
                         source_data: List[POIRecord], 
                         current_data: List[POIRecord],
                         target_count: int) -> List[POIRecord]:
        """
        Select optimal POI candidates for expansion.
        
        Args:
            source_data: Available POI candidates
            current_data: Currently active POIs
            target_count: Target total POI count
        
        Returns:
            Selected POI candidates for addition
        """
        candidates_needed = target_count - len(current_data)
        
        if candidates_needed <= 0:
            return []
        
        # Filter out existing POIs
        current_ids = {poi.id for poi in current_data}
        available_candidates = [
            poi for poi in source_data 
            if poi.id not in current_ids
        ]
        
        if len(available_candidates) < candidates_needed:
            self.logger.warning(f"Only {len(available_candidates)} candidates available, need {candidates_needed}")
        
        # Quality filtering
        quality_candidates = self._filter_by_quality(available_candidates)
        
        # Geographic diversity filtering
        diverse_candidates = self._ensure_geographic_diversity(quality_candidates, current_data)
        
        # Category balancing
        balanced_candidates = self._select_balanced_candidates(
            diverse_candidates, 
            current_data,
            candidates_needed
        )
        
        # Final selection with ranking
        selected = self._rank_and_select_final(balanced_candidates, candidates_needed)
        
        self.logger.info(f"Selected {len(selected)} candidates from {len(source_data)} available")
        return selected
    
    def balance_categories(self, candidates: List[POIRecord]) -> List[POIRecord]:
        """
        Balance POI distribution across categories.
        
        Args:
            candidates: POI candidates to balance
        
        Returns:
            Balanced selection of POI candidates
        """
        if not candidates:
            return candidates
        
        # Group by category
        category_groups = {}
        for poi in candidates:
            if poi.category not in category_groups:
                category_groups[poi.category] = []
            category_groups[poi.category].append(poi)
        
        # Calculate target per category
        target_per_category = len(candidates) // len(category_groups)
        remainder = len(candidates) % len(category_groups)
        
        balanced_selection = []
        
        # Select from each category
        for i, (category, pois) in enumerate(category_groups.items()):
            # Add extra POI to first few categories for remainder
            target = target_per_category + (1 if i < remainder else 0)
            
            # Sort by quality score and select top candidates
            sorted_pois = sorted(pois, key=self._calculate_poi_score, reverse=True)
            selected = sorted_pois[:target]
            
            balanced_selection.extend(selected)
        
        self.logger.info(f"Balanced {len(candidates)} candidates across {len(category_groups)} categories")
        return balanced_selection
    
    def execute_expansion(self, 
                         current_pois: List[POIRecord],
                         expansion_plan: ExpansionPlan,
                         source_candidates: List[POIRecord]) -> List[POIRecord]:
        """
        Execute expansion according to plan.
        
        Args:
            current_pois: Current POI records
            expansion_plan: Expansion plan to execute
            source_candidates: Available candidate POIs
        
        Returns:
            Expanded POI list
        """
        try:
            # Select candidates according to plan
            selected_candidates = self.select_candidates(
                source_candidates,
                current_pois, 
                expansion_plan.target_count
            )
            
            # Validate all selected candidates
            validation_results = []
            valid_candidates = []
            
            for candidate in selected_candidates:
                result = self.validator.validate_poi_record(candidate)
                validation_results.append(result)
                
                if result.is_valid:
                    valid_candidates.append(candidate)
                else:
                    self.logger.warning(f"Invalid candidate {candidate.id}: {result.errors}")
            
            # Merge with current POIs
            expanded_pois = current_pois + valid_candidates
            
            # Final validation of complete set
            final_validation = self.validator.validate_poi_list(expanded_pois)
            
            if not final_validation.is_valid:
                self.logger.error(f"Final validation failed: {final_validation.errors}")
                return current_pois  # Return original on validation failure
            
            self.logger.info(
                f"Expansion completed: {len(current_pois)} → {len(expanded_pois)} POIs "
                f"({len(valid_candidates)}/{len(selected_candidates)} candidates validated)"
            )
            
            return expanded_pois
            
        except Exception as e:
            self.logger.error(f"Expansion execution failed: {e}")
            return current_pois
    
    def _get_default_target(self, phase: ExpansionPhase) -> int:
        """Get default target count for phase."""
        targets = {
            ExpansionPhase.PHASE_1: 50,
            ExpansionPhase.PHASE_2: 100,
            ExpansionPhase.PHASE_3: 175
        }
        return targets.get(phase, 50)
    
    def _analyze_category_distribution(self, pois: List[POIRecord]) -> Dict[str, int]:
        """Analyze current category distribution."""
        distribution = {}
        for poi in pois:
            distribution[poi.category] = distribution.get(poi.category, 0) + 1
        return distribution
    
    def _calculate_category_targets(self, 
                                  current_distribution: Dict[str, int],
                                  new_count: int,
                                  strategy: CategoryBalanceStrategy) -> Dict[str, int]:
        """Calculate target POI count per category."""
        targets = {}
        
        if strategy == CategoryBalanceStrategy.PROPORTIONAL:
            total_current = sum(current_distribution.values())
            
            if total_current == 0:
                # Equal distribution if no current POIs
                per_category = new_count // len(self.categories)
                remainder = new_count % len(self.categories)
                
                for i, category in enumerate(self.categories.keys()):
                    targets[category] = per_category + (1 if i < remainder else 0)
            else:
                # Maintain proportions
                for category, current_count in current_distribution.items():
                    proportion = current_count / total_current
                    targets[category] = int(new_count * proportion)
        
        elif strategy == CategoryBalanceStrategy.UNIFORM:
            per_category = new_count // len(self.categories)
            remainder = new_count % len(self.categories)
            
            for i, category in enumerate(self.categories.keys()):
                targets[category] = per_category + (1 if i < remainder else 0)
        
        return targets
    
    def _identify_priority_categories(self, 
                                    current_distribution: Dict[str, int],
                                    targets: Dict[str, int]) -> List[str]:
        """Identify categories that need prioritization."""
        priority_categories = []
        
        for category, target in targets.items():
            current = current_distribution.get(category, 0)
            if target > 0 and (current == 0 or current < target * 0.8):
                priority_categories.append(category)
        
        return priority_categories
    
    def _filter_by_quality(self, candidates: List[POIRecord]) -> List[POIRecord]:
        """Filter candidates by minimum quality threshold."""
        quality_candidates = []
        
        for candidate in candidates:
            result = self.validator.validate_poi_record(candidate)
            quality_score = result.metadata.get('quality_score', 0.0)
            
            if quality_score >= self.quality_threshold:
                quality_candidates.append(candidate)
        
        self.logger.info(f"Quality filter: {len(quality_candidates)}/{len(candidates)} candidates passed")
        return quality_candidates
    
    def _ensure_geographic_diversity(self, 
                                   candidates: List[POIRecord], 
                                   current_pois: List[POIRecord]) -> List[POIRecord]:
        """Ensure geographic diversity among candidates."""
        if not current_pois:
            return candidates
        
        # Get existing coordinates
        existing_coords = [
            (poi.coordinates['lat'], poi.coordinates['lng']) 
            for poi in current_pois
        ]
        
        diverse_candidates = []
        for candidate in candidates:
            candidate_coord = (candidate.coordinates['lat'], candidate.coordinates['lng'])
            
            # Check minimum distance to existing POIs
            min_distance = min(
                self._calculate_distance(candidate_coord, existing_coord)
                for existing_coord in existing_coords
            )
            
            # Accept if sufficiently far or if it's a different category
            if min_distance > 0.01 or not any(  # ~1km minimum or different category
                poi.category == candidate.category and
                self._calculate_distance(candidate_coord, (poi.coordinates['lat'], poi.coordinates['lng'])) < 0.005
                for poi in current_pois
            ):
                diverse_candidates.append(candidate)
        
        self.logger.info(f"Diversity filter: {len(diverse_candidates)}/{len(candidates)} candidates passed")
        return diverse_candidates
    
    def _select_balanced_candidates(self, 
                                  candidates: List[POIRecord],
                                  current_pois: List[POIRecord],
                                  needed_count: int) -> List[POIRecord]:
        """Select candidates with category balancing."""
        if len(candidates) <= needed_count:
            return candidates
        
        # Group by category
        category_groups = {}
        for candidate in candidates:
            if candidate.category not in category_groups:
                category_groups[candidate.category] = []
            category_groups[candidate.category].append(candidate)
        
        # Calculate current category counts
        current_counts = {}
        for poi in current_pois:
            current_counts[poi.category] = current_counts.get(poi.category, 0) + 1
        
        # Select balanced candidates
        selected = []
        remaining_needed = needed_count
        
        # Round-robin selection to maintain balance
        while remaining_needed > 0 and any(category_groups.values()):
            for category in list(category_groups.keys()):
                if remaining_needed <= 0 or not category_groups[category]:
                    continue
                
                # Sort by quality and select best
                category_groups[category].sort(key=self._calculate_poi_score, reverse=True)
                selected_candidate = category_groups[category].pop(0)
                selected.append(selected_candidate)
                remaining_needed -= 1
        
        return selected
    
    def _rank_and_select_final(self, candidates: List[POIRecord], count: int) -> List[POIRecord]:
        """Final ranking and selection of candidates."""
        # Sort by comprehensive score
        candidates.sort(key=self._calculate_comprehensive_score, reverse=True)
        
        # Select top candidates
        return candidates[:count]
    
    def _calculate_poi_score(self, poi: POIRecord) -> float:
        """Calculate basic quality score for POI."""
        score = 0.0
        
        # Rating contribution (40%)
        score += (poi.rating / 5.0) * 0.4
        
        # Description length contribution (20%)
        desc_score = min(len(poi.description) / 100.0, 1.0)
        score += desc_score * 0.2
        
        # Features count contribution (20%)
        features_score = min(len(poi.features) / 5.0, 1.0)
        score += features_score * 0.2
        
        # Completeness contribution (20%)
        completeness = 0.0
        if poi.tips:
            completeness += 0.25
        if poi.accessibility and poi.accessibility != "정보 없음":
            completeness += 0.25
        if len(poi.weather) >= 3:
            completeness += 0.25
        if poi.estimated_time and poi.estimated_time != "정보 없음":
            completeness += 0.25
        
        score += completeness * 0.2
        
        return score
    
    def _calculate_comprehensive_score(self, poi: POIRecord) -> float:
        """Calculate comprehensive score including validation results."""
        base_score = self._calculate_poi_score(poi)
        
        # Get validation score
        result = self.validator.validate_poi_record(poi)
        quality_score = result.metadata.get('quality_score', 0.0)
        
        # Combine scores (70% base, 30% validation)
        return base_score * 0.7 + quality_score * 0.3
    
    def _calculate_distance(self, coord1: tuple, coord2: tuple) -> float:
        """Calculate approximate distance between coordinates in degrees."""
        lat1, lng1 = coord1
        lat2, lng2 = coord2
        
        # Simple Euclidean distance for small areas like Miyakojima
        return ((lat2 - lat1) ** 2 + (lng2 - lng1) ** 2) ** 0.5