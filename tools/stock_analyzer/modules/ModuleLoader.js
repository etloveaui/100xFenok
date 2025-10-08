/**
 * ModuleLoader
 * 모듈 로딩 및 의존성 관리
 */

class ModuleLoader {
    constructor() {
        this.modules = new Map();
        this.loadedModules = new Set();
        this.loadingPromises = new Map();
    }
    
    /**
     * 모듈 등록
     */
    register(name, moduleClass, dependencies = []) {
        this.modules.set(name, {
            class: moduleClass,
            dependencies,
            instance: null
        });
    }
    
    /**
     * 모듈 로딩
     */
    async load(name) {
        if (this.loadingPromises.has(name)) {
            return this.loadingPromises.get(name);
        }
        
        const loadPromise = this._loadModule(name);
        this.loadingPromises.set(name, loadPromise);
        
        return loadPromise;
    }
    
    async _loadModule(name) {
        if (this.loadedModules.has(name)) {
            return this.modules.get(name).instance;
        }
        
        const moduleInfo = this.modules.get(name);
        if (!moduleInfo) {
            throw new Error(`Module ${name} not registered`);
        }
        
        // 의존성 먼저 로딩
        const dependencies = [];
        for (const depName of moduleInfo.dependencies) {
            const dep = await this.load(depName);
            dependencies.push(dep);
        }
        
        // 모듈 인스턴스 생성
        const instance = new moduleInfo.class(...dependencies);
        moduleInfo.instance = instance;
        this.loadedModules.add(name);
        
        console.log(`ModuleLoader: Loaded module ${name}`);
        
        return instance;
    }
    
    /**
     * 모듈 가져오기
     */
    get(name) {
        const moduleInfo = this.modules.get(name);
        return moduleInfo ? moduleInfo.instance : null;
    }
    
    /**
     * 모든 모듈 로딩
     */
    async loadAll() {
        const loadPromises = Array.from(this.modules.keys()).map(name => this.load(name));
        return Promise.all(loadPromises);
    }
}

// 전역 모듈 로더
window.moduleLoader = new ModuleLoader();

export default ModuleLoader;