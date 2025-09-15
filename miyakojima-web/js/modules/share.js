// 미야코지마 웹 플랫폼 - 공유 모듈
// Miyakojima Web Platform - Share Module

/**
 * 공유 기능 관리 클래스
 * 소셜 미디어 공유, 링크 공유, 데이터 내보내기
 */
class ShareManager {
    constructor() {
        this.isInitialized = false;
        this.supportedPlatforms = ['twitter', 'facebook', 'instagram', 'line', 'kakao', 'email', 'clipboard'];
        this.shareData = {
            title: '🏝️ 미야코지마 여행 컴패니언',
            description: '스마트 여행 동반자와 함께하는 미야코지마 완벽 여행!',
            url: window.location.href,
            image: this.getDefaultShareImage()
        };
    }

    /**
     * 공유 모듈 초기화
     */
    async init() {
        Logger.info('Share 모듈 초기화 시작...');

        try {
            // Web Share API 지원 확인
            this.checkWebShareAPISupport();

            // 공유 버튼 이벤트 설정
            this.setupShareButtons();

            // 카카오톡/네이버 LINE SDK 초기화 (선택사항)
            this.initializeExternalSDKs();

            this.isInitialized = true;
            Logger.info('Share 모듈 초기화 완료');

        } catch (error) {
            Logger.error('Share 모듈 초기화 실패:', error);
            throw error;
        }
    }

    /**
     * Web Share API 지원 확인
     */
    checkWebShareAPISupport() {
        this.webShareSupported = 'share' in navigator;
        Logger.info(`Web Share API 지원: ${this.webShareSupported ? '지원됨' : '지원되지 않음'}`);
    }

    /**
     * 기본 공유 이미지 URL 생성
     */
    getDefaultShareImage() {
        // 실제 서비스에서는 Open Graph 이미지 URL을 반환
        return `${window.location.origin}/assets/og-image.jpg`;
    }

    /**
     * 공유 버튼 이벤트 설정
     */
    setupShareButtons() {
        // 일반 공유 버튼들
        document.querySelectorAll('[data-share]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const platform = e.currentTarget.dataset.share;
                const shareType = e.currentTarget.dataset.shareType || 'general';
                this.share(platform, shareType);
            });
        });

        // POI 공유 버튼들
        document.querySelectorAll('[data-share-poi]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const poiId = e.currentTarget.dataset.sharePoi;
                const platform = e.currentTarget.dataset.platform || 'native';
                this.sharePOI(poiId, platform);
            });
        });

        // 예산 공유 버튼들
        document.querySelectorAll('[data-share-budget]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const platform = e.currentTarget.dataset.platform || 'native';
                this.shareBudgetSummary(platform);
            });
        });
    }

    /**
     * 외부 SDK 초기화 (카카오톡, LINE 등)
     */
    async initializeExternalSDKs() {
        // 카카오톡 SDK 초기화 (선택사항)
        if (window.Kakao && !window.Kakao.isInitialized()) {
            try {
                // 실제 앱에서는 카카오 앱 키를 설정해야 함
                // window.Kakao.init('YOUR_KAKAO_APP_KEY');
                Logger.info('카카오톡 SDK 준비됨 (앱 키 필요)');
            } catch (error) {
                Logger.warn('카카오톡 SDK 초기화 실패:', error);
            }
        }
    }

    /**
     * 일반 공유
     * @param {string} platform - 공유 플랫폼
     * @param {string} shareType - 공유 타입 (general, poi, budget, itinerary)
     */
    async share(platform, shareType = 'general') {
        const shareData = this.prepareShareData(shareType);

        Logger.info(`공유 시작: ${platform} - ${shareType}`, shareData);

        try {
            switch (platform) {
                case 'native':
                    return await this.shareNative(shareData);

                case 'twitter':
                    return this.shareTwitter(shareData);

                case 'facebook':
                    return this.shareFacebook(shareData);

                case 'line':
                    return this.shareLine(shareData);

                case 'kakao':
                    return this.shareKakao(shareData);

                case 'email':
                    return this.shareEmail(shareData);

                case 'clipboard':
                    return await this.shareClipboard(shareData);

                default:
                    Logger.warn(`지원되지 않는 공유 플랫폼: ${platform}`);
                    return false;
            }

        } catch (error) {
            Logger.error(`공유 실패 (${platform}):`, error);
            this.showShareError(platform, error);
            return false;
        }
    }

    /**
     * 공유 데이터 준비
     */
    prepareShareData(shareType) {
        const baseData = { ...this.shareData };

        switch (shareType) {
            case 'poi':
                return this.preparePOIShareData(baseData);

            case 'budget':
                return this.prepareBudgetShareData(baseData);

            case 'itinerary':
                return this.prepareItineraryShareData(baseData);

            default:
                return baseData;
        }
    }

    /**
     * Native Web Share API 공유
     */
    async shareNative(shareData) {
        if (!this.webShareSupported) {
            Logger.warn('Web Share API가 지원되지 않음, 대체 방법 사용');
            return this.shareFallback(shareData);
        }

        try {
            await navigator.share({
                title: shareData.title,
                text: shareData.description,
                url: shareData.url
            });

            Logger.info('Native 공유 성공');
            this.showShareSuccess('native');
            return true;

        } catch (error) {
            if (error.name === 'AbortError') {
                Logger.info('사용자가 공유를 취소함');
                return false;
            }

            Logger.error('Native 공유 실패:', error);
            return this.shareFallback(shareData);
        }
    }

    /**
     * Twitter 공유
     */
    shareTwitter(shareData) {
        const text = `${shareData.title}\n${shareData.description}`;
        const hashtags = 'miyakojima,okinawa,travel,일본여행';
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareData.url)}&hashtags=${hashtags}`;

        this.openShareWindow(url, 'twitter');
        this.showShareSuccess('twitter');
        return true;
    }

    /**
     * Facebook 공유
     */
    shareFacebook(shareData) {
        const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareData.url)}`;

        this.openShareWindow(url, 'facebook');
        this.showShareSuccess('facebook');
        return true;
    }

    /**
     * LINE 공유
     */
    shareLine(shareData) {
        const text = `${shareData.title}\n${shareData.description}\n${shareData.url}`;
        const url = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareData.url)}&text=${encodeURIComponent(text)}`;

        this.openShareWindow(url, 'line');
        this.showShareSuccess('line');
        return true;
    }

    /**
     * 카카오톡 공유 (SDK 필요)
     */
    shareKakao(shareData) {
        if (!window.Kakao || !window.Kakao.isInitialized()) {
            Logger.warn('카카오톡 SDK가 초기화되지 않음');
            return this.shareKakaoFallback(shareData);
        }

        try {
            window.Kakao.Link.sendDefault({
                objectType: 'feed',
                content: {
                    title: shareData.title,
                    description: shareData.description,
                    imageUrl: shareData.image,
                    link: {
                        mobileWebUrl: shareData.url,
                        webUrl: shareData.url
                    }
                },
                buttons: [{
                    title: '앱에서 보기',
                    link: {
                        mobileWebUrl: shareData.url,
                        webUrl: shareData.url
                    }
                }]
            });

            this.showShareSuccess('kakao');
            return true;

        } catch (error) {
            Logger.error('카카오톡 공유 실패:', error);
            return this.shareKakaoFallback(shareData);
        }
    }

    /**
     * 카카오톡 대체 공유 (URL 스킴)
     */
    shareKakaoFallback(shareData) {
        const text = `${shareData.title}\n${shareData.description}\n${shareData.url}`;
        const url = `https://story.kakao.com/share?url=${encodeURIComponent(shareData.url)}&text=${encodeURIComponent(text)}`;

        this.openShareWindow(url, 'kakao');
        this.showShareSuccess('kakao');
        return true;
    }

    /**
     * 이메일 공유
     */
    shareEmail(shareData) {
        const subject = encodeURIComponent(shareData.title);
        const body = encodeURIComponent(`${shareData.description}\n\n${shareData.url}`);
        const url = `mailto:?subject=${subject}&body=${body}`;

        window.location.href = url;
        this.showShareSuccess('email');
        return true;
    }

    /**
     * 클립보드 공유
     */
    async shareClipboard(shareData) {
        const text = `${shareData.title}\n${shareData.description}\n${shareData.url}`;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                this.fallbackCopyToClipboard(text);
            }

            this.showShareSuccess('clipboard');
            Logger.info('클립보드에 복사됨');
            return true;

        } catch (error) {
            Logger.error('클립보드 복사 실패:', error);
            this.showShareError('clipboard', error);
            return false;
        }
    }

    /**
     * 클립보드 복사 대체 방법
     */
    fallbackCopyToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(textArea);
        }
    }

    /**
     * POI 공유
     */
    async sharePOI(poiId, platform = 'native') {
        try {
            const poi = await this.getPOIData(poiId);
            if (!poi) {
                throw new Error('POI 데이터를 찾을 수 없습니다');
            }

            const shareData = {
                title: `📍 ${poi.name} - 미야코지마`,
                description: `${poi.description || '미야코지마의 멋진 장소를 발견했어요!'}\n#미야코지마 #여행 #${poi.category}`,
                url: `${window.location.origin}#poi?id=${poiId}`,
                image: poi.image || this.getDefaultShareImage()
            };

            return await this.share(platform, 'poi');

        } catch (error) {
            Logger.error(`POI 공유 실패 (${poiId}):`, error);
            this.showShareError(platform, error);
            return false;
        }
    }

    /**
     * 예산 요약 공유
     */
    async shareBudgetSummary(platform = 'native') {
        try {
            const budgetData = await this.getBudgetSummary();

            const shareData = {
                title: '💰 미야코지마 여행 예산 현황',
                description: `총 사용: ¥${budgetData.totalSpent.toLocaleString()}\n남은 예산: ¥${budgetData.remaining.toLocaleString()}\n#미야코지마 #여행예산 #일본여행`,
                url: `${window.location.origin}#budget`,
                image: this.getDefaultShareImage()
            };

            return await this.share(platform, 'budget');

        } catch (error) {
            Logger.error('예산 공유 실패:', error);
            this.showShareError(platform, error);
            return false;
        }
    }

    /**
     * 공유창 열기
     */
    openShareWindow(url, platform) {
        const width = 600;
        const height = 400;
        const left = (window.innerWidth - width) / 2;
        const top = (window.innerHeight - height) / 2;

        const options = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;

        window.open(url, `share_${platform}`, options);
    }

    /**
     * 공유 성공 알림
     */
    showShareSuccess(platform) {
        const platformNames = {
            native: '기본 공유',
            twitter: 'Twitter',
            facebook: 'Facebook',
            line: 'LINE',
            kakao: '카카오톡',
            email: '이메일',
            clipboard: '클립보드'
        };

        const message = `${platformNames[platform] || platform}에 공유되었습니다!`;
        this.showToast(message, 'success');
    }

    /**
     * 공유 실패 알림
     */
    showShareError(platform, error) {
        const message = `공유에 실패했습니다. 다시 시도해주세요.`;
        this.showToast(message, 'error');
    }

    /**
     * 토스트 메시지 표시
     */
    showToast(message, type = 'info') {
        // 앱의 토스트 시스템 사용
        if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast(message, type);
        } else {
            // 대체 알림
            alert(message);
        }
    }

    /**
     * 대체 공유 방법
     */
    async shareFallback(shareData) {
        // 클립보드 복사로 대체
        return await this.shareClipboard(shareData);
    }

    /**
     * POI 데이터 가져오기
     */
    async getPOIData(poiId) {
        if (window.poiManager && typeof window.poiManager.getPOI === 'function') {
            return await window.poiManager.getPOI(poiId);
        }

        // 대체 데이터 반환
        return {
            id: poiId,
            name: '미야코지마 장소',
            description: '미야코지마의 아름다운 장소입니다',
            category: 'nature'
        };
    }

    /**
     * 예산 요약 데이터 가져오기
     */
    async getBudgetSummary() {
        if (window.budgetTracker && typeof window.budgetTracker.getSummary === 'function') {
            return await window.budgetTracker.getSummary();
        }

        // 대체 데이터 반환
        return {
            totalSpent: 0,
            remaining: 20000,
            categories: {}
        };
    }

    /**
     * 공유 데이터 타입별 준비
     */
    preparePOIShareData(baseData) {
        return {
            ...baseData,
            title: `📍 ${baseData.title}`,
            description: `미야코지마의 멋진 장소를 발견했어요! ${baseData.description}`
        };
    }

    prepareBudgetShareData(baseData) {
        return {
            ...baseData,
            title: `💰 ${baseData.title}`,
            description: `미야코지마 여행 예산을 스마트하게 관리하고 있어요! ${baseData.description}`
        };
    }

    prepareItineraryShareData(baseData) {
        return {
            ...baseData,
            title: `📅 ${baseData.title}`,
            description: `미야코지마 여행 일정을 완벽하게 계획했어요! ${baseData.description}`
        };
    }

    /**
     * 공유 가능 여부 확인
     */
    canShare(platform) {
        if (platform === 'native') {
            return this.webShareSupported;
        }

        return this.supportedPlatforms.includes(platform);
    }

    /**
     * 공유 통계 (선택사항)
     */
    trackShare(platform, shareType) {
        // 분석 도구에 공유 이벤트 전송 (예: Google Analytics)
        if (window.gtag) {
            window.gtag('event', 'share', {
                method: platform,
                content_type: shareType,
                content_id: `miyakojima_${shareType}`
            });
        }

        Logger.info(`공유 추적: ${platform} - ${shareType}`);
    }
}

// 전역 공유 매니저 인스턴스 생성
const shareManager = new ShareManager();

// 모듈 상태 관리
window.ShareStatus = {
    isReady: false,
    manager: shareManager,

    init: async () => {
        console.log('📤 SHARE 초기화 시작!');

        try {
            await shareManager.init();
            window.ShareStatus.isReady = true;

            console.log('✅ SHARE 초기화 성공!');

            // 모듈 초기화 완료 이벤트 발생
            window.dispatchEvent(new CustomEvent('moduleReady', {
                detail: { moduleName: 'share' }
            }));

        } catch (error) {
            console.error('❌ SHARE 초기화 실패:', error);
            throw error;
        }
    }
};

// 전역 객체로 노출
window.shareManager = shareManager;

// ES6 모듈 지원
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ShareManager, shareManager };
}