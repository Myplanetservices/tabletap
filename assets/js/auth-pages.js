/* ==========================================================================
   TableTap — auth-pages.js
   Login, kitchen PIN login and accepting an invite.
   ========================================================================== */

import { login, ownerLogin, adminLogin, kitchenLogin, createOwnerFromInvite, ROOT } from './auth.js';
import { getAll, query } from './store.js';
import { qs, esc, formatDateTime, toast } from './helpers.js';
import { sendEmail, renderEmailTemplate } from './mailer.js';

function showError(id, message) {
  const box = document.getElementById(id);
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
}

/* ------------------------------------------------------------------ login -- */
const isAdminPage = location.pathname.includes('/admin/');
const ADMIN_LOCK_KEY = 'tqr_admin_lock';

function checkAdminLock() {
  try {
    const raw = localStorage.getItem(ADMIN_LOCK_KEY);
    if (!raw) return null;
    const lock = JSON.parse(raw);
    const now = Date.now();
    if (lock.until && lock.until > now) {
      return Math.ceil((lock.until - now) / 1000);
    } else {
      localStorage.removeItem(ADMIN_LOCK_KEY);
      return null;
    }
  } catch (e) {
    return null;
  }
}

function recordAdminFailedAttempt() {
  try {
    const raw = localStorage.getItem(ADMIN_LOCK_KEY);
    let lock = raw ? JSON.parse(raw) : { attempts: 0, until: 0 };
    lock.attempts = (lock.attempts || 0) + 1;
    if (lock.attempts >= 5) {
      lock.until = Date.now() + 15 * 60 * 1000; // 15 minutes lockout
    }
    localStorage.setItem(ADMIN_LOCK_KEY, JSON.stringify(lock));
    return lock;
  } catch (e) {
    return { attempts: 1 };
  }
}

function clearAdminLock() {
  localStorage.removeItem(ADMIN_LOCK_KEY);
}

const loginForm = document.querySelector('.auth-card__form');
if (loginForm && document.getElementById('login-error')) {
  let lockTimer = null;
  function updateLockUI() {
    const remainingSec = checkAdminLock();
    const button = loginForm.querySelector('button[type="submit"]');
    if (remainingSec && remainingSec > 0) {
      const min = Math.floor(remainingSec / 60);
      const sec = remainingSec % 60;
      showError('login-error', 'Too many failed attempts. Please wait ' + min + 'm ' + (sec < 10 ? '0' : '') + sec + 's before trying again.');
      if (button) button.disabled = true;
      if (!lockTimer) {
        lockTimer = setInterval(updateLockUI, 1000);
      }
    } else {
      if (lockTimer) {
        clearInterval(lockTimer);
        lockTimer = null;
      }
      if (button && button.textContent === 'Log in') button.disabled = false;
      const currentErr = document.getElementById('login-error')?.textContent;
      if (currentErr && currentErr.includes('Too many failed attempts')) {
        showError('login-error', '');
      }
    }
  }

  if (isAdminPage) {
    updateLockUI();
  }

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    showError('login-error', '');

    if (isAdminPage) {
      const rem = checkAdminLock();
      if (rem && rem > 0) {
        updateLockUI();
        return;
      }
    }

    const email = loginForm.querySelector('#email').value;
    const password = loginForm.querySelector('#password').value;
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Signing in…';

    try {
      if (isAdminPage) {
        adminLogin(email, password);
        clearAdminLock();
        location.href = 'dashboard.html';
      } else {
        ownerLogin(email, password);
        location.href = '../owner/dashboard.html';
      }
    } catch (err) {
      if (isAdminPage) {
        const lock = recordAdminFailedAttempt();
        if (lock.attempts >= 5) {
          updateLockUI();
          button.disabled = true;
          button.textContent = 'Log in';
          return;
        }
      }
      showError('login-error', err.message);
      button.disabled = false;
      button.textContent = 'Log in';
    }
  });
}

/* ---------------------------------------------------------- kitchen login -- */
const pinBoxes = Array.from(document.querySelectorAll('.pin-box'));
pinBoxes.forEach((box, index) => {
  box.addEventListener('input', () => {
    box.value = box.value.replace(/\D/g, '').slice(0, 1);
    if (box.value && index < pinBoxes.length - 1) pinBoxes[index + 1].focus();
  });
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Backspace' && !box.value && index > 0) pinBoxes[index - 1].focus();
  });
  box.addEventListener('paste', (event) => {
    const digits = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 4);
    if (!digits) return;
    event.preventDefault();
    digits.split('').forEach((digit, i) => {
      if (pinBoxes[i]) pinBoxes[i].value = digit;
    });
    pinBoxes[Math.min(digits.length, 3)].focus();
  });
});

const kitchenForm = document.querySelector('.kitchen-card__form');
if (kitchenForm) {
  kitchenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    showError('kitchen-error', '');
    const code = document.getElementById('restaurant-code').value;
    const pin = pinBoxes.map((box) => box.value).join('');
    const button = kitchenForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const sess = kitchenLogin(code, pin);
      if (sess && sess.role === 'floor') {
        location.href = '../owner/floor.html';
      } else {
        location.href = '../kitchen/index.html';
      }
    } catch (err) {
      showError('kitchen-error', err.message);
      button.disabled = false;
    }
  });
}

/* --------------------------------------------------------------- invite ---- */
const inviteCard = document.querySelector('.auth-card--wide');
if (inviteCard) {
  const token = qs('token');
  const invites = getAll('invites');
  let invite = token ? invites.find((row) => row.token === token) : invites.find((row) => row.status === 'pending');

  const expired = (row) => new Date(row.expiresAt).getTime() < Date.now();

  function renderInvalid(title, text) {
    const body = inviteCard;
    body.innerHTML =
      '<h1 class="auth-card__title">' + esc(title) + '</h1>' +
      '<p class="auth-card__sub">' + esc(text) + '</p>' +
      '<div class="success-state" style="padding-top:24px">' +
      '<span class="success-state__icon"><i data-lucide="alert-triangle"></i></span>' +
      '<p class="success-state__text">Ask your TableTap contact to send a fresh invite — invites expire after 7 days.</p>' +
      '<a class="btn btn--primary" href="login.html">Back to login</a>' +
      '</div>';
    if (window.lucide) window.lucide.createIcons();
  }

  if (!invite) {
    renderInvalid('Invite not found', 'This invite link is not valid. It may have been revoked by the restaurant owner.');
  } else if (invite.status === 'revoked') {
    renderInvalid('Invite revoked', 'This invite was cancelled before it was used.');
  } else if (invite.status === 'accepted') {
    renderInvalid('Invite already used', 'This invite has already been accepted. Log in with your email and password instead.');
  } else if (invite.status === 'expired' || expired(invite)) {
    renderInvalid('Invite expired', 'This invite is older than 7 days, so it can no longer be used.');
  } else {
    const restEl = document.getElementById('invite-restaurant');
    if (restEl) restEl.textContent = invite.clientName;
    const ownerEl = document.getElementById('invite-owner');
    if (ownerEl) ownerEl.textContent = invite.ownerName;
    const sentEl = document.getElementById('invite-sent');
    if (sentEl) sentEl.textContent = formatDateTime(invite.createdAt);
    const emailField = document.getElementById('invite-email-field') || document.getElementById('invite-email');
    if (emailField) emailField.value = invite.email;

    const form = inviteCard.querySelector('form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      showError('invite-error', '');
      const password = document.getElementById('new-password').value;
      const confirm = document.getElementById('confirm-password').value;

      if (password.length < 8) return showError('invite-error', 'Use at least 8 characters.');
      if (!/\d/.test(password)) return showError('invite-error', 'Include at least one number.');
      if (password !== confirm) return showError('invite-error', 'The two passwords do not match.');

      try {
        createOwnerFromInvite(invite, password);

        // Send welcome email to new owner
        const welcomeHtml = renderEmailTemplate({
          title: 'Welcome to TableTap',
          heading: `Welcome to TableTap, ${invite.ownerName}!`,
          preheader: `Your account for ${invite.clientName} is now ready.`,
          bodyHtml: `
            <p style="margin:0 0 16px;">Hi ${esc(invite.ownerName)},</p>
            <p style="margin:0 0 16px;">Congratulations! Your TableTap account for <strong>${esc(invite.clientName)}</strong> is now active.</p>
            <p style="margin:0 0 16px;">You can now log in to set up your restaurant menu, customize pricing & taxes, print table QR codes, and pair your kitchen display.</p>
            <p style="margin:0 0 16px;">If you ever need any assistance or tips getting started, our team is always here to help.</p>
          `,
          actionText: 'Go to Owner Dashboard',
          actionUrl: new URL('../owner/dashboard.html', window.location.href).href,
          footnote: 'Keep this email for your records. Log in anytime at ' + new URL('../auth/login.html', window.location.href).href + '.',
        });

        sendEmail({
          to: invite.email,
          subject: `Welcome to TableTap — ${invite.clientName}`,
          html: welcomeHtml,
          type: 'welcome',
        });

        toast('Welcome to TableTap — your account is ready.');
        setTimeout(() => { location.href = '../owner/dashboard.html'; }, 700);
      } catch (err) {
        showError('invite-error', err.message);
      }
    });
  }
}
