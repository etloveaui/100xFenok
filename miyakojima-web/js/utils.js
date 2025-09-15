// js/utils.js
import { CONFIG } from './config.js';

export function formatCurrency(amount) {
    const rate = CONFIG.get('BUDGET')?.EXCHANGE_RATE_DEFAULT || 12;
    return `${Math.round(amount * rate).toLocaleString()}원`;
}

export function isDebugMode() {
    return CONFIG.get('DEBUG')?.ENABLED || false;
}

export function logDebug(message) {
    if (isDebugMode()) {
        console.log('🔍 DEBUG:', message);
    }
}

/**
 * 로깅 유틸리티
 */
export const Logger = {
    log: (message, data = null) => {
        if (window.CONFIG?.DEBUG?.ENABLED && window.CONFIG?.DEBUG?.LOG_LEVEL === 'debug') {
            console.log(`🏝️ ${message}`, data || '');
        }
    },

    info: (message, data = null) => {
        if (window.CONFIG?.DEBUG?.ENABLED && ['debug', 'info'].includes(window.CONFIG?.DEBUG?.LOG_LEVEL)) {
            console.info(`ℹ️ ${message}`, data || '');
        }
    },

    warn: (message, data = null) => {
        if (window.CONFIG?.DEBUG?.ENABLED && ['debug', 'info', 'warn'].includes(window.CONFIG?.DEBUG?.LOG_LEVEL)) {
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
export const DateUtils = {
    // 현재 날짜가 여행 기간인지 확인
    isInTripPeriod: () => {
        const now = new Date();
        const start = new Date(window.CONFIG?.TRIP_INFO?.START_DATE || '2024-01-01');
        const end = new Date(window.CONFIG?.TRIP_INFO?.END_DATE || '2024-01-07');
        return now >= start && now <= end;
    },

    // 여행 몇 일차인지 계산
    getTripDay: () => {
        if (!DateUtils.isInTripPeriod()) return 0;

        const now = new Date();
        const start = new Date(window.CONFIG?.TRIP_INFO?.START_DATE || '2024-01-01');
        const diffTime = Math.abs(now - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return Math.min(diffDays, window.CONFIG?.TRIP_INFO?.TOTAL_DAYS || 7);
    },

    // 날짜 포맷팅
    formatDate: (date, format = window.CONFIG?.UI?.DATE_FORMAT || 'YYYY-MM-DD') => {
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
    formatTime: (date, format = window.CONFIG?.UI?.TIME_FORMAT || 'HH:mm') => {
        const d = new Date(date);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');

        return format
            .replace('HH', hours)
            .replace('mm', minutes);
    }
};

/**
 * 통화 및 숫자 유틸리티
 */
export const NumberUtils = {
    // 통화 포맷팅 (JPY)
    formatCurrency: (amount, currency = 'JPY') => {
        const symbols = { JPY: '¥', KRW: '₩' };
        const formatted = new Intl.NumberFormat('ko-KR').format(Math.round(amount));
        return `${symbols[currency] || ''}${formatted}`;
    },

    // JPY를 KRW로 환전
    convertJPYToKRW: (amount, rate = null) => {
        const exchangeRate = rate || window.CONFIG?.BUDGET?.EXCHANGE_RATE_DEFAULT || 12;
        return Math.round(amount * exchangeRate);
    },

    // 퍼센티지 계산
    calculatePercentage: (value, total) => {
        if (total === 0) return 0;
        return Math.round((value / total) * 100);
    }
};

/**
 * DOM 유틸리티
 */
export const DOMUtils = {
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
    }
};

/**
 * 레거시 Utils 호환성 객체 (기존 코드 호환용)
 */
export const Utils = {
    formatCurrency: (amount) => NumberUtils.formatCurrency(amount),
    formatDate: (date, format = 'YYYY-MM-DD') => {
        if (typeof date === 'string') {
            date = new Date(date);
        }
        if (format === 'YYYY-MM-DD') {
            return date.toISOString().split('T')[0];
        }
        return DateUtils.formatDate(date, format);
    }
};

// 전역 접근을 위한 윈도우 객체 설정
if (typeof window !== 'undefined') {
    window.Logger = Logger;
    window.DateUtils = DateUtils;
    window.NumberUtils = NumberUtils;
    window.DOMUtils = DOMUtils;
    window.Utils = Utils;
}