// Weekly Scout JavaScript 로직
// Alpine.js와 함께 사용되는 추가 기능들

document.addEventListener('DOMContentLoaded', function() {
    // 페이지 로드 완료 후 실행될 로직들
    console.log('100x Weekly Scout 로딩 완료');
    
    // 차트 애니메이션 트리거 (필요시)
    const bars = document.querySelectorAll('.bar-chart-bar');
    bars.forEach(bar => {
        // 애니메이션 효과를 위한 지연 실행
        setTimeout(() => {
            bar.style.width = bar.style.width;
        }, 100);
    });
});

// 유틸리티 함수들 (필요시 확장)
window.WeeklyScout = {
    // 색상 유틸리티
    getColorClass: function(value) {
        return value >= 0 ? 'text-green-600' : 'text-red-600';
    },
    
    // 숫자 포맷팅
    formatNumber: function(num) {
        return num.toLocaleString();
    },
    
    // 퍼센트 폭 계산 (차트용)
    calculateWidth: function(value, max = 100) {
        return Math.abs(value / max * 100);
    }
};
