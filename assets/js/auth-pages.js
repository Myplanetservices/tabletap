/* ==========================================================================
   TableTap — auth-pages.js
   Login, kitchen PIN login and accepting an invite.
   ========================================================================== */

import { login, kitchenLogin, createOwnerFromInvite, ROOT } from './auth.js';
import { getAll, query } from './store.js';
import { qs, esc, formatDateTime, toast } from './helpers.js';

function showError(id, message) {
  const box = document.getElementById(id);
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
}

/* ------------------------------------------------------------------ login -- */
const loginForm = document.querySelector('.auth-card__form');
if (loginForm && document.getElementById('login-error')) {
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    showError('login-error', '');
    const email = loginForm.querySelector('#email').value;
    const password = loginForm.querySelector('#password').value;
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const session = login(email, password);
      location.href = session.role === 'admin' ? '../admin/dashboard.html' : '../owner/dashboard.html';
    } catch (err) {
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
      kitchenLogin(code, pin);
      location.href = '../kitchen/index.html';
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
    document.getElementById('invite-restaurant').textContent = invite.clientName;
    document.getElementById('invite-owner').textContent = invite.ownerName;
    document.getElementById('invite-sent').textContent = formatDateTime(invite.createdAt);
    document.getElementById('invite-email-field').value = invite.email;

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
        toast('Welcome to TableTap — your account is ready.');
        setTimeout(() => { location.href = '../owner/dashboard.html'; }, 700);
      } catch (err) {
        showError('invite-error', err.message);
      }
    });
  }
}
