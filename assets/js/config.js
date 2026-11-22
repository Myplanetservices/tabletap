/* ==========================================================================
   TableTap — config.js
   Application Environment Configuration.
   ========================================================================== */

export const DEMO_MODE = true;

/** Safe logger that silences logs in production mode */
export const logger = {
  log: (...args) => {
    if (DEMO_MODE) console.log(...args);
  },
  warn: (...args) => {
    if (DEMO_MODE) console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
};
