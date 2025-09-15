class ItineraryManager {
    constructor() {
        this.realItineraryData = null;
        this.currentItinerary = {};
        this.scheduleItems = [];
        this.isEditing = false;
        this.selectedDate = new Date();

        this.init();
    }

    async init() {
        try {
            await this.loadRealItineraryData();
            await this.loadItineraryData();
            this.setupEventListeners();
            this.initializeCalendar();
            Logger.info('Itinerary Manager initialized');
        } catch (error) {
            Logger.error('Failed to initialize itinerary manager:', error);
        }
    }

    setupEventListeners() {
        // Calendar navigation
        document.getElementById('prev-day')?.addEventListener('click', () => {
            this.selectedDate.setDate(this.selectedDate.getDate() - 1);
            this.updateCalendar();
        });

        document.getElementById('next-day')?.addEventListener('click', () => {
            this.selectedDate.setDate(this.selectedDate.getDate() + 1);
            this.updateCalendar();
        });

        document.getElementById('today-btn')?.addEventListener('click', () => {
            this.selectedDate = new Date();
            this.updateCalendar();
        });

        // Add schedule item
        document.getElementById('add-schedule-btn')?.addEventListener('click', () => {
            this.showAddScheduleModal();
        });

        // Schedule form submission
        document.getElementById('schedule-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleScheduleSubmit(e.target);
        });

        // Route optimization
        document.getElementById('optimize-route-btn')?.addEventListener('click', () => {
            this.optimizeRoute();
        });

        // Import from POI
        document.getElementById('import-poi-btn')?.addEventListener('click', () => {
            this.showPOIImportModal();
        });
    }

    initializeCalendar() {
        // 실제 여행 시작일로 설정
        if (this.realItineraryData?.trip_overview?.dates) {
            const tripStartDate = this.realItineraryData.trip_overview.dates.split(' ~ ')[0];
            const tripStart = new Date(tripStartDate);
            if (tripStart) {
                this.selectedDate = tripStart;
            }
        } else {
            // 기본 여행 시작일
            const tripStart = new Date('2025-09-27');
            if (tripStart > new Date()) {
                this.selectedDate = tripStart;
            }
        }
        this.updateCalendar();
    }

    async loadRealItineraryData() {
        try {
            const response = await fetch('./data/itinerary_data.json');
            if (response.ok) {
                this.realItineraryData = await response.json();

                // 실제 여행 일정으로 초기화
                this.processRealItinerary();

                Logger.info('실제 일정 데이터 로드 완룉:', Object.keys(this.realItineraryData.daily_schedule).length + '일');
            }
        } catch (error) {
            Logger.warn('실제 일정 데이터 로드 실패, 기본값 사용:', error);
        }
    }

    processRealItinerary() {
        if (!this.realItineraryData?.daily_schedule) return;

        // 실제 여행 일정을 앱에서 사용할 수 있는 형식으로 변환
        Object.entries(this.realItineraryData.daily_schedule).forEach(([dayKey, dayData]) => {
            const dateKey = dayData.date;

            if (!this.currentItinerary[dateKey]) {
                this.currentItinerary[dateKey] = {
                    date: dateKey,
                    theme: dayData.theme,
                    accommodation: dayData.accommodation,
                    items: []
                };
            }

            // 스케줄 아이템 제작
            Object.entries(dayData.schedule).forEach(([timeKey, activity]) => {
                const scheduleItem = {
                    id: `${dateKey}_${timeKey}_${Date.now()}`,
                    date: dateKey,
                    time: timeKey,
                    title: activity.activity,
                    location: activity.location || '',
                    type: activity.type || 'general',
                    description: activity.notes || activity.note || '',
                    status: activity.status || 'planned',
                    realData: true // 실제 데이터 표시
                };

                // 예약 확정 정보 추가
                if (activity.reservation_number) {
                    scheduleItem.description += ` (예약번호: ${activity.reservation_number})`;
                }
                if (activity.cost) {
                    scheduleItem.description += ` - 비용: ${activity.cost}`;
                }
                if (activity.includes) {
                    scheduleItem.description += ` - 포함: ${Array.isArray(activity.includes) ? activity.includes.join(', ') : activity.includes}`;
                }

                this.scheduleItems.push(scheduleItem);
                this.currentItinerary[dateKey].items.push(scheduleItem);
            });
        });
    }

    async loadItineraryData() {
        // Load from localStorage first
        const localData = localStorage.getItem('miyakojima_itinerary');
        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                this.currentItinerary = parsed.itinerary || {};
                this.scheduleItems = parsed.scheduleItems || [];
            } catch (error) {
                Logger.error('Failed to parse local itinerary data:', error);
            }
        }

        // Load from backend if online and backend API is ready
        if (navigator.onLine && window.backendAPI) {
            try {
                const backendData = await window.backendAPI.request('get_itinerary', {});
                if (backendData.success && backendData.data) {
                    this.currentItinerary = backendData.data.itinerary || {};
                    this.scheduleItems = backendData.data.scheduleItems || [];
                    this.saveToLocal();
                }
            } catch (error) {
                Logger.warn('Failed to load itinerary from backend:', error);
            }
        }
    }

    updateCalendar() {
        const currentDate = document.getElementById('current-date');
        const scheduleList = document.getElementById('schedule-list');
        
        if (currentDate) {
            const options = { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            };
            currentDate.textContent = this.selectedDate.toLocaleDateString('ko-KR', options);
        }

        if (scheduleList) {
            this.renderScheduleItems(scheduleList);
        }

        this.updateTravelInfo();
    }

    renderScheduleItems(container) {
        const dateKey = this.selectedDate.toISOString().split('T')[0]; // YYYY-MM-DD 형식으로 변환
        const dayItems = this.scheduleItems.filter(item => item.date === dateKey);
        
        // Sort by time
        dayItems.sort((a, b) => {
            const timeA = new Date(`1970-01-01T${a.time}:00`);
            const timeB = new Date(`1970-01-01T${b.time}:00`);
            return timeA - timeB;
        });

        if (dayItems.length === 0) {
            container.innerHTML = `
                <div class="empty-schedule">
                    <p>이날의 일정이 없습니다</p>
                    <button class="btn btn-primary" onclick="itinerary.showAddScheduleModal()">
                        일정 추가
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = dayItems.map((item, index) => `
            <div class="schedule-item ${item.completed ? 'completed' : ''}" data-id="${item.id}">
                <div class="schedule-time">${item.time}</div>
                <div class="schedule-content">
                    <div class="schedule-title">${item.title}</div>
                    <div class="schedule-location">
                        ${item.location ? `📍 ${item.location}` : ''}
                    </div>
                    <div class="schedule-description">${item.description || ''}</div>
                    <div class="schedule-meta">
                        ${item.category ? `<span class="category-tag ${item.category}">${this.getCategoryName(item.category)}</span>` : ''}
                        ${item.estimatedCost ? `<span class="cost-tag">¥${NumberUtils.formatCurrency(item.estimatedCost)}</span>` : ''}
                        ${item.duration ? `<span class="duration-tag">${item.duration}분</span>` : ''}
                    </div>
                </div>
                <div class="schedule-actions">
                    <button class="action-btn" onclick="itinerary.toggleComplete('${item.id}')" 
                            title="${item.completed ? '완료 취소' : '완료 표시'}">
                        ${item.completed ? '✓' : '○'}
                    </button>
                    <button class="action-btn" onclick="itinerary.editScheduleItem('${item.id}')" title="편집">
                        ✏️
                    </button>
                    <button class="action-btn" onclick="itinerary.deleteScheduleItem('${item.id}')" title="삭제">
                        🗑️
                    </button>
                    ${item.coordinates ? `
                        <button class="action-btn" onclick="itinerary.openNavigation('${item.id}')" title="길찾기">
                            🧭
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }

    updateTravelInfo() {
        const dateKey = this.selectedDate.toISOString().split('T')[0]; // YYYY-MM-DD 형식으로 변환
        const dayItems = this.scheduleItems.filter(item => item.date === dateKey && !item.completed);
        
        // Calculate total estimated cost
        const totalCost = dayItems.reduce((sum, item) => sum + (item.estimatedCost || 0), 0);
        
        // Calculate total duration
        const totalDuration = dayItems.reduce((sum, item) => sum + (item.duration || 30), 0);
        
        // Update travel info display
        const travelInfo = document.getElementById('travel-info');
        if (travelInfo) {
            travelInfo.innerHTML = `
                <div class="travel-stats">
                    <div class="stat-item">
                        <div class="stat-label">예상 소요시간</div>
                        <div class="stat-value">${Math.floor(totalDuration / 60)}시간 ${totalDuration % 60}분</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">예상 비용</div>
                        <div class="stat-value">¥${NumberUtils.formatCurrency(totalCost)}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">일정 개수</div>
                        <div class="stat-value">${dayItems.length}개</div>
                    </div>
                </div>
            `;
        }
    }

    showAddScheduleModal(editId = null) {
        const isEdit = !!editId;
        const existingItem = isEdit ? this.scheduleItems.find(item => item.id === editId) : null;
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${isEdit ? '일정 수정' : '새 일정 추가'}</h3>
                    <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="schedule-form">
                        <input type="hidden" name="schedule-id" value="${editId || ''}">
                        <input type="hidden" name="schedule-date" value="${DateUtils.formatDate(this.selectedDate, 'YYYY-MM-DD')}">
                        
                        <div class="form-group">
                            <label for="schedule-title">제목 *</label>
                            <input type="text" id="schedule-title" name="schedule-title" 
                                   value="${existingItem?.title || ''}" required>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="schedule-time">시간 *</label>
                                <input type="time" id="schedule-time" name="schedule-time" 
                                       value="${existingItem?.time || '09:00'}" required>
                            </div>
                            <div class="form-group">
                                <label for="schedule-duration">소요시간(분)</label>
                                <input type="number" id="schedule-duration" name="schedule-duration" 
                                       value="${existingItem?.duration || 60}" min="15" max="480" step="15">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="schedule-location">장소</label>
                            <input type="text" id="schedule-location" name="schedule-location" 
                                   value="${existingItem?.location || ''}" 
                                   placeholder="장소명 또는 주소">
                            <button type="button" class="btn btn-sm" onclick="itinerary.selectFromPOIs()">
                                POI에서 선택
                            </button>
                        </div>
                        
                        <div class="form-group">
                            <label for="schedule-category">카테고리</label>
                            <select id="schedule-category" name="schedule-category">
                                <option value="">선택하세요</option>
                                <option value="dining" ${existingItem?.category === 'dining' ? 'selected' : ''}>식사</option>
                                <option value="sightseeing" ${existingItem?.category === 'sightseeing' ? 'selected' : ''}>관광</option>
                                <option value="activity" ${existingItem?.category === 'activity' ? 'selected' : ''}>액티비티</option>
                                <option value="shopping" ${existingItem?.category === 'shopping' ? 'selected' : ''}>쇼핑</option>
                                <option value="transportation" ${existingItem?.category === 'transportation' ? 'selected' : ''}>이동</option>
                                <option value="rest" ${existingItem?.category === 'rest' ? 'selected' : ''}>휴식</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="schedule-cost">예상 비용 (¥)</label>
                            <input type="number" id="schedule-cost" name="schedule-cost" 
                                   value="${existingItem?.estimatedCost || ''}" min="0" step="100">
                        </div>
                        
                        <div class="form-group">
                            <label for="schedule-description">메모</label>
                            <textarea id="schedule-description" name="schedule-description" 
                                      rows="3">${existingItem?.description || ''}</textarea>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">
                        취소
                    </button>
                    <button type="submit" form="schedule-form" class="btn btn-primary">
                        ${isEdit ? '수정' : '추가'}
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Setup form submission
        modal.querySelector('#schedule-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleScheduleSubmit(e.target);
        });
    }

    async handleScheduleSubmit(form) {
        const formData = new FormData(form);
        const scheduleData = {
            id: formData.get('schedule-id') || this.generateId(),
            date: formData.get('schedule-date'),
            title: formData.get('schedule-title'),
            time: formData.get('schedule-time'),
            duration: parseInt(formData.get('schedule-duration')) || 60,
            location: formData.get('schedule-location'),
            category: formData.get('schedule-category'),
            estimatedCost: parseInt(formData.get('schedule-cost')) || 0,
            description: formData.get('schedule-description'),
            completed: false,
            createdAt: Date.now()
        };

        // Get coordinates for location if provided
        if (scheduleData.location) {
            try {
                const coordinates = await this.geocodeLocation(scheduleData.location);
                if (coordinates) {
                    scheduleData.coordinates = coordinates;
                }
            } catch (error) {
                Logger.warn('Failed to geocode location:', error);
            }
        }

        // Add or update schedule item
        const existingIndex = this.scheduleItems.findIndex(item => item.id === scheduleData.id);
        if (existingIndex >= 0) {
            this.scheduleItems[existingIndex] = { ...this.scheduleItems[existingIndex], ...scheduleData };
        } else {
            this.scheduleItems.push(scheduleData);
        }

        await this.saveItinerary();
        this.updateCalendar();
        
        // Close modal
        form.closest('.modal').remove();
        
        if (window.app && window.app.showNotification) {
            window.app.showNotification(
                existingIndex >= 0 ? '일정이 수정되었습니다' : '새 일정이 추가되었습니다',
                'success'
            );
        }
    }

    async geocodeLocation(locationQuery) {
        try {
            if (window.geocodingAPI) {
                const result = await window.geocodingAPI.getCoordsFromAddress(locationQuery + ' 미야코지마');
                return {
                    lat: result.lat,
                    lng: result.lng
                };
            }
            return null;
        } catch (error) {
            Logger.error('Geocoding failed:', error);
            return null;
        }
    }

    toggleComplete(itemId) {
        const item = this.scheduleItems.find(item => item.id === itemId);
        if (item) {
            item.completed = !item.completed;
            item.completedAt = item.completed ? Date.now() : null;
            
            this.saveItinerary();
            this.updateCalendar();
            
            if (window.app && window.app.showNotification) {
                window.app.showNotification(
                    item.completed ? '일정을 완료로 표시했습니다' : '일정 완료를 취소했습니다',
                    'success'
                );
            }
        }
    }

    editScheduleItem(itemId) {
        this.showAddScheduleModal(itemId);
    }

    deleteScheduleItem(itemId) {
        if (confirm('이 일정을 삭제하시겠습니까?')) {
            this.scheduleItems = this.scheduleItems.filter(item => item.id !== itemId);
            this.saveItinerary();
            this.updateCalendar();
            
            if (window.app && window.app.showNotification) {
                window.app.showNotification('일정이 삭제되었습니다', 'success');
            }
        }
    }

    openNavigation(itemId) {
        const item = this.scheduleItems.find(item => item.id === itemId);
        if (item && item.coordinates) {
            const url = `https://www.google.com/maps/dir/?api=1&destination=${item.coordinates.lat},${item.coordinates.lng}`;
            window.open(url, '_blank');
        }
    }

    async optimizeRoute() {
        const dateKey = this.selectedDate.toISOString().split('T')[0]; // YYYY-MM-DD 형식으로 변환
        const dayItems = this.scheduleItems.filter(item => 
            item.date === dateKey && !item.completed && item.coordinates
        );
        
        if (dayItems.length < 2) {
            if (window.app && window.app.showNotification) {
                window.app.showNotification('경로 최적화를 위해서는 최소 2개의 위치가 필요합니다', 'warning');
            }
            return;
        }

        if (window.app && window.app.showLoadingState) {
            window.app.showLoadingState('경로 최적화 중...');
        }
        
        try {
            // Simple optimization: sort by proximity
            let currentLocation = null;
            if (window.locationManager && window.locationManager.currentLocation) {
                currentLocation = window.locationManager.currentLocation;
            }
            
            let optimized = [...dayItems];
            
            if (currentLocation && currentLocation.lat && currentLocation.lng) {
                // Start from current location
                let remaining = [...dayItems];
                let current = currentLocation;
                optimized = [];
                
                while (remaining.length > 0) {
                    // Find closest next destination
                    let minDistance = Infinity;
                    let nextIndex = 0;
                    
                    remaining.forEach((item, index) => {
                        const distance = LocationUtils.calculateDistance(
                            current.lat, current.lng,
                            item.coordinates.lat, item.coordinates.lng
                        );
                        if (distance < minDistance) {
                            minDistance = distance;
                            nextIndex = index;
                        }
                    });
                    
                    const nextItem = remaining.splice(nextIndex, 1)[0];
                    optimized.push(nextItem);
                    current = nextItem.coordinates;
                }
                
                // Update times based on optimized order
                optimized.forEach((item, index) => {
                    const baseTime = new Date(`1970-01-01T09:00:00`);
                    baseTime.setMinutes(baseTime.getMinutes() + (index * 90)); // 90분 간격
                    item.time = baseTime.toTimeString().slice(0, 5);
                });
                
                // Update schedule items
                optimized.forEach(optimizedItem => {
                    const originalIndex = this.scheduleItems.findIndex(item => item.id === optimizedItem.id);
                    if (originalIndex >= 0) {
                        this.scheduleItems[originalIndex] = optimizedItem;
                    }
                });
                
                await this.saveItinerary();
                this.updateCalendar();
                
                if (window.app && window.app.showNotification) {
                    window.app.showNotification('경로가 최적화되었습니다', 'success');
                }
            }
        } catch (error) {
            Logger.error('Route optimization failed:', error);
            if (window.app && window.app.showNotification) {
                window.app.showNotification('경로 최적화 실패: ' + error.message, 'error');
            }
        } finally {
            if (window.app && window.app.hideLoadingState) {
                window.app.hideLoadingState();
            }
        }
    }

    selectFromPOIs() {
        // This would integrate with POI manager to select locations
        if (window.poiManager) {
            window.poiManager.showPOISelector((selectedPOI) => {
                document.getElementById('schedule-location').value = selectedPOI.name;
                // Could also set coordinates directly
            });
        }
    }

    async saveItinerary() {
        // Save to localStorage
        this.saveToLocal();
        
        // Sync with backend if online and backend API is ready
        if (navigator.onLine && window.backendAPI) {
            try {
                await window.backendAPI.request('save_itinerary', {
                    itinerary: this.currentItinerary,
                    scheduleItems: this.scheduleItems
                });
            } catch (error) {
                Logger.warn('Failed to sync itinerary with backend:', error);
            }
        }
    }

    saveToLocal() {
        const data = {
            itinerary: this.currentItinerary,
            scheduleItems: this.scheduleItems,
            lastModified: Date.now()
        };
        localStorage.setItem('miyakojima_itinerary', JSON.stringify(data));
    }

    getCategoryName(category) {
        const names = {
            dining: '식사',
            sightseeing: '관광',
            activity: '액티비티',
            shopping: '쇼핑',
            transportation: '이동',
            rest: '휴식'
        };
        return names[category] || category;
    }

    generateId() {
        return 'schedule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async syncWithBackend() {
        if (!navigator.onLine || !window.backendAPI) return;
        
        try {
            const response = await window.backendAPI.request('sync_itinerary', {
                localData: {
                    itinerary: this.currentItinerary,
                    scheduleItems: this.scheduleItems
                }
            });
            
            if (response.success && response.data) {
                this.currentItinerary = response.data.itinerary || this.currentItinerary;
                this.scheduleItems = response.data.scheduleItems || this.scheduleItems;
                this.saveToLocal();
                return true;
            }
        } catch (error) {
            Logger.error('Itinerary sync failed:', error);
            throw error;
        }
    }

    getScheduleStats() {
        const today = DateUtils.formatDate(new Date(), 'YYYY-MM-DD');
        const todayItems = this.scheduleItems.filter(item => item.date === today);
        const completed = todayItems.filter(item => item.completed).length;
        
        return {
            total: todayItems.length,
            completed: completed,
            remaining: todayItems.length - completed,
            progress: todayItems.length > 0 ? Math.round((completed / todayItems.length) * 100) : 0
        };
    }
}

// Global itinerary instance
let itinerary;

// 모듈 상태 관리
window.ItineraryStatus = {
    isReady: false,
    init: async () => {
        itinerary = new ItineraryManager();
        window.itinerary = itinerary; // 전역 접근 가능하도록 설정
        window.ItineraryStatus.isReady = true;
        
        // 모듈 초기화 완료 이벤트 발생
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'itinerary' }
        }));
        
        Logger.info('Itinerary Manager 초기화 완료');
    }
};

// 중앙 초기화 시스템에 의해 호출됨