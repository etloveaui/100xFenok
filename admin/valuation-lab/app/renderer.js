/**
 * Valuation Lab Renderer
 *
 * UI rendering functions using VLAB_CONFIG.
 * Based on Data Lab pattern (DEC-108).
 *
 * @module renderer
 * @version 1.0.0
 */

const Renderer = (function() {

  /**
   * Render all sections
   */
  function render() {
    renderTodayJudgment();
    renderPipeline();
    renderWorkstreams();
    renderChecklist();
  }

  /**
   * Render "Today's Judgment" section
   */
  function renderTodayJudgment() {
    const container = document.getElementById('today-judgment');
    if (!container) return;

    const folders = getAllFolders().slice(0, 4); // Show first 4

    let cardsHtml = folders.map(folderName => {
      const config = getFolderConfig(folderName);
      return `
        <div class="border rounded-lg p-4">
          <div class="text-xs text-gray-500 mb-1">${config.label}</div>
          <div class="font-semibold">${getJudgmentTitle(folderName)}</div>
          <div class="text-xs text-gray-400 mt-1">${getJudgmentNote(folderName)}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="card p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-800">오늘의 판단</h2>
            <p class="text-xs text-gray-500">우선순위와 다음 액션</p>
          </div>
          <a href="../data-lab/" class="text-xs text-emerald-600 hover:underline">Data Lab →</a>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  function getJudgmentTitle(folderName) {
    const titles = {
      benchmarks: '이관 체크리스트 확정',
      'global-scouter': 'UX 점검 기준 확정',
      damodaran: '활용 전략 정리',
      'sec-13f': '위젯 개발 준비',
      indices: '차트 개발 계획',
      sentiment: '대시보드 설계',
      slickcharts: 'UI 통합 계획'
    };
    return titles[folderName] || '계획 수립';
  }

  function getJudgmentNote(folderName) {
    const notes = {
      benchmarks: 'UI/문서 완료 여부 확정',
      'global-scouter': '스크리너/대시보드 기준',
      damodaran: '시나리오/이관 조건',
      'sec-13f': '투자자 포트폴리오 UI',
      indices: '지수 시계열 차트',
      sentiment: '심리 지표 통합',
      slickcharts: '구성종목/수익률 표시'
    };
    return notes[folderName] || '세부 계획 수립';
  }

  /**
   * Render pipeline section
   */
  function renderPipeline() {
    const container = document.getElementById('pipeline');
    if (!container) return;

    const pipeline = VLAB_CONFIG.PIPELINE;
    const statusColors = {
      verified: 'text-emerald-700',
      review: 'text-amber-700',
      expansion: 'text-indigo-700',
      ready: 'text-gray-700'
    };

    let stagesHtml = pipeline.map(stage => {
      const colorClass = statusColors[stage.status] || 'text-gray-700';
      return `
        <div class="border rounded-lg p-3">
          <div class="font-semibold ${colorClass}">${stage.stage}. ${stage.label}</div>
          <div class="text-xs text-gray-500">${stage.note}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="card p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-800">실험 파이프라인</h2>
            <p class="text-xs text-gray-500">단계별 현재 위치 표시</p>
          </div>
          <div class="flex items-center gap-2 text-xs">
            <span class="inline-flex items-center px-2 py-1 rounded bg-emerald-100 text-emerald-700">검증됨</span>
            <span class="inline-flex items-center px-2 py-1 rounded bg-indigo-100 text-indigo-700">확장 검증</span>
            <span class="inline-flex items-center px-2 py-1 rounded bg-amber-100 text-amber-700">검토 대기</span>
          </div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-4 text-sm">
          ${stagesHtml}
        </div>
      </div>
    `;
  }

  /**
   * Render workstreams section (7 folders)
   */
  function renderWorkstreams() {
    const container = document.getElementById('workstreams');
    if (!container) return;

    const folders = getAllFolders();
    let cardsHtml = folders.map(folderName => renderWorkstreamCard(folderName)).join('');

    container.innerHTML = cardsHtml;
  }

  /**
   * Render single workstream card
   */
  function renderWorkstreamCard(folderName) {
    const config = getFolderConfig(folderName);
    if (!config) return '';

    const colors = getStatusColor(config.status);
    const folderStatus = StateManager.get('folderStatus')[folderName] || {};

    // Status badge
    let statusBadge = `<span class="text-xs px-2 py-1 rounded ${colors.bg} ${colors.text}">${config.statusLabel}</span>`;

    // Loading/error indicator
    let statusIndicator = '';
    if (folderStatus.error) {
      statusIndicator = `<span class="text-xs text-rose-500 ml-2">⚠️</span>`;
    } else if (folderStatus.loaded) {
      statusIndicator = `<span class="text-xs text-emerald-500 ml-2">✓</span>`;
    }

    // Tools section
    let toolsHtml = '';
    if (config.tools && config.tools.length > 0) {
      const toolLinks = config.tools.map(tool =>
        `<a href="${tool.href}" class="px-2 py-1 rounded bg-${config.color}-50 text-${config.color}-700 border border-${config.color}-100 hover:shadow-sm">${tool.label}</a>`
      ).join('');
      toolsHtml = `
        <div class="mt-4">
          <div class="text-xs text-gray-500">구성요소</div>
          <div class="mt-2 flex flex-wrap gap-2 text-xs">${toolLinks}</div>
        </div>
      `;
    }

    // Expansions section
    let expansionsHtml = '';
    if (config.expansions && config.expansions.length > 0) {
      const expLinks = config.expansions.map(exp =>
        `<a href="${exp.href}" class="px-2 py-1 rounded bg-sky-50 text-sky-700 border border-sky-100 hover:shadow-sm">${exp.label}</a>`
      ).join('');
      expansionsHtml = `
        <div class="mt-4">
          <div class="text-xs text-gray-500">연계 기능</div>
          <div class="mt-2 flex flex-wrap gap-2 text-xs">${expLinks}</div>
        </div>
      `;
    }

    // Info section (for folders without tools)
    let infoHtml = '';
    if (config.info && config.info.length > 0 && (!config.tools || config.tools.length === 0)) {
      const infoItems = config.info.map(item =>
        `<div class="flex items-center gap-2">
          <i class="fas ${item.icon} text-gray-400"></i>
          <span>${item.text}</span>
        </div>`
      ).join('');
      infoHtml = `<div class="mt-4 text-xs text-gray-500 space-y-2">${infoItems}</div>`;
    }

    return `
      <div id="stream-${folderName}" class="card card-hover p-6 transition-all">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold">${config.label}</h3>
          <div class="flex items-center">
            ${statusBadge}
            ${statusIndicator}
          </div>
        </div>
        <div class="text-sm text-gray-500">${config.description}</div>
        ${toolsHtml}
        ${expansionsHtml}
        ${infoHtml}
        ${config.tools && config.tools.length === 0 ? `<div class="mt-4 text-xs text-gray-400">기능 개발 대기</div>` : ''}
      </div>
    `;
  }

  /**
   * Render checklist section
   */
  function renderChecklist() {
    const container = document.getElementById('checklist');
    if (!container) return;

    const checklist = VLAB_CONFIG.CHECKLIST;
    const folders = getAllFolders();

    let itemsHtml = folders.map(folderName => {
      const item = checklist[folderName];
      if (!item) return '';

      const itemsText = item.items.join(' · ');
      return `
        <div class="border rounded-lg p-3">
          <div class="font-semibold">${item.label}</div>
          <div class="text-xs text-gray-500">${itemsText}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="card p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-800">이관 체크리스트</h2>
            <p class="text-xs text-gray-500">확정 전 확인 항목 (7개 데이터 소스)</p>
          </div>
          <span class="text-xs text-gray-500">확정 후 배포 섹션으로 이동</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          ${itemsHtml}
        </div>
      </div>
    `;
  }

  /**
   * Update folder status indicator
   */
  function updateFolderStatus(folderName, status) {
    const card = document.getElementById(`stream-${folderName}`);
    if (!card) return;

    // Find status indicator and update
    const indicator = card.querySelector('.status-indicator');
    if (indicator) {
      if (status.error) {
        indicator.innerHTML = `<span class="text-xs text-rose-500">⚠️</span>`;
      } else if (status.loaded) {
        indicator.innerHTML = `<span class="text-xs text-emerald-500">✓</span>`;
      }
    }
  }

  /**
   * Highlight/focus a folder card
   */
  function focusFolder(folderName) {
    const el = document.getElementById(`stream-${folderName}`);
    if (!el) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 900);
  }

  return {
    render,
    renderTodayJudgment,
    renderPipeline,
    renderWorkstreams,
    renderChecklist,
    renderWorkstreamCard,
    updateFolderStatus,
    focusFolder
  };
})();
