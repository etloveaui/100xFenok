/**
 * DragAndDrop - 비교 대상 드래그 앤 드롭 상호작용을 캡슐화
 *
 * HTML5 Drag & Drop API를 활용하여 기업 카드를 비교 영역으로
 * 이동할 수 있도록 하며, 키보드 접근성도 같이 고려합니다.
 */
const DeepCompareDragAndDrop = (() => {
    let onDropCallback = null;
    let onRemoveCallback = null;

    function setup({ dropZones = [], container, onDrop, onRemove }) {
        onDropCallback = onDrop;
        onRemoveCallback = onRemove;

        dropZones.forEach(zone => {
            zone.addEventListener('dragover', handleDragOver);
            zone.addEventListener('drop', handleDrop);
        });

        if (container) {
            container.addEventListener('dragstart', handleDragStart);
            container.addEventListener('dragend', handleDragEnd);
            container.addEventListener('click', handleClick);
            container.addEventListener('keydown', handleKeyDown);
        }
    }

    function handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        event.currentTarget.classList.add('ring-2', 'ring-blue-500');
    }

    function handleDrop(event) {
        event.preventDefault();
        const zone = event.currentTarget;
        zone.classList.remove('ring-2', 'ring-blue-500');

        try {
            const payload = event.dataTransfer.getData('application/json');
            if (!payload) return;
            const data = JSON.parse(payload);
            if (onDropCallback) {
                onDropCallback(data, zone.dataset.slot);
            }
        } catch (error) {
            console.error('[DeepCompareDragAndDrop] 드롭 데이터 파싱 실패:', error);
        }
    }

    function handleDragStart(event) {
        const card = event.target.closest('.draggable-company');
        if (!card) return;

        const id = card.dataset.id;
        if (!id) return;

        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/json', JSON.stringify({ id }));
        card.classList.add('opacity-60');
    }

    function handleDragEnd(event) {
        const card = event.target.closest('.draggable-company');
        if (card) {
            card.classList.remove('opacity-60');
        }
    }

    function handleClick(event) {
        const button = event.target.closest('.remove-compare-btn');
        if (!button) return;
        const id = button.dataset.id;
        if (id && onRemoveCallback) {
            onRemoveCallback(id);
        }
    }

    function handleKeyDown(event) {
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        const targetCard = event.target.closest('.draggable-company');
        if (!targetCard) return;
        const id = targetCard.dataset.id;
        if (id && onRemoveCallback) {
            event.preventDefault();
            onRemoveCallback(id);
        }
    }

    return { setup };
})();

window.DeepCompareDragAndDrop = DeepCompareDragAndDrop;

console.log('✅ DeepCompare DragAndDrop 모듈 로드 완료');
