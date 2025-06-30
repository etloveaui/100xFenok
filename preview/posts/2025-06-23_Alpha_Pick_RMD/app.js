// Simplified script for Alpha Pick preview page
// Tab navigation and chart logic removed

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    Object.assign(notification.style, {
        position: 'fixed',
        top: '80px',
        right: '24px',
        background: type === 'success' ? '#10B981' : '#3B82F6',
        color: '#fff',
        padding: '12px 16px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    });
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Alpha Pick content loaded');
});
