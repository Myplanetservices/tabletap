/* ==========================================================================
   TableTap — alerts.js
   Web Audio API synthesized sound effects, browser notifications, and wake lock.
   ========================================================================== */

const SOUND_PREFS_KEY = 'tqr_sound_prefs';

function getSoundPrefs() {
  try {
    const raw = localStorage.getItem(SOUND_PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    volume: 0.8,
    newOrder: true,
    orderReady: true,
    callWaiter: true,
    billRequest: true,
  };
}

export function saveSoundPrefs(prefs) {
  try {
    localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {}
}

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play synthesized sound using Web Audio API.
 * Types:
 * - 'newOrder': Two-tone chime (high-low cheerful)
 * - 'orderReady': Triple bell (bright clear bell chimes)
 * - 'callWaiter': Soft double beep
 * - 'billRequest': Single register ding (crisp high metallic tone)
 */
export function playSound(type) {
  const prefs = getSoundPrefs();
  if (prefs[type] === false) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const vol = Math.max(0, Math.min(1, Number(prefs.volume ?? 0.8)));
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(vol * 0.35, ctx.currentTime);
  masterGain.connect(ctx.destination);

  const t = ctx.currentTime;

  if (type === 'newOrder') {
    // Two-tone chime (G5 -> C6)
    playTone(ctx, masterGain, 783.99, t, 0.25);
    playTone(ctx, masterGain, 1046.50, t + 0.18, 0.4);
  } else if (type === 'orderReady') {
    // Triple bell (E5 -> G5 -> B5)
    playTone(ctx, masterGain, 659.25, t, 0.2);
    playTone(ctx, masterGain, 783.99, t + 0.15, 0.2);
    playTone(ctx, masterGain, 987.77, t + 0.30, 0.45);
  } else if (type === 'callWaiter') {
    // Soft double beep (A5)
    playTone(ctx, masterGain, 880, t, 0.12, 'sine');
    playTone(ctx, masterGain, 880, t + 0.16, 0.18, 'sine');
  } else if (type === 'billRequest') {
    // Single register ding (C6 high crisp ping with harmonic)
    playTone(ctx, masterGain, 1046.50, t, 0.6, 'sine');
    playTone(ctx, masterGain, 2093.00, t, 0.3, 'triangle');
  }
}

function playTone(ctx, destination, freq, startTime, duration, type = 'sine') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);

  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.exponentialRampToValueAtTime(1, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

/**
 * Request Screen Wake Lock (keep screen awake)
 */
let wakeLockSentinel = null;
export async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (wakeLockSentinel !== null && document.visibilityState === 'visible') {
          wakeLockSentinel = await navigator.wakeLock.request('screen').catch(() => null);
        }
      });
      return true;
    } catch (err) {
      console.warn('Wake lock error:', err);
    }
  }
  return false;
}

/**
 * Request browser Notification permission
 */
export async function requestNotificationPermission() {
  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      try {
        const res = await Notification.requestPermission();
        return res === 'granted';
      } catch (err) {}
    }
    return Notification.permission === 'granted';
  }
  return false;
}

/**
 * Show a browser notification if in background
 */
export function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notif = new Notification(title, {
        body,
        icon: '../assets/img/icon-192.png',
        tag: 'tabletap-alert',
      });
      notif.onclick = () => {
        window.focus();
        notif.close();
      };
    } catch (e) {}
  }
}

/**
 * Phone vibration
 */
export function vibratePhone(pattern = [200, 100, 200]) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}

/**
 * Fullscreen Shift Overlay:
 * Restaurant name, staff name, big button.
 * Unlocks audio, requests Notification permission, requests Screen Wake Lock.
 */
export function showShiftOverlay({ restaurantName = 'TableTap', staffName = 'Staff', onStarted = () => {} }) {
  const overlay = document.createElement('div');
  overlay.id = 'shift-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(18, 16, 15, 0.96);
    backdrop-filter: blur(8px);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: #FAFAF9;
    text-align: center;
    font-family: var(--font-sans, system-ui, sans-serif);
  `;

  overlay.innerHTML = `
    <div style="max-width: 440px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 20px;">
      <div style="width: 64px; height: 64px; border-radius: 16px; background: var(--accent, #1F4D3A); display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; color: #FFF; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
        T
      </div>

      <div>
        <p style="text-transform: uppercase; letter-spacing: 0.1em; font-size: 13px; font-weight: 700; color: var(--accent, #10B981); margin: 0 0 6px;">
          ${restaurantName}
        </p>
        <h1 style="font-size: 26px; font-weight: 800; margin: 0 0 8px; color: #FFF; letter-spacing: -0.02em;">
          Ready to Start Shift?
        </h1>
        <p style="font-size: 15px; color: #A8A29E; margin: 0; line-height: 1.5;">
          Signed in as <strong>${staffName}</strong>. Tap below to enable live chimes, alerts, and keep screen awake during service.
        </p>
      </div>

      <button id="btn-start-shift" type="button" class="btn btn--primary btn--lg btn--block" style="font-size: 17px; font-weight: 700; height: 56px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;">
        Start Shift
      </button>

      <span style="font-size: 12px; color: #78716C;">
        Requires audio, screen awake, & notification permissions
      </span>
    </div>
  `;

  document.body.appendChild(overlay);

  const btn = overlay.querySelector('#btn-start-shift');
  btn.addEventListener('click', async () => {
    // 1. Audio unlock
    getAudioContext();
    playSound('newOrder');

    // 2. Notifications
    await requestNotificationPermission();

    // 3. Screen wake lock
    await requestWakeLock();

    // Remove overlay
    overlay.style.transition = 'opacity 0.25s ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      onStarted();
    }, 250);
  });
}
