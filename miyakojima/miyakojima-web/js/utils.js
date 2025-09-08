// 미야코지마 웹 플랫폼 - 유틸리티 함수
// Miyakojima Web Platform - Utility Functions

/**
 * 로깅 유틸리티
 */
const Logger = {
    log: (message, data = null) => {
        if (CONFIG.DEBUG.ENABLED && CONFIG.DEBUG.LOG_LEVEL === 'debug') {
            console.log(`🏝️ ${message}`, data || '');
        }
    },
    
    info: (message, data = null) => {
        if (CONFIG.DEBUG.ENABLED && ['debug', 'info'].includes(CONFIG.DEBUG.LOG_LEVEL)) {
            console.info(`ℹ️ ${message}`, data || '');
        }
    },
    
    warn: (message, data = null) => {
        if (CONFIG.DEBUG.ENABLED && ['debug', 'info', 'warn'].includes(CONFIG.DEBUG.LOG_LEVEL)) {
            console.warn(`⚠️ ${message}`, data || '');
        }
    },
    
    error: (message, data = null) => {
        console.error(`❌ ${message}`, data || '');
    }
};

/**
 * 날짜 및 시간 유틸리티
 */
const DateUtils = {
    // 현재 날짜가 여행 기간인지 확인
    isInTripPeriod: () => {
        const now = new Date();
        const start = new Date(CONFIG.TRIP_INFO.START_DATE);
        const end = new Date(CONFIG.TRIP_INFO.END_DATE);
        return now >= start && now <= end;
    },
    
    // 여행 몇 일차인지 계산
    getTripDay: () => {
        if (!DateUtils.isInTripPeriod()) return 0;
        
        const now = new Date();
        const start = new Date(CONFIG.TRIP_INFO.START_DATE);
        const diffTime = Math.abs(now - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return Math.min(diffDays, CONFIG.TRIP_INFO.TOTAL_DAYS);
    },
    
    // 날짜 포맷팅
    formatDate: (date, format = CONFIG.UI.DATE_FORMAT) => {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        
        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day);
    },
    
    // 시간 포맷팅
    formatTime: (date, format = CONFIG.UI.TIME_FORMAT) => {
        const d = new Date(date);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        
        return format
            .replace('HH', hours)
            .replace('mm', minutes);
    },
    
    // 상대적 시간 표시 (예: "3분 전", "1시간 전")
    getRelativeTime: (date) => {
        const now = new Date();
        const diff = now - new Date(date);
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (minutes < 1) return '방금 전';
        if (minutes < 60) return `${minutes}분 전`;
        if (hours < 24) return `${hours}시간 전`;
        return `${days}일 전`;
    }
};

/**
 * 통화 및 숫자 유틸리티
 */
const NumberUtils = {
    // 통화 포맷팅 (JPY)
    formatCurrency: (amount, currency = 'JPY') => {
        const symbols = { JPY: '¥', KRW: '₩' };
        const formatted = new Intl.NumberFormat('ko-KR').format(Math.round(amount));
        return `${symbols[currency] || ''}${formatted}`;
    },
    
    // JPY를 KRW로 환전
    convertJPYToKRW: (amount, rate = null) => {
        const exchangeRate = rate || CONFIG.BUDGET.EXCHANGE_RATE_DEFAULT;
        return Math.round(amount * exchangeRate);
    },
    
    // 퍼센티지 계산
    calculatePercentage: (value, total) => {
        if (total === 0) return 0;
        return Math.round((value / total) * 100);
    },
    
    // 숫자를 간략하게 표시 (1K, 1M 등)
    formatCompactNumber: (num) => {
        if (num < 1000) return num.toString();
        if (num < 1000000) return (num / 1000).toFixed(1) + 'K';
        return (num / 1000000).toFixed(1) + 'M';
    }
};

/**
 * 거리 및 위치 유틸리티
 */
const LocationUtils = {
    // 두 점 사이의 거리 계산 (Haversine 공식)
    calculateDistance: (lat1, lng1, lat2, lng2) => {
        const R = 6371000; // 지구 반지름 (미터)
        const dLat = LocationUtils.toRadians(lat2 - lat1);
        const dLng = LocationUtils.toRadians(lng2 - lng1);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(LocationUtils.toRadians(lat1)) * Math.cos(LocationUtils.toRadians(lat2)) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // 미터 단위
    },
    
    // 도를 라디안으로 변환
    toRadians: (degrees) => {
        return degrees * (Math.PI / 180);
    },
    
    // 거리를 읽기 쉽게 포맷팅
    formatDistance: (meters) => {
        if (meters < 1000) return `${Math.round(meters)}m`;
        return `${(meters / 1000).toFixed(1)}km`;
    },
    
    // 미야코지마 경계 내부인지 확인
    isInMiyakojima: (lat, lng) => {
        const bounds = CONFIG.LOCATION.BOUNDS;
        return lat >= bounds.south && lat <= bounds.north &&
               lng >= bounds.west && lng <= bounds.east;
    },
    
    // 이동 시간 예측 (단순 계산)
    estimateTravelTime: (distanceMeters, mode = 'car') => {
        const speeds = {
            walking: 5,   // 5km/h
            bicycle: 15,  // 15km/h
            car: 40,      // 40km/h (미야코지마 평균)
            bus: 25       // 25km/h
        };
        
        const distanceKm = distanceMeters / 1000;
        const timeHours = distanceKm / (speeds[mode] || speeds.car);
        return Math.round(timeHours * 60); // 분 단위 반환
    }
};

/**
 * DOM 유틸리티
 */
const DOMUtils = {
    // 요소 선택
    $: (selector) => document.querySelector(selector),
    $$: (selector) => document.querySelectorAll(selector),
    
    // 요소 생성
    createElement: (tag, className = '', innerHTML = '') => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (innerHTML) element.innerHTML = innerHTML;
        return element;
    },
    
    // 클래스 토글
    toggleClass: (element, className) => {
        element.classList.toggle(className);
    },
    
    // 스무스 스크롤
    scrollTo: (element, behavior = 'smooth') => {
        element.scrollIntoView({ behavior });
    },
    
    // 요소가 뷰포트에 보이는지 확인
    isInViewport: (element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.left >= 0 &&
               rect.bottom <= window.innerHeight &&
               rect.right <= window.innerWidth;
    },
    
    // 애니메이션 대기
    waitForAnimation: (duration = CONFIG.UI.ANIMATION_DURATION) => {
        return new Promise(resolve => setTimeout(resolve, duration));
    }
};

/**
 * 로컬 스토리지 유틸리티
 */
const StorageUtils = {
    // 데이터 저장
    set: (key, data, expiration = null) => {
        try {
            const item = {
                data: data,
                timestamp: Date.now(),
                expiration: expiration
            };
            localStorage.setItem(CONFIG.STORAGE.PREFIX + key, JSON.stringify(item));
            return true;
        } catch (error) {
            Logger.error('저장 실패:', error);
            return false;
        }
    },
    
    // 데이터 로드
    get: (key) => {
        try {
            const item = localStorage.getItem(CONFIG.STORAGE.PREFIX + key);
            if (!item) return null;
            
            const parsed = JSON.parse(item);
            
            // 만료 확인
            if (parsed.expiration && Date.now() > parsed.expiration) {
                StorageUtils.remove(key);
                return null;
            }
            
            return parsed.data;
        } catch (error) {
            Logger.error('로드 실패:', error);
            return null;
        }
    },
    
    // 데이터 제거
    remove: (key) => {
        localStorage.removeItem(CONFIG.STORAGE.PREFIX + key);
    },
    
    // 모든 앱 데이터 제거
    clear: () => {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(CONFIG.STORAGE.PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    },
    
    // 만료된 캐시 정리
    cleanExpired: () => {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(CONFIG.STORAGE.PREFIX)) {
                const item = localStorage.getItem(key);
                try {
                    const parsed = JSON.parse(item);
                    if (parsed.expiration && Date.now() > parsed.expiration) {
                        localStorage.removeItem(key);
                    }
                } catch (error) {
                    // 잘못된 형식의 데이터 제거
                    localStorage.removeItem(key);
                }
            }
        });
    }
};

/**
 * 네트워크 유틸리티
 */
const NetworkUtils = {
    // 온라인 상태 확인
    isOnline: () => navigator.onLine,
    
    // 네트워크 속도 추정 (연결 타입 기반)
    getConnectionType: () => {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return connection ? connection.effectiveType || 'unknown' : 'unknown';
    },
    
    // API 호출 재시도 로직
    retryRequest: async (requestFn, maxRetries = 3, delay = 1000) => {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await requestFn();
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
            }
        }
    },
    
    // 타임아웃을 가진 fetch
    fetchWithTimeout: (url, options = {}, timeout = 10000) => {
        return Promise.race([
            fetch(url, options),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Request timeout')), timeout)
            )
        ]);
    }
};

/**
 * UI 애니메이션 유틸리티
 */
const AnimationUtils = {
    // 페이드 인
    fadeIn: (element, duration = 300) => {
        element.style.opacity = '0';
        element.style.display = 'block';
        
        return new Promise(resolve => {
            const animation = element.animate([
                { opacity: 0 },
                { opacity: 1 }
            ], {
                duration: duration,
                easing: 'ease-out',
                fill: 'forwards'
            });
            
            animation.addEventListener('finish', () => {
                element.style.opacity = '1';
                resolve();
            });
        });
    },
    
    // 페이드 아웃
    fadeOut: (element, duration = 300) => {
        return new Promise(resolve => {
            const animation = element.animate([
                { opacity: 1 },
                { opacity: 0 }
            ], {
                duration: duration,
                easing: 'ease-in',
                fill: 'forwards'
            });
            
            animation.addEventListener('finish', () => {
                element.style.display = 'none';
                resolve();
            });
        });
    },
    
    // 슬라이드 업
    slideUp: (element, duration = 300) => {
        const height = element.offsetHeight;
        
        return new Promise(resolve => {
            const animation = element.animate([
                { height: `${height}px`, opacity: 1 },
                { height: '0px', opacity: 0 }
            ], {
                duration: duration,
                easing: 'ease-in',
                fill: 'forwards'
            });
            
            animation.addEventListener('finish', () => {
                element.style.display = 'none';
                resolve();
            });
        });
    },
    
    // 바운스 효과
    bounce: (element) => {
        element.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.1)' },
            { transform: 'scale(1)' }
        ], {
            duration: 300,
            easing: 'ease-out'
        });
    }
};

/**
 * 폼 유틸리티
 */
const FormUtils = {
    // 폼 데이터 직렬화
    serialize: (form) => {
        const formData = new FormData(form);
        const data = {};
        
        for (const [key, value] of formData.entries()) {
            data[key] = value;
        }
        
        return data;
    },
    
    // 폼 유효성 검사
    validate: (form, rules) => {
        const errors = {};
        
        Object.entries(rules).forEach(([field, rule]) => {
            const element = form.querySelector(`[name="${field}"]`);
            const value = element ? element.value.trim() : '';
            
            if (rule.required && !value) {
                errors[field] = rule.requiredMessage || `${field}은(는) 필수입니다.`;
            }
            
            if (value && rule.pattern && !rule.pattern.test(value)) {
                errors[field] = rule.patternMessage || `${field} 형식이 올바르지 않습니다.`;
            }
            
            if (value && rule.min && parseFloat(value) < rule.min) {
                errors[field] = rule.minMessage || `${field}은(는) ${rule.min} 이상이어야 합니다.`;
            }
            
            if (value && rule.max && parseFloat(value) > rule.max) {
                errors[field] = rule.maxMessage || `${field}은(는) ${rule.max} 이하여야 합니다.`;
            }
        });
        
        return {
            isValid: Object.keys(errors).length === 0,
            errors: errors
        };
    }
};

/**
 * 디바이스 유틸리티
 */
const DeviceUtils = {
    // 모바일 기기 감지
    isMobile: () => {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },
    
    // 터치 기기 감지
    isTouchDevice: () => {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    },
    
    // iOS 기기 감지
    isIOS: () => {
        return /iPad|iPhone|iPod/.test(navigator.userAgent);
    },
    
    // 배터리 정보 (지원되는 경우)
    getBatteryInfo: async () => {
        if ('getBattery' in navigator) {
            try {
                const battery = await navigator.getBattery();
                return {
                    level: Math.round(battery.level * 100),
                    charging: battery.charging
                };
            } catch (error) {
                return null;
            }
        }
        return null;
    },
    
    // 진동 (지원되는 경우)
    vibrate: (pattern = [100]) => {
        if ('vibrate' in navigator) {
            navigator.vibrate(pattern);
        }
    }
};


/**
 * 레거시 Utils 호환성 객체 (itinerary.js 호환용)
 */
const Utils = {
    formatCurrency: (amount) => NumberUtils.formatCurrency(amount),
    formatDate: (date, format = 'YYYY-MM-DD') => {
        if (typeof date === 'string') {
            date = new Date(date);
        }
        if (format === 'YYYY-MM-DD') {
            return date.toISOString().split('T')[0];
        }
        return DateUtils.format(date, format);
    }
};

// 전역 접근을 위한 내보내기
window.Logger = Logger;
window.DateUtils = DateUtils;
window.NumberUtils = NumberUtils;
window.LocationUtils = LocationUtils;
window.DOMUtils = DOMUtils;
window.StorageUtils = StorageUtils;
window.NetworkUtils = NetworkUtils;
window.AnimationUtils = AnimationUtils;
window.FormUtils = FormUtils;
window.DeviceUtils = DeviceUtils;
window.Utils = Utils;

// 모듈 상태 관리
window.ModuleStatus = {
    isReady: false,
    init: () => {
        StorageUtils.cleanExpired();
        Logger.info('유틸리티 모듈 초기화 완료');
        window.ModuleStatus.isReady = true;
        
        // 모듈 초기화 완료 이벤트 발생
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'utils' }
        }));
    }
};

// 중앙 초기화 시스템에 의해 호출됨 (DOMContentLoaded 제거)
// document.addEventListener('DOMContentLoaded', () => {
//     StorageUtils.cleanExpired();
//     Logger.info('유틸리티 모듈 초기화 완료');
// });