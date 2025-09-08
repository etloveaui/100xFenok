// 로컬 스토리지 관리 유틸리티
class StorageManager {
    constructor() {
        this.prefix = 'miyakojima_';
        this.init();
    }

    init() {
        // IndexedDB 지원 확인
        this.indexedDBSupported = 'indexedDB' in window;
        this.localStorageSupported = 'localStorage' in window;
        
        if (this.indexedDBSupported) {
            this.initIndexedDB();
        }
    }

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('MiyakojimaDB', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // 객체 저장소 생성
                if (!db.objectStoreNames.contains('expenses')) {
                    db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('itinerary')) {
                    db.createObjectStore('itinerary', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('poi_data')) {
                    db.createObjectStore('poi_data', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('user_settings')) {
                    db.createObjectStore('user_settings', { keyPath: 'key' });
                }
            };
        });
    }

    // 로컬 스토리지에서 데이터 가져오기
    get(key) {
        if (!this.localStorageSupported) return null;
        
        try {
            const value = localStorage.getItem(this.prefix + key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            console.error('Storage get error:', error);
            return null;
        }
    }

    // 로컬 스토리지에 데이터 저장
    set(key, value) {
        if (!this.localStorageSupported) return false;
        
        try {
            localStorage.setItem(this.prefix + key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('Storage set error:', error);
            return false;
        }
    }

    // 데이터 삭제
    remove(key) {
        if (!this.localStorageSupported) return false;
        
        try {
            localStorage.removeItem(this.prefix + key);
            return true;
        } catch (error) {
            console.error('Storage remove error:', error);
            return false;
        }
    }

    // 모든 데이터 삭제
    clear() {
        if (!this.localStorageSupported) return false;
        
        try {
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
                if (key.startsWith(this.prefix)) {
                    localStorage.removeItem(key);
                }
            });
            return true;
        } catch (error) {
            console.error('Storage clear error:', error);
            return false;
        }
    }

    // 만료 시간이 있는 데이터 저장
    setWithExpiry(key, value, ttl) {
        const now = new Date();
        const item = {
            value: value,
            expiry: now.getTime() + ttl
        };
        return this.set(key, item);
    }

    // 만료 시간 체크하여 데이터 가져오기
    getWithExpiry(key) {
        const item = this.get(key);
        if (!item) return null;
        
        const now = new Date();
        if (now.getTime() > item.expiry) {
            this.remove(key);
            return null;
        }
        
        return item.value;
    }

    // IndexedDB에서 데이터 가져오기
    async getFromDB(storeName, key) {
        if (!this.db) return null;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.get(key);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // IndexedDB에 데이터 저장
    async saveToDB(storeName, data) {
        if (!this.db) return false;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.add(data);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // IndexedDB에서 모든 데이터 가져오기
    async getAllFromDB(storeName) {
        if (!this.db) return [];
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.getAll();
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // 스토리지 사용량 확인
    getStorageUsage() {
        if (!this.localStorageSupported) return { used: 0, total: 0 };
        
        let totalSize = 0;
        const keys = Object.keys(localStorage);
        
        keys.forEach(key => {
            if (key.startsWith(this.prefix)) {
                totalSize += localStorage.getItem(key).length;
            }
        });
        
        // 대략적인 로컬 스토리지 제한 (보통 5-10MB)
        const estimatedLimit = 5 * 1024 * 1024; // 5MB
        
        return {
            used: totalSize,
            total: estimatedLimit,
            percentage: Math.round((totalSize / estimatedLimit) * 100)
        };
    }

    // 백업 데이터 생성
    exportData() {
        const data = {};
        const keys = Object.keys(localStorage);
        
        keys.forEach(key => {
            if (key.startsWith(this.prefix)) {
                const cleanKey = key.replace(this.prefix, '');
                data[cleanKey] = this.get(cleanKey);
            }
        });
        
        return {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            data: data
        };
    }

    // 백업 데이터 복원
    importData(backupData) {
        if (!backupData || !backupData.data) return false;
        
        try {
            Object.keys(backupData.data).forEach(key => {
                this.set(key, backupData.data[key]);
            });
            return true;
        } catch (error) {
            console.error('Import data error:', error);
            return false;
        }
    }
}

// 전역 스토리지 인스턴스
const storage = new StorageManager();

// 모듈 상태 관리
window.StorageStatus = {
    isReady: false,
    init: async () => {
        // StorageManager는 이미 생성되었으므로 초기화만 확인
        if (storage.indexedDBSupported) {
            await storage.initIndexedDB();
        }
        
        window.StorageStatus.isReady = true;
        window.storage = storage; // 전역 접근 가능하도록 설정
        
                // 전역 접근을 위한 내보내기
        window.StorageManager = StorageManager;
        window.storageManager = new StorageManager();
        
        // 모듈 초기화 완료 이벤트 발생
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'storage' }
        }));
        
        console.log('Storage Manager 초기화 완료');
    }
};

// 중앙 초기화 시스템에 의해 호출됨