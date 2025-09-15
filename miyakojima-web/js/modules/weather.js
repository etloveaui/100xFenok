// js/modules/weather.js - 완전한 날씨 시스템
import { ConfigManager } from '../config.js';

class WeatherService {
    constructor() {
        this.apiKey = '62c85ff5eff6e712643db50c03ec5beb'; // OpenWeatherMap API 키
        this.baseUrl = 'https://api.openweathermap.org/data/2.5';
        this.lat = 24.7888; // 미야코지마 위도
        this.lng = 125.2827; // 미야코지마 경도
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5분 캐시
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            console.log('✅ 날씨 서비스 이미 초기화됨');
            return;
        }

        try {
            console.log('🌤️ 날씨 서비스 초기화 시작...');

            // 현재 날씨와 5일 예보를 동시에 가져오기
            const [currentWeather, forecast] = await Promise.all([
                this.fetchCurrentWeather(),
                this.fetch5DayForecast()
            ]);

            this.currentWeather = currentWeather;
            this.forecast = forecast;

            this.initialized = true;
            console.log('✅ 날씨 서비스 초기화 완료');
            return {
                current: currentWeather,
                forecast: forecast
            };
        } catch (error) {
            console.error('❌ 날씨 서비스 초기화 실패:', error);
            // 대체 데이터 사용
            this.currentWeather = this.getDefaultCurrentWeather();
            this.forecast = this.getDefault5DayForecast();
            this.initialized = true;
            return {
                current: this.currentWeather,
                forecast: this.forecast
            };
        }
    }

    async fetchCurrentWeather() {
        const cacheKey = 'current_weather';
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            console.log('📦 캐시에서 현재 날씨 로딩');
            return cached;
        }

        const url = `${this.baseUrl}/weather?lat=${this.lat}&lon=${this.lng}&appid=${this.apiKey}&units=metric&lang=kr`;

        try {
            console.log('🌐 현재 날씨 API 호출 중...');
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`API 호출 실패: ${response.status}`);
            }

            const data = await response.json();
            const processedData = this.processCurrentWeatherData(data);

            this.setCache(cacheKey, processedData);
            console.log('✅ 현재 날씨 데이터 로딩 완료');
            return processedData;
        } catch (error) {
            console.error('❌ 현재 날씨 API 호출 실패:', error);
            return this.getDefaultCurrentWeather();
        }
    }

    async fetch5DayForecast() {
        const cacheKey = '5day_forecast';
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            console.log('📦 캐시에서 5일 예보 로딩');
            return cached;
        }

        const url = `${this.baseUrl}/forecast?lat=${this.lat}&lon=${this.lng}&appid=${this.apiKey}&units=metric&lang=kr`;

        try {
            console.log('🌐 5일 예보 API 호출 중...');
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`API 호출 실패: ${response.status}`);
            }

            const data = await response.json();
            const processedData = this.process5DayForecastData(data);

            this.setCache(cacheKey, processedData);
            console.log('✅ 5일 예보 데이터 로딩 완료');
            return processedData;
        } catch (error) {
            console.error('❌ 5일 예보 API 호출 실패:', error);
            return this.getDefault5DayForecast();
        }
    }

    processCurrentWeatherData(data) {
        return {
            temp: Math.round(data.main.temp),
            feelsLike: Math.round(data.main.feels_like),
            condition: data.weather[0].description,
            icon: this.getWeatherIcon(data.weather[0].icon),
            humidity: data.main.humidity,
            windSpeed: data.wind.speed,
            windDirection: data.wind.deg,
            pressure: data.main.pressure,
            visibility: data.visibility / 1000, // km로 변환
            uvIndex: 0, // OpenWeatherMap 무료 플랜에는 UV 데이터 없음
            sunrise: new Date(data.sys.sunrise * 1000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            sunset: new Date(data.sys.sunset * 1000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            cloudiness: data.clouds.all,
            lastUpdated: new Date()
        };
    }

    process5DayForecastData(data) {
        const dailyData = new Map();

        data.list.forEach(item => {
            const date = new Date(item.dt * 1000).toISOString().split('T')[0];

            if (!dailyData.has(date)) {
                dailyData.set(date, {
                    date: date,
                    temps: [],
                    conditions: [],
                    icons: [],
                    humidity: [],
                    windSpeed: [],
                    precipitation: 0,
                    hourly: []
                });
            }

            const dayData = dailyData.get(date);
            dayData.temps.push(item.main.temp);
            dayData.conditions.push(item.weather[0].description);
            dayData.icons.push(item.weather[0].icon);
            dayData.humidity.push(item.main.humidity);
            dayData.windSpeed.push(item.wind.speed);

            if (item.rain && item.rain['3h']) {
                dayData.precipitation += item.rain['3h'];
            }

            dayData.hourly.push({
                time: new Date(item.dt * 1000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                temp: Math.round(item.main.temp),
                icon: this.getWeatherIcon(item.weather[0].icon),
                condition: item.weather[0].description,
                precipitation: item.rain ? (item.rain['3h'] || 0) : 0
            });
        });

        const forecast = Array.from(dailyData.values()).slice(0, 5).map(day => ({
            date: day.date,
            dateKr: new Date(day.date).toLocaleDateString('ko-KR', {
                month: 'long',
                day: 'numeric',
                weekday: 'short'
            }),
            temp: {
                min: Math.round(Math.min(...day.temps)),
                max: Math.round(Math.max(...day.temps)),
                avg: Math.round(day.temps.reduce((a, b) => a + b, 0) / day.temps.length)
            },
            condition: day.conditions[Math.floor(day.conditions.length / 2)], // 중간값 사용
            icon: this.getWeatherIcon(day.icons[Math.floor(day.icons.length / 2)]),
            humidity: Math.round(day.humidity.reduce((a, b) => a + b, 0) / day.humidity.length),
            windSpeed: Math.round(day.windSpeed.reduce((a, b) => a + b, 0) / day.windSpeed.length),
            precipitation: Math.round(day.precipitation),
            precipitationChance: day.precipitation > 0 ? Math.min(90, day.precipitation * 10) : 0,
            hourly: day.hourly.slice(0, 8) // 하루에 최대 8개 시간 데이터
        }));

        return forecast;
    }

    getWeatherIcon(iconCode) {
        const iconMap = {
            '01d': '☀️', '01n': '🌙',
            '02d': '⛅', '02n': '☁️',
            '03d': '☁️', '03n': '☁️',
            '04d': '☁️', '04n': '☁️',
            '09d': '🌧️', '09n': '🌧️',
            '10d': '🌦️', '10n': '🌧️',
            '11d': '⛈️', '11n': '⛈️',
            '13d': '❄️', '13n': '❄️',
            '50d': '🌫️', '50n': '🌫️'
        };
        return iconMap[iconCode] || '☀️';
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    getDefaultCurrentWeather() {
        return {
            temp: 26,
            feelsLike: 28,
            condition: '맑음',
            icon: '☀️',
            humidity: 65,
            windSpeed: 3.2,
            windDirection: 180,
            pressure: 1013,
            visibility: 10,
            uvIndex: 8,
            sunrise: '06:30',
            sunset: '19:15',
            cloudiness: 20,
            lastUpdated: new Date()
        };
    }

    getDefault5DayForecast() {
        const baseDate = new Date();
        return Array.from({ length: 5 }, (_, i) => {
            const date = new Date(baseDate);
            date.setDate(date.getDate() + i);

            return {
                date: date.toISOString().split('T')[0],
                dateKr: date.toLocaleDateString('ko-KR', {
                    month: 'long',
                    day: 'numeric',
                    weekday: 'short'
                }),
                temp: {
                    min: 22 + Math.floor(Math.random() * 3),
                    max: 28 + Math.floor(Math.random() * 4),
                    avg: 25
                },
                condition: ['맑음', '흐림', '구름많음', '소나기'][Math.floor(Math.random() * 4)],
                icon: ['☀️', '☁️', '⛅', '🌦️'][Math.floor(Math.random() * 4)],
                humidity: 60 + Math.floor(Math.random() * 20),
                windSpeed: 2 + Math.floor(Math.random() * 5),
                precipitation: Math.floor(Math.random() * 10),
                precipitationChance: Math.floor(Math.random() * 60),
                hourly: []
            };
        });
    }

    // 여행자 맞춤 정보 생성
    getTravelAdvice(current, forecast) {
        const advice = [];

        // 우산 필요 여부
        const rainChance = forecast[0]?.precipitationChance || 0;
        if (rainChance > 50) {
            advice.push({ icon: '☂️', text: '우산 필수!', priority: 'high' });
        } else if (rainChance > 20) {
            advice.push({ icon: '🌂', text: '우산 준비 추천', priority: 'medium' });
        }

        // 선크림 필요 여부
        if (current.uvIndex > 6 || current.condition === '맑음') {
            advice.push({ icon: '🧴', text: '선크림 필수', priority: 'high' });
        }

        // 해변 활동 적합도
        if (current.windSpeed < 5 && current.temp > 24) {
            advice.push({ icon: '🏖️', text: '해변 활동 좋음', priority: 'info' });
        }

        // 스노클링 적합도
        if (current.visibility > 8 && current.windSpeed < 4) {
            advice.push({ icon: '🤿', text: '스노클링 좋음', priority: 'info' });
        }

        // 외출복장 추천
        if (current.temp < 20) {
            advice.push({ icon: '🧥', text: '겉옷 준비', priority: 'medium' });
        } else if (current.temp > 30) {
            advice.push({ icon: '👕', text: '시원한 옷차림', priority: 'medium' });
        }

        return advice;
    }

    async refresh() {
        console.log('🔄 날씨 데이터 새로고침...');
        this.cache.clear();
        return await this.initialize();
    }
}

// 전역 인스턴스 생성
const weatherService = new WeatherService();

// 전역 접근을 위해 window에 할당
if (typeof window !== 'undefined') {
    window.weatherService = weatherService;
}

export { WeatherService, weatherService };
export default weatherService;