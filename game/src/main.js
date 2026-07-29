/* =========================================================================
   DEEP CAST — main.js
   Wire the canvas, the UI and the game together, then get out of the way.
   ========================================================================= */
(function (DC) {
  'use strict';

  function start() {
    var canvas = document.getElementById('gl');
    var ui = new DC.UI();

    var game;
    try {
      game = new DC.Game(canvas, ui);
    } catch (err) {
      ui.fatal(err.message || String(err));
      return;
    }

    // The renderer only exists after the second boot step, so the UI attaches
    // once the world is up rather than at construction time.
    var origHide = ui.hideLoading.bind(ui);
    ui.hideLoading = function () {
      origHide();
      ui.attach(game);
      ui.refreshLureBar();
      // index.html?demo tops up a fresh save; say so once the UI can show it.
      if (game.demoGranted) {
        ui.showToast('Demo kit: every rod and lure, the sounder, and $30,000.', 'good');
      }
    };

    window.DEEPCAST = game;   // handy in the console; harmless otherwise
    game.boot();

    // Autosave every half minute of play, plus on the way out.
    setInterval(function () { if (game.started) game.save(); }, 30000);
    window.addEventListener('beforeunload', function () { if (game.started) game.save(); });
  }

  /* On the desktop build the save of record is a file, not site data. Pull it
     into localStorage before anything reads it, so the whole game downstream
     stays exactly as it is in the browser. A missing or unreadable file just
     falls through to whatever localStorage already had. */
  function boot() {
    var D = window.DEEPCAST_DESKTOP;
    if (!D || !D.readSave) return start();
    var done = false;
    var go = function () { if (!done) { done = true; start(); } };
    // Never let a wedged IPC call stop the game from starting.
    setTimeout(go, 2500);
    try {
      D.readSave().then(function (data) {
        if (data) {
          try { localStorage.setItem('deepcast.save.v1', JSON.stringify(data)); } catch (e) { /* ignore */ }
        }
        go();
      }, go);
    } catch (e) { go(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(DC);
