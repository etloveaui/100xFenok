/**
 * Notification Manager
 * Centralizes toast notification logic for the entire application.
 */

export function showToast(message, type = 'info') {
    // Ensure container exists
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `;
        document.body.appendChild(container);
    }

    // Create toast element
    const toast = document.createElement('div');

    // Style based on type
    const bgColors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-slate-800',
        warning: 'bg-yellow-600'
    };
    const bgColor = bgColors[type] || bgColors.info;
    const icon = type === 'success' ? 'check-circle' :
        type === 'error' ? 'exclamation-circle' :
            type === 'warning' ? 'exclamation-triangle' : 'info-circle';

    toast.className = `${bgColor} text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-3 transition-all duration-300 opacity-0 translate-y-4`;
    toast.innerHTML = `
    <i class="fas fa-${icon}"></i>
    <span class="font-medium text-sm">${message}</span>
  `;

    // Add to container
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-y-4');
    });

    // Remove after delay
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-4');
        setTimeout(() => {
            if (toast.parentElement) toast.remove();
        }, 300);
    }, 3000);
}

// Make it globally available for convenience
window.showToast = showToast;
