#!/usr/bin/env python3
"""
POI Expansion Generator - Miyakojima Web Platform
무손실 POI 데이터 확장 도구 (8 → 25 → 50 → 100 → 175)

작성: Claude Code with SuperClaude Framework
날짜: 2025-09-10
목적: 안전하고 체계적인 POI 데이터 확장
"""

import json
import os
import sys
import shutil
from datetime import datetime
from typing import Dict, List, Any, Optional
import hashlib
import logging

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('../log/poi_expansion.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class POIExpansionGenerator:
    """POI 데이터 단계별 확장 생성기"""
    
    def __init__(self, project_root: str):
        self.project_root = project_root
        self.data_dir = os.path.join(project_root, 'data')
        self.docs_dir = os.path.join(project_root, 'docs')
        self.backup_dir = os.path.join(project_root, 'backups')
        self.scripts_dir = os.path.join(project_root, 'scripts')
        
        # 확장 단계 정의
        self.expansion_phases = {
            1: {"target": 25, "description": "핵심 관광지 추가", "priority": "high"},
            2: {"target": 50, "description": "카테고리 균형 확장", "priority": "medium"}, 
            3: {"target": 100, "description": "숨겨진 명소 추가", "priority": "medium"},
            4: {"target": 175, "description": "완전 데이터베이스", "priority": "all"}
        }
        
        # 미야코지마 지역 경계 (위도, 경도)
        self.region_bounds = {
            'lat_min': 24.6, 'lat_max': 24.9,
            'lng_min': 125.1, 'lng_max': 125.4
        }
        
        logger.info(f"POI 확장 생성기 초기화: {project_root}")

    def load_current_poi_data(self) -> Dict[str, Any]:
        """현재 POI 데이터 로드"""
        try:
            poi_file = os.path.join(self.data_dir, 'miyakojima_pois.json')
            with open(poi_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            logger.info(f"현재 POI 데이터 로드: {data.get('totalPOIs', 'unknown')}개")
            return data
        except Exception as e:
            logger.error(f"현재 POI 데이터 로드 실패: {e}")
            return {}

    def load_source_database(self) -> Dict[str, Any]:
        """원본 175개 POI 데이터베이스 로드"""
        try:
            db_file = os.path.join(self.docs_dir, 'knowledge', 'miyakojima_database.json')
            with open(db_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            logger.info(f"원본 DB 로드: {data['poi_database']['total_count']}개 POI")
            return data
        except Exception as e:
            logger.error(f"원본 DB 로드 실패: {e}")
            return {}

    def extract_poi_from_database(self, database: Dict[str, Any]) -> List[Dict[str, Any]]:
        """데이터베이스에서 POI 리스트 추출 및 표준화"""
        extracted_pois = []
        
        try:
            # 주요 관광지 추출
            major_attractions = database.get('major_attractions', {})
            
            # 해변 (beaches)
            beaches = major_attractions.get('beaches', {})
            for beach_id, beach_data in beaches.items():
                poi = self.standardize_poi_data({
                    'id': f'beach_{beach_id}',
                    'name': beach_data.get('name', ''),
                    'nameEn': beach_data.get('english', ''),
                    'category': 'beaches',
                    'rating': self.parse_rating(beach_data.get('rating', '⭐⭐⭐⭐')),
                    'description': beach_data.get('description', ''),
                    'features': beach_data.get('activities', []) + beach_data.get('facilities', []),
                    'coordinates': self.generate_coordinates_near_miyakojima(),
                    'openHours': '24시간',
                    'cost': {'min': 0, 'max': int(beach_data.get('parking_fee', '0').replace(' JPY', '').replace(',', '').replace('무료', '0')), 'currency': 'JPY'},
                    'tips': beach_data.get('best_time', ''),
                    'accessibility': '차량 접근 가능',
                    'weather': {'sunny': '최적', 'cloudy': '좋음', 'rainy': '부적합'}
                })
                extracted_pois.append(poi)

            # 전망대 (viewpoints)
            viewpoints = major_attractions.get('viewpoints', {})
            for vp_id, vp_data in viewpoints.items():
                poi = self.standardize_poi_data({
                    'id': f'viewpoint_{vp_id}',
                    'name': vp_data.get('name', ''),
                    'category': 'nature',
                    'rating': 4.5,
                    'description': vp_data.get('view', ''),
                    'features': vp_data.get('features', []),
                    'coordinates': self.generate_coordinates_near_miyakojima(),
                    'openHours': '24시간',
                    'cost': {'min': 0, 'max': 0, 'currency': 'JPY'},
                    'tips': vp_data.get('best_condition', ''),
                    'accessibility': '도보 접근',
                    'weather': {'sunny': '최적', 'cloudy': '좋음', 'rainy': '주의'}
                })
                extracted_pois.append(poi)

            # 독특한 장소 (unique_spots)
            unique_spots = major_attractions.get('unique_spots', {})
            for us_id, us_data in unique_spots.items():
                poi = self.standardize_poi_data({
                    'id': f'unique_{us_id}',
                    'name': us_data.get('name', ''),
                    'category': 'culture',
                    'rating': 4.7,
                    'description': us_data.get('description', ''),
                    'coordinates': us_data.get('coordinates', self.generate_coordinates_near_miyakojima()),
                    'openHours': '일출-일몰',
                    'cost': {'min': 0, 'max': 0, 'currency': 'JPY'},
                    'tips': us_data.get('special', ''),
                    'accessibility': us_data.get('access', ''),
                    'weather': {'sunny': '최적', 'cloudy': '좋음', 'rainy': '부적합'}
                })
                extracted_pois.append(poi)

            # 식당 (dining_spots)
            dining_spots = database.get('dining_spots', {})
            for category, restaurants in dining_spots.items():
                if isinstance(restaurants, dict):
                    for rest_id, rest_data in restaurants.items():
                        if isinstance(rest_data, dict):
                            poi = self.standardize_poi_data({
                                'id': f'dining_{rest_id}',
                                'name': rest_data.get('name', ''),
                                'category': 'restaurants',
                                'rating': 4.3,
                                'description': rest_data.get('specialty', ''),
                                'coordinates': rest_data.get('coordinates', self.generate_coordinates_near_miyakojima()),
                                'openHours': rest_data.get('hours', '11:00-21:00'),
                                'cost': self.parse_price_range(rest_data.get('price', '1000-2000 JPY')),
                                'tips': f"예약 {rest_data.get('reservation', '권장')}",
                                'accessibility': '차량 접근 가능',
                                'weather': {'sunny': '좋음', 'cloudy': '좋음', 'rainy': '좋음'}
                            })
                            extracted_pois.append(poi)

            logger.info(f"데이터베이스에서 {len(extracted_pois)}개 POI 추출")
            return extracted_pois

        except Exception as e:
            logger.error(f"POI 추출 실패: {e}")
            return []

    def standardize_poi_data(self, poi: Dict[str, Any]) -> Dict[str, Any]:
        """POI 데이터 표준화"""
        standardized = {
            'id': poi.get('id', f'poi_{hash(poi.get("name", "unknown"))}'),
            'name': poi.get('name', ''),
            'nameEn': poi.get('nameEn', poi.get('name', '')),
            'category': poi.get('category', 'others'),
            'rating': float(poi.get('rating', 4.0)),
            'coordinates': poi.get('coordinates', self.generate_coordinates_near_miyakojima()),
            'description': poi.get('description', ''),
            'features': poi.get('features', []),
            'openHours': poi.get('openHours', '09:00-18:00'),
            'estimatedTime': poi.get('estimatedTime', '1-2시간'),
            'cost': poi.get('cost', {'min': 0, 'max': 0, 'currency': 'JPY'}),
            'tips': poi.get('tips', ''),
            'accessibility': poi.get('accessibility', '일반'),
            'weather': poi.get('weather', {'sunny': '좋음', 'cloudy': '좋음', 'rainy': '주의'})
        }
        
        # 좌표 검증
        if isinstance(standardized['coordinates'], list) and len(standardized['coordinates']) == 2:
            standardized['coordinates'] = {
                'lat': standardized['coordinates'][0],
                'lng': standardized['coordinates'][1]
            }
        elif isinstance(standardized['coordinates'], dict):
            if 'lat' not in standardized['coordinates'] or 'lng' not in standardized['coordinates']:
                standardized['coordinates'] = self.generate_coordinates_near_miyakojima()
        else:
            standardized['coordinates'] = self.generate_coordinates_near_miyakojima()

        return standardized

    def parse_rating(self, rating_str: str) -> float:
        """별점 문자열을 숫자로 변환"""
        if isinstance(rating_str, (int, float)):
            return float(rating_str)
        
        if '⭐' in rating_str:
            return float(rating_str.count('⭐'))
        
        # 숫자 추출
        import re
        numbers = re.findall(r'\d+\.?\d*', str(rating_str))
        return float(numbers[0]) if numbers else 4.0

    def parse_price_range(self, price_str: str) -> Dict[str, Any]:
        """가격 문자열 파싱"""
        import re
        
        if '무료' in price_str or 'free' in price_str.lower():
            return {'min': 0, 'max': 0, 'currency': 'JPY'}
        
        # 숫자와 통화 추출
        numbers = re.findall(r'\d+', str(price_str))
        currency = 'JPY' if 'JPY' in price_str else 'JPY'
        
        if len(numbers) >= 2:
            return {'min': int(numbers[0]), 'max': int(numbers[1]), 'currency': currency}
        elif len(numbers) == 1:
            price = int(numbers[0])
            return {'min': price, 'max': price * 2, 'currency': currency}
        else:
            return {'min': 0, 'max': 1000, 'currency': 'JPY'}

    def generate_coordinates_near_miyakojima(self) -> Dict[str, float]:
        """미야코지마 지역 내 임의 좌표 생성"""
        import random
        
        lat = round(random.uniform(self.region_bounds['lat_min'], self.region_bounds['lat_max']), 6)
        lng = round(random.uniform(self.region_bounds['lng_min'], self.region_bounds['lng_max']), 6)
        
        return {'lat': lat, 'lng': lng}

    def create_backup(self, phase: int) -> str:
        """현재 상태 백업"""
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            backup_dir = os.path.join(self.backup_dir, f'phase_{phase}_{timestamp}')
            os.makedirs(backup_dir, exist_ok=True)
            
            # data 폴더 백업
            if os.path.exists(self.data_dir):
                shutil.copytree(self.data_dir, os.path.join(backup_dir, 'data'))
            
            # 백업 메타데이터
            metadata = {
                'timestamp': timestamp,
                'phase': phase,
                'backup_path': backup_dir,
                'original_data_hash': self.calculate_data_hash()
            }
            
            with open(os.path.join(backup_dir, 'metadata.json'), 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)
            
            logger.info(f"백업 생성: {backup_dir}")
            return backup_dir
            
        except Exception as e:
            logger.error(f"백업 생성 실패: {e}")
            return ""

    def calculate_data_hash(self) -> str:
        """현재 데이터 해시 계산"""
        try:
            poi_file = os.path.join(self.data_dir, 'miyakojima_pois.json')
            if os.path.exists(poi_file):
                with open(poi_file, 'rb') as f:
                    return hashlib.md5(f.read()).hexdigest()
            return ""
        except Exception as e:
            logger.error(f"해시 계산 실패: {e}")
            return ""

    def select_pois_for_phase(self, all_pois: List[Dict[str, Any]], current_pois: List[Dict[str, Any]], target_count: int) -> List[Dict[str, Any]]:
        """단계별 POI 선별"""
        # 현재 POI ID 목록
        current_ids = {poi.get('id', '') for poi in current_pois}
        
        # 새로 추가할 POI 필터링
        available_pois = [poi for poi in all_pois if poi.get('id', '') not in current_ids]
        
        # 카테고리별 균형 유지
        category_balance = {
            'beaches': 0.3,      # 30%
            'restaurants': 0.25,  # 25%
            'nature': 0.2,       # 20%
            'culture': 0.15,     # 15%
            'activities': 0.1    # 10%
        }
        
        selected_pois = []
        additional_needed = target_count - len(current_pois)
        
        for category, ratio in category_balance.items():
            category_pois = [poi for poi in available_pois if poi.get('category') == category]
            category_target = int(additional_needed * ratio)
            
            # 평점 순 정렬 후 선별
            category_pois.sort(key=lambda x: x.get('rating', 0), reverse=True)
            selected_pois.extend(category_pois[:category_target])
        
        # 부족한 개수만큼 평점 높은 POI로 보완
        if len(selected_pois) < additional_needed:
            remaining_pois = [poi for poi in available_pois if poi not in selected_pois]
            remaining_pois.sort(key=lambda x: x.get('rating', 0), reverse=True)
            selected_pois.extend(remaining_pois[:additional_needed - len(selected_pois)])
        
        logger.info(f"Phase 선별 완료: {len(selected_pois)}개 POI 추가")
        return selected_pois[:additional_needed]

    def generate_phase_data(self, phase: int) -> bool:
        """특정 단계의 POI 데이터 생성"""
        try:
            logger.info(f"=== Phase {phase} 데이터 생성 시작 ===")
            
            # 백업 생성
            backup_dir = self.create_backup(phase)
            if not backup_dir:
                logger.error("백업 생성 실패 - 작업 중단")
                return False
            
            # 현재 데이터 로드
            current_data = self.load_current_poi_data()
            current_pois = current_data.get('pois', [])
            
            # 원본 데이터베이스 로드
            source_db = self.load_source_database()
            all_source_pois = self.extract_poi_from_database(source_db)
            
            if not all_source_pois:
                logger.error("원본 POI 데이터 추출 실패")
                return False
            
            # 목표 개수
            target_count = self.expansion_phases[phase]['target']
            
            # Phase별 POI 선별
            additional_pois = self.select_pois_for_phase(all_source_pois, current_pois, target_count)
            
            # 새로운 데이터 구성
            new_data = current_data.copy()
            new_data['pois'] = current_pois + additional_pois
            new_data['totalPOIs'] = len(new_data['pois'])
            new_data['lastUpdated'] = datetime.now().isoformat() + 'Z'
            new_data['version'] = f"2.{phase}.0"
            new_data['expansionPhase'] = phase
            
            # 파일 저장
            output_file = os.path.join(self.data_dir, 'miyakojima_pois.json')
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(new_data, f, indent=2, ensure_ascii=False)
            
            # 검증
            if self.validate_poi_data(new_data):
                logger.info(f"✅ Phase {phase} 완료: {current_data.get('totalPOIs', 0)} → {new_data['totalPOIs']}개")
                return True
            else:
                logger.error("데이터 검증 실패 - 롤백 필요")
                return False
                
        except Exception as e:
            logger.error(f"Phase {phase} 생성 실패: {e}")
            return False

    def validate_poi_data(self, data: Dict[str, Any]) -> bool:
        """POI 데이터 검증"""
        try:
            # 기본 구조 검증
            required_fields = ['version', 'lastUpdated', 'totalPOIs', 'pois']
            for field in required_fields:
                if field not in data:
                    logger.error(f"필수 필드 누락: {field}")
                    return False
            
            # POI 개별 검증
            pois = data.get('pois', [])
            if len(pois) != data.get('totalPOIs', 0):
                logger.error(f"POI 개수 불일치: {len(pois)} vs {data['totalPOIs']}")
                return False
            
            # 각 POI 필수 필드 확인
            poi_required_fields = ['id', 'name', 'category', 'coordinates']
            for i, poi in enumerate(pois):
                for field in poi_required_fields:
                    if field not in poi:
                        logger.error(f"POI {i} 필수 필드 누락: {field}")
                        return False
                
                # 좌표 유효성 검사
                coords = poi.get('coordinates', {})
                if not isinstance(coords, dict) or 'lat' not in coords or 'lng' not in coords:
                    logger.error(f"POI {i} 좌표 형식 오류")
                    return False
                
                # 미야코지마 지역 내 좌표인지 확인
                lat, lng = coords['lat'], coords['lng']
                if not (self.region_bounds['lat_min'] <= lat <= self.region_bounds['lat_max'] and
                       self.region_bounds['lng_min'] <= lng <= self.region_bounds['lng_max']):
                    logger.warning(f"POI {i} 좌표가 미야코지마 지역 외부: {lat}, {lng}")
            
            logger.info("✅ 데이터 검증 통과")
            return True
            
        except Exception as e:
            logger.error(f"데이터 검증 실패: {e}")
            return False

    def rollback_to_backup(self, backup_dir: str) -> bool:
        """백업으로 롤백"""
        try:
            logger.info(f"롤백 시작: {backup_dir}")
            
            backup_data_dir = os.path.join(backup_dir, 'data')
            if not os.path.exists(backup_data_dir):
                logger.error("백업 데이터 디렉토리 없음")
                return False
            
            # 현재 data 디렉토리 백업 (롤백 전)
            current_backup = os.path.join(self.backup_dir, f'before_rollback_{datetime.now().strftime("%Y%m%d_%H%M%S")}')
            if os.path.exists(self.data_dir):
                shutil.copytree(self.data_dir, current_backup)
            
            # data 디렉토리 복원
            if os.path.exists(self.data_dir):
                shutil.rmtree(self.data_dir)
            shutil.copytree(backup_data_dir, self.data_dir)
            
            logger.info("✅ 롤백 완료")
            return True
            
        except Exception as e:
            logger.error(f"롤백 실패: {e}")
            return False

    def run_expansion(self, target_phase: int = 1) -> bool:
        """POI 확장 실행"""
        try:
            logger.info(f"🚀 POI 확장 시작: Phase {target_phase}")
            
            # 디렉토리 생성
            os.makedirs(self.backup_dir, exist_ok=True)
            
            # Phase 실행
            if self.generate_phase_data(target_phase):
                logger.info(f"🎉 Phase {target_phase} 확장 성공!")
                
                # 성공 메타데이터 저장
                success_metadata = {
                    'phase': target_phase,
                    'timestamp': datetime.now().isoformat(),
                    'target_pois': self.expansion_phases[target_phase]['target'],
                    'status': 'success'
                }
                
                with open(os.path.join(self.scripts_dir, f'phase_{target_phase}_success.json'), 'w') as f:
                    json.dump(success_metadata, f, indent=2)
                
                return True
            else:
                logger.error(f"❌ Phase {target_phase} 확장 실패")
                return False
                
        except Exception as e:
            logger.error(f"확장 실행 실패: {e}")
            return False


def main():
    """메인 실행 함수"""
    # 프로젝트 루트 경로 (스크립트 기준 상위 디렉토리)
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    
    # 명령행 인자 처리
    target_phase = 1
    if len(sys.argv) > 1:
        try:
            target_phase = int(sys.argv[1])
            if target_phase not in [1, 2, 3, 4]:
                print("오류: Phase는 1, 2, 3, 4 중 하나여야 합니다.")
                sys.exit(1)
        except ValueError:
            print("오류: Phase는 숫자여야 합니다.")
            sys.exit(1)
    
    # 확장 실행
    generator = POIExpansionGenerator(project_root)
    
    print(f"\n🌟 미야코지마 POI 확장 도구 v1.0")
    print(f"📍 대상: Phase {target_phase} ({generator.expansion_phases[target_phase]['target']}개 POI)")
    print(f"🎯 설명: {generator.expansion_phases[target_phase]['description']}")
    
    confirm = input(f"\nPhase {target_phase} 확장을 시작하시겠습니까? (y/N): ")
    if confirm.lower() != 'y':
        print("작업이 취소되었습니다.")
        sys.exit(0)
    
    success = generator.run_expansion(target_phase)
    
    if success:
        print(f"\n✅ Phase {target_phase} 확장 완료!")
        print(f"📊 결과 확인: {os.path.join(project_root, 'data', 'miyakojima_pois.json')}")
        print(f"💾 백업 위치: {generator.backup_dir}")
    else:
        print(f"\n❌ Phase {target_phase} 확장 실패")
        print("로그를 확인하여 문제를 해결하세요.")
        sys.exit(1)


if __name__ == "__main__":
    main()