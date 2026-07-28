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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(DC);
