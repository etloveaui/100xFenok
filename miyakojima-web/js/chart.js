// 미야코지마 웹 플랫폼 - 차트 및 데이터 시각화
// Chart and Data Visualization for Miyakojima Web Platform

class SimpleChart {
    constructor(canvasId, type = 'line') {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.type = type;
        this.data = [];
        this.options = {
            responsive: true,
            animation: true,
            colors: {
                primary: '#00bcd4',
                secondary: '#ff9800',
                success: '#4caf50',
                warning: '#ff9800',
                error: '#f44336'
            }
        };
        
        if (this.canvas) {
            this.setupCanvas();
        }
    }

    setupCanvas() {
        // 고해상도 디스플레이 지원
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        
        this.ctx.scale(dpr, dpr);
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
    }

    // 데이터 설정
    setData(data, labels = []) {
        this.data = data;
        this.labels = labels;
        this.render();
    }

    // 데이터 추가
    addData(value, label = '') {
        this.data.push(value);
        if (label) this.labels.push(label);
        
        // 최대 20개 데이터 포인트 유지
        if (this.data.length > 20) {
            this.data.shift();
            if (this.labels.length > 20) this.labels.shift();
        }
        
        this.render();
    }

    // 차트 렌더링
    render() {
        if (!this.ctx || this.data.length === 0) return;
        
        this.clearCanvas();
        
        switch (this.type) {
            case 'line':
                this.renderLineChart();
                break;
            case 'bar':
                this.renderBarChart();
                break;
            case 'doughnut':
                this.renderDoughnutChart();
                break;
            case 'progress':
                this.renderProgressChart();
                break;
        }
    }

    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    renderLineChart() {
        const padding = 40;
        const width = this.canvas.width / window.devicePixelRatio - padding * 2;
        const height = this.canvas.height / window.devicePixelRatio - padding * 2;
        
        if (this.data.length < 2) return;
        
        // 데이터 범위 계산
        const minVal = Math.min(...this.data);
        const maxVal = Math.max(...this.data);
        const range = maxVal - minVal || 1;
        
        // 선 그리기
        this.ctx.strokeStyle = this.options.colors.primary;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        
        for (let i = 0; i < this.data.length; i++) {
            const x = padding + (i / (this.data.length - 1)) * width;
            const y = padding + height - ((this.data[i] - minVal) / range) * height;
            
            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        
        this.ctx.stroke();
        
        // 점 그리기
        this.ctx.fillStyle = this.options.colors.primary;
        for (let i = 0; i < this.data.length; i++) {
            const x = padding + (i / (this.data.length - 1)) * width;
            const y = padding + height - ((this.data[i] - minVal) / range) * height;
            
            this.ctx.beginPath();
            this.ctx.arc(x, y, 4, 0, 2 * Math.PI);
            this.ctx.fill();
        }
        
        // 그리드 그리기
        this.drawGrid(padding, width, height);
    }

    renderBarChart() {
        const padding = 40;
        const width = this.canvas.width / window.devicePixelRatio - padding * 2;
        const height = this.canvas.height / window.devicePixelRatio - padding * 2;
        
        if (this.data.length === 0) return;
        
        const barWidth = width / this.data.length * 0.8;
        const barSpacing = width / this.data.length * 0.2;
        const maxVal = Math.max(...this.data) || 1;
        
        this.ctx.fillStyle = this.options.colors.primary;
        
        for (let i = 0; i < this.data.length; i++) {
            const x = padding + i * (barWidth + barSpacing) + barSpacing / 2;
            const barHeight = (this.data[i] / maxVal) * height;
            const y = padding + height - barHeight;
            
            // 그라데이션 생성
            const gradient = this.ctx.createLinearGradient(0, y, 0, y + barHeight);
            gradient.addColorStop(0, this.options.colors.primary);
            gradient.addColorStop(1, this.options.colors.secondary);
            
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(x, y, barWidth, barHeight);
        }
    }

    renderDoughnutChart() {
        const centerX = this.canvas.width / window.devicePixelRatio / 2;
        const centerY = this.canvas.height / window.devicePixelRatio / 2;
        const radius = Math.min(centerX, centerY) - 20;
        const innerRadius = radius * 0.6;
        
        const total = this.data.reduce((sum, val) => sum + val, 0);
        if (total === 0) return;
        
        const colors = [
            this.options.colors.primary,
            this.options.colors.secondary,
            this.options.colors.success,
            this.options.colors.warning,
            this.options.colors.error
        ];
        
        let currentAngle = -Math.PI / 2;
        
        for (let i = 0; i < this.data.length; i++) {
            const sliceAngle = (this.data[i] / total) * 2 * Math.PI;
            
            // 외부 호
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
            this.ctx.arc(centerX, centerY, innerRadius, currentAngle + sliceAngle, currentAngle, true);
            this.ctx.closePath();
            
            this.ctx.fillStyle = colors[i % colors.length];
            this.ctx.fill();
            
            currentAngle += sliceAngle;
        }
        
        // 중앙 텍스트
        this.ctx.fillStyle = this.options.colors.primary;
        this.ctx.font = 'bold 24px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('총합', centerX, centerY - 10);
        this.ctx.font = '18px Arial';
        this.ctx.fillText(total.toLocaleString(), centerX, centerY + 15);
    }

    renderProgressChart() {
        const centerX = this.canvas.width / window.devicePixelRatio / 2;
        const centerY = this.canvas.height / window.devicePixelRatio / 2;
        const radius = Math.min(centerX, centerY) - 20;
        const lineWidth = 12;
        
        const progress = this.data[0] || 0;
        const maxValue = this.data[1] || 100;
        const percentage = (progress / maxValue);
        
        // 배경 원
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        this.ctx.strokeStyle = '#e0e0e0';
        this.ctx.lineWidth = lineWidth;
        this.ctx.stroke();
        
        // 진행률 호
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + percentage * 2 * Math.PI);
        
        const gradient = this.ctx.createLinearGradient(
            centerX - radius, centerY,
            centerX + radius, centerY
        );
        gradient.addColorStop(0, this.options.colors.primary);
        gradient.addColorStop(1, this.options.colors.secondary);
        
        this.ctx.strokeStyle = gradient;
        this.ctx.lineWidth = lineWidth;
        this.ctx.lineCap = 'round';
        this.ctx.stroke();
        
        // 중앙 텍스트
        this.ctx.fillStyle = this.options.colors.primary;
        this.ctx.font = 'bold 28px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`${Math.round(percentage * 100)}%`, centerX, centerY + 8);
    }

    drawGrid(padding, width, height) {
        this.ctx.strokeStyle = '#f0f0f0';
        this.ctx.lineWidth = 1;
        
        // 수직 그리드
        for (let i = 0; i <= 5; i++) {
            const x = padding + (i / 5) * width;
            this.ctx.beginPath();
            this.ctx.moveTo(x, padding);
            this.ctx.lineTo(x, padding + height);
            this.ctx.stroke();
        }
        
        // 수평 그리드
        for (let i = 0; i <= 5; i++) {
            const y = padding + (i / 5) * height;
            this.ctx.beginPath();
            this.ctx.moveTo(padding, y);
            this.ctx.lineTo(padding + width, y);
            this.ctx.stroke();
        }
    }

    // 애니메이션 효과
    animateIn() {
        let frame = 0;
        const totalFrames = 30;
        const originalData = [...this.data];
        
        const animate = () => {
            frame++;
            const progress = frame / totalFrames;
            
            // 이징 함수 (ease-out)
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            
            this.data = originalData.map(val => val * easedProgress);
            this.render();
            
            if (frame < totalFrames) {
                requestAnimationFrame(animate);
            } else {
                this.data = originalData;
                this.render();
            }
        };
        
        requestAnimationFrame(animate);
    }

    // 차트 테마 변경
    setTheme(theme) {
        const themes = {
            miyakojima: {
                primary: '#00bcd4',
                secondary: '#ff9800',
                success: '#4caf50',
                warning: '#ff9800',
                error: '#f44336'
            },
            dark: {
                primary: '#64ffda',
                secondary: '#ffb74d',
                success: '#81c784',
                warning: '#ffb74d',
                error: '#e57373'
            },
            sunset: {
                primary: '#ff6b35',
                secondary: '#f7931e',
                success: '#ffb74d',
                warning: '#ff8a65',
                error: '#ef5350'
            }
        };
        
        if (themes[theme]) {
            this.options.colors = themes[theme];
            this.render();
        }
    }

    // 캔버스를 이미지로 내보내기
    export(filename = 'chart.png') {
        if (!this.canvas) return;
        
        const link = document.createElement('a');
        link.download = filename;
        link.href = this.canvas.toDataURL();
        link.click();
    }

    // 캔버스 크기 조정
    resize() {
        if (!this.canvas) return;
        
        this.setupCanvas();
        this.render();
    }
}

// 전역 차트 관리자
class ChartManager {
    constructor() {
        this.charts = new Map();
    }

    createChart(id, type, data = [], labels = []) {
        const chart = new SimpleChart(id, type);
        chart.setData(data, labels);
        this.charts.set(id, chart);
        return chart;
    }

    getChart(id) {
        return this.charts.get(id);
    }

    updateChart(id, data, labels = []) {
        const chart = this.charts.get(id);
        if (chart) {
            chart.setData(data, labels);
        }
    }

    destroyChart(id) {
        this.charts.delete(id);
    }

    resizeAll() {
        this.charts.forEach(chart => chart.resize());
    }
}

// 전역 인스턴스
window.chartManager = new ChartManager();

// 윈도우 리사이즈 이벤트
window.addEventListener('resize', () => {
    window.chartManager.resizeAll();
});

// 모듈 상태 관리
window.ChartStatus = {
    isReady: false,
    init: () => {
        window.ChartStatus.isReady = true;
        
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'chart' }
        }));
        
        Logger.info('차트 모듈 초기화 완료');
    }
};