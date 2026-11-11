/* ==========================================================================
   TableTap — helpers.js
   Formatting, toasts, confirm dialogs, overlays and CSV export.
   ========================================================================== */

export function formatMoney(amount, currency = '$') {
  const value = Number(amount) || 0;
  const formatted = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency + formatted;
}

export function timeAgo(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return mins + ' min ago';
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return hours + ' hours ago';
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : months + ' months ago';
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html).trim();
  return template.content.firstElementChild;
}

export function debounce(fn, wait = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ----------------------------------------------------------------- toast -- */
export function toast(message, type = 'success') {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = el('<div class="toast-region" aria-live="polite"></div>');
    document.body.appendChild(region);
  }
  const icons = { success: 'check', danger: 'alert-triangle', warning: 'alert-triangle' };
  const node = el(
    '<div class="toast toast--' + type + '" role="status">' +
    '<i data-lucide="' + (icons[type] || 'check') + '"></i>' +
    '<span>' + esc(message) + '</span>' +
    '<button class="toast__close" type="button" aria-label="Dismiss"><i data-lucide="x"></i></button>' +
    '</div>'
  );
  region.appendChild(node);
  if (window.lucide) window.lucide.createIcons();
  const remove = () => node.remove();
  node.querySelector('.toast__close').addEventListener('click', remove);
  setTimeout(remove, 4200);
}

/* --------------------------------------------------------- confirmDialog -- */
export function confirmDialog(text, options = {}) {
  return new Promise((resolve) => {
    const title = options.title || 'Are you sure?';
    const confirmLabel = options.confirmLabel || 'Confirm';
    const danger = options.danger !== false;

    const modal = el(
      '<div class="modal is-open" role="dialog" aria-modal="true" aria-labelledby="confirm-title">' +
      '<div class="modal__dialog">' +
      '<div class="modal__header"><div><p class="modal__title" id="confirm-title">' + esc(title) + '</p></div>' +
      '<button class="btn btn--icon" type="button" data-confirm="no" aria-label="Close"><i data-lucide="x"></i></button></div>' +
      '<div class="modal__body"><p class="text-sm">' + esc(text) + '</p></div>' +
      '<div class="modal__footer">' +
      '<button class="btn btn--secondary" type="button" data-confirm="no">Cancel</button>' +
      '<button class="btn ' + (danger ? 'btn--danger' : 'btn--primary') + '" type="button" data-confirm="yes">' + esc(confirmLabel) + '</button>' +
      '</div></div></div>'
    );

    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons();

    const finish = (value) => {
      modal.remove();
      resolve(value);
    };

    modal.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-confirm]');
      if (choice) finish(choice.getAttribute('data-confirm') === 'yes');
      else if (event.target === modal) finish(false);
    });

    const onKey = (event) => {
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        finish(false);
      }
    };
    document.addEventListener('keydown', onKey);

    const confirmBtn = modal.querySelector('[data-confirm="yes"]');
    if (confirmBtn) confirmBtn.focus();
  });
}

/* --------------------------------------------------------------- overlays -- */
export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.removeAttribute('hidden');
  modal.classList.add('is-open');
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('hidden', '');
}

export function openDrawer(id) {
  const drawer = document.getElementById(id);
  if (!drawer) return;
  drawer.classList.add('is-open');
}

export function closeDrawer(id) {
  const drawer = document.getElementById(id);
  if (!drawer) return;
  drawer.classList.remove('is-open');
}

/* ------------------------------------------------------------------ CSV --- */
export function exportCSV(rows, filename = 'tabletap-export.csv') {
  try {
    const body = rows.map((row) => row.map((cell) => {
      const value = cell == null ? '' : String(cell);
      return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
    }).join(',')).join('\r\n');

    const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename || 'tabletap-export.csv');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (err) {
    console.error('exportCSV error:', err);
    try {
      const body = rows.map((row) => row.map((cell) => {
        const value = cell == null ? '' : String(cell);
        return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
      }).join(',')).join('\r\n');
      const csvUri = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(body);
      const link = document.createElement('a');
      link.href = csvUri;
      link.download = filename || 'tabletap-export.csv';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => link.remove(), 1000);
    } catch (e) {
      alert('Could not export CSV: ' + err.message);
    }
  }
}

/* -------------------------------------------------------------- misc ------ */
export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function isToday(iso) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function statusBadge(status) {
  const map = {
    new: ['success', 'New'],
    pending_approval: ['warning', 'Pending approval'],
    preparing: ['warning', 'Preparing'],
    ready: ['neutral', 'Ready'],
    served: ['neutral', 'Served'],
    rejected: ['danger', 'Rejected'],
    active: ['success', 'Active'],
    suspended: ['danger', 'Suspended'],
    restricted: ['warning', 'Restricted'],
    invited: ['neutral', 'Invited'],
  };
  const [tone, label] = map[status] || ['neutral', status];
  return '<span class="badge badge--' + tone + '">' + esc(label) + '</span>';
}

export function renderPaginationHtml(pageNo, totalPages) {
  if (totalPages <= 1) return '';
  const prevDisabled = pageNo <= 1;
  const nextDisabled = pageNo >= totalPages;

  let pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (pageNo > 3) pages.push('…');
    const start = Math.max(2, pageNo - 1);
    const end = Math.min(totalPages - 1, pageNo + 1);
    for (let i = start; i <= end; i++) {
      if (!pages.includes(i)) pages.push(i);
    }
    if (pageNo < totalPages - 2) pages.push('…');
    if (!pages.includes(totalPages)) pages.push(totalPages);
  }

  return (
    '<button class="page' + (prevDisabled ? ' page--disabled' : '') + '" type="button" data-page="' + (pageNo - 1) + '" aria-label="Previous page"' + (prevDisabled ? ' disabled' : '') + '><i data-lucide="chevron-left"></i></button>' +
    pages.map((p) => {
      if (p === '…') return '<span class="page page--disabled">…</span>';
      return '<button class="page' + (p === pageNo ? ' page--active' : '') + '" type="button" data-page="' + p + '"' + (p === pageNo ? ' aria-current="page"' : '') + '>' + p + '</button>';
    }).join('') +
    '<button class="page' + (nextDisabled ? ' page--disabled' : '') + '" type="button" data-page="' + (pageNo + 1) + '" aria-label="Next page"' + (nextDisabled ? ' disabled' : '') + '><i data-lucide="chevron-right"></i></button>'
  );
}
