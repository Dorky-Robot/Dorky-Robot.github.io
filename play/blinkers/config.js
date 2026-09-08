// Where the Blinking Contest posts scores and reads the board.
//
// The Worker lives in Dorky-Robot/blinkers-api. After `wrangler deploy` prints
// the workers.dev URL (or after a custom route is attached), put it here — this
// is the only line in the site that needs to change.
window.BLINKERS_API = 'https://blinkers-api.dorkyrobot.workers.dev';

// Local development points at `wrangler dev` instead. Deliberately keyed off
// the hostname rather than a query parameter: a `?api=` override would let any
// link decide where a player's handle and score get posted.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.BLINKERS_API = localStorage.getItem('blinkersApiBase') || 'http://127.0.0.1:8787';
}
