// js/modules/itinerary.js
import { DataService } from '../services/data.js';

class ItineraryManager {
    constructor() {
        this.itineraryData = {};
        this.customSchedule = {};
        this.currentDate = '2025-09-27';
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            console.log('✅ 일정 매니저 이미 초기화됨');
            return;
        }

        try {
            console.log('🔄 일정 매니저 초기화 시작...');

            // DataService에서 일정 데이터 로드
            this.itineraryData = DataService.get('itinerary') || {};
            this.loadCustomSchedule();

            // UI 초기화
            this.initializeUI();
            this.renderItinerary();

            this.initialized = true;
            console.log('✅ 일정 매니저 초기화 완료');
        } catch (error) {
            console.error('❌ 일정 매니저 초기화 실패:', error);
            this.itineraryData = { daily_schedule: {} };
        }
    }

    initializeUI() {
        // 날짜 선택 버튼 이벤트
        const dateButtons = document.querySelectorAll('.date-btn');
        dateButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.selectDate(e.target.dataset.date);
            });
        });
    }

    loadCustomSchedule() {
        try {
            const saved = localStorage.getItem('miyako_custom_schedule');
            this.customSchedule = saved ? JSON.parse(saved) : {};
        } catch (error) {
            console.error('커스텀 일정 로딩 실패:', error);
            this.customSchedule = {};
        }
    }

    saveCustomSchedule() {
        try {
            localStorage.setItem('miyako_custom_schedule', JSON.stringify(this.customSchedule));
        } catch (error) {
            console.error('커스텀 일정 저장 실패:', error);
        }
    }

    selectDate(date) {
        this.currentDate = date;

        // 버튼 활성화 상태 업데이트
        const dateButtons = document.querySelectorAll('.date-btn');
        dateButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.date === date);
        });

        this.renderItinerary();
    }

    renderItinerary() {
        const container = document.getElementById('itinerary-timeline');
        if (!container) {
            console.warn('일정 타임라인 컨테이너를 찾을 수 없습니다');
            return;
        }

        const dayKey = this.getDateKey(this.currentDate);
        const dayData = this.itineraryData.daily_schedule?.[dayKey];
        const customData = this.customSchedule[this.currentDate] || {};

        if (!dayData) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📅</div>
                    <h3>선택한 날짜의 일정이 없습니다</h3>
                    <p>커스텀 일정을 추가해보세요</p>
                    <button class="btn-primary" onclick="itineraryManager.addCustomEvent()">일정 추가</button>
                </div>
            `;
            return;
        }

        // 날짜 헤더
        const header = `
            <div class="day-header">
                <h3>${dayData.date} (${dayData.theme || ''})</h3>
                <button class="btn-secondary" onclick="itineraryManager.addCustomEvent()">
                    + 일정 추가
                </button>
            </div>
        `;

        // 시간별 일정
        const scheduleItems = [];

        // 기본 일정 추가
        if (dayData.schedule) {
            Object.entries(dayData.schedule).forEach(([time, activity]) => {
                scheduleItems.push({
                    time,
                    activity: activity.activity || activity,
                    location: activity.location || '',
                    type: 'default',
                    note: activity.note || ''
                });
            });
        }

        // 커스텀 일정 추가
        if (customData.events) {
            customData.events.forEach(event => {
                scheduleItems.push({
                    time: event.time,
                    activity: event.activity,
                    location: event.location || '',
                    type: 'custom',
                    id: event.id,
                    note: event.note || ''
                });
            });
        }

        // 시간순 정렬
        scheduleItems.sort((a, b) => a.time.localeCompare(b.time));

        const timelineHTML = scheduleItems.map(item => `
            <div class="timeline-item ${item.type}">
                <div class="timeline-time">${item.time}</div>
                <div class="timeline-content">
                    <div class="timeline-activity">
                        <h4>${item.activity}</h4>
                        ${item.location ? `<p class="timeline-location">📍 ${item.location}</p>` : ''}
                        ${item.note ? `<p class="timeline-note">${item.note}</p>` : ''}
                    </div>
                    ${item.type === 'custom' ? `
                        <div class="timeline-actions">
                            <button class="btn-icon" onclick="itineraryManager.editCustomEvent('${item.id}')">
                                ✏️
                            </button>
                            <button class="btn-icon" onclick="itineraryManager.deleteCustomEvent('${item.id}')">
                                🗑️
                            </button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `).join('');

        container.innerHTML = header + '<div class="timeline">' + timelineHTML + '</div>';
    }

    getDateKey(date) {
        // '2025-09-27' -> 'day1' 형식으로 변환
        const tripDates = [
            '2025-09-27', // day1
            '2025-09-28', // day2
            '2025-09-29', // day3
            '2025-09-30', // day4
            '2025-10-01'  // day5
        ];

        const index = tripDates.indexOf(date);
        return index !== -1 ? `day${index + 1}` : null;
    }

    addCustomEvent() {
        this.showEventModal();
    }

    editCustomEvent(eventId) {
        const customData = this.customSchedule[this.currentDate];
        if (!customData || !customData.events) return;

        const event = customData.events.find(e => e.id === eventId);
        if (!event) return;

        this.showEventModal(event);
    }

    deleteCustomEvent(eventId) {
        if (!confirm('이 일정을 삭제하시겠습니까?')) return;

        const customData = this.customSchedule[this.currentDate];
        if (!customData || !customData.events) return;

        customData.events = customData.events.filter(e => e.id !== eventId);

        if (customData.events.length === 0) {
            delete this.customSchedule[this.currentDate];
        }

        this.saveCustomSchedule();
        this.renderItinerary();
    }

    showEventModal(event = null) {
        const isEdit = !!event;
        const modalHTML = `
            <div id="event-modal" class="modal active">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${isEdit ? '일정 수정' : '일정 추가'}</h3>
                        <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                    </div>
                    <form id="event-form">
                        <div class="form-group">
                            <label for="event-time">시간</label>
                            <input type="time" id="event-time" required value="${event?.time || ''}">
                        </div>
                        <div class="form-group">
                            <label for="event-activity">활동</label>
                            <input type="text" id="event-activity" required value="${event?.activity || ''}" placeholder="예: 요나하 마에하마 해변 방문">
                        </div>
                        <div class="form-group">
                            <label for="event-location">장소</label>
                            <input type="text" id="event-location" value="${event?.location || ''}" placeholder="선택사항">
                        </div>
                        <div class="form-group">
                            <label for="event-note">메모</label>
                            <textarea id="event-note" placeholder="선택사항">${event?.note || ''}</textarea>
                        </div>
                        <div class="form-actions">
                            <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">
                                취소
                            </button>
                            <button type="submit" class="btn-primary">
                                ${isEdit ? '수정' : '추가'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        // 기존 모달 제거
        const existingModal = document.getElementById('event-modal');
        if (existingModal) {
            existingModal.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // 폼 이벤트 리스너
        const form = document.getElementById('event-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleEventSubmit(event);
        });
    }

    handleEventSubmit(existingEvent = null) {
        const time = document.getElementById('event-time').value;
        const activity = document.getElementById('event-activity').value;
        const location = document.getElementById('event-location').value;
        const note = document.getElementById('event-note').value;

        if (!time || !activity) {
            alert('시간과 활동을 입력해주세요');
            return;
        }

        const eventData = {
            id: existingEvent?.id || Date.now().toString(),
            time,
            activity,
            location,
            note
        };

        // 커스텀 스케줄에 추가/수정
        if (!this.customSchedule[this.currentDate]) {
            this.customSchedule[this.currentDate] = { events: [] };
        }

        const events = this.customSchedule[this.currentDate].events;

        if (existingEvent) {
            // 수정
            const index = events.findIndex(e => e.id === existingEvent.id);
            if (index !== -1) {
                events[index] = eventData;
            }
        } else {
            // 추가
            events.push(eventData);
        }

        this.saveCustomSchedule();
        this.renderItinerary();

        // 모달 닫기
        document.getElementById('event-modal').remove();
    }

    getTodaySchedule() {
        const today = new Date().toISOString().split('T')[0];
        const dayKey = this.getDateKey(today);

        if (!dayKey) return null;

        const dayData = this.itineraryData.daily_schedule?.[dayKey];
        const customData = this.customSchedule[today];

        return {
            default: dayData?.schedule || {},
            custom: customData?.events || []
        };
    }

    getNextActivity() {
        const schedule = this.getTodaySchedule();
        if (!schedule) return null;

        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // 모든 활동을 시간순으로 정렬
        const allActivities = [];

        // 기본 일정
        Object.entries(schedule.default).forEach(([time, activity]) => {
            allActivities.push({
                time,
                activity: activity.activity || activity,
                location: activity.location || ''
            });
        });

        // 커스텀 일정
        schedule.custom.forEach(event => {
            allActivities.push({
                time: event.time,
                activity: event.activity,
                location: event.location || ''
            });
        });

        // 시간순 정렬
        allActivities.sort((a, b) => a.time.localeCompare(b.time));

        // 현재 시간 이후의 첫 번째 활동 찾기
        return allActivities.find(activity => activity.time > currentTime);
    }

    // 통계 정보
    getStats() {
        const totalDays = Object.keys(this.itineraryData.daily_schedule || {}).length;
        const customEvents = Object.values(this.customSchedule).reduce((total, day) => {
            return total + (day.events ? day.events.length : 0);
        }, 0);

        return {
            totalDays,
            customEvents,
            currentDate: this.currentDate
        };
    }
}

// 전역 인스턴스 생성
const itineraryManager = new ItineraryManager();

// 전역 접근을 위해 window에 할당
if (typeof window !== 'undefined') {
    window.itineraryManager = itineraryManager;
}

export { ItineraryManager, itineraryManager };
export default itineraryManager;