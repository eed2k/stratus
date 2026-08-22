// Confirmation prompts for destructive actions. External file so the page
// can run under a strict Content-Security-Policy (no inline scripts).
document.addEventListener("DOMContentLoaded", function () {
  var forms = document.querySelectorAll("form[data-confirm]");
  for (var i = 0; i < forms.length; i++) {
    forms[i].addEventListener("submit", function (e) {
      if (!window.confirm(this.getAttribute("data-confirm"))) {
        e.preventDefault();
      }
    });
  }

  startSastClock();
  dismissLoader();
});

// Clear the loading overlay declared in base.html.
//
// The overlay already dismisses itself through a CSS animation, so this is an
// optimisation, not the mechanism: it clears the overlay as soon as the page is
// genuinely ready instead of waiting out the CSS timeout. That ordering matters
// because the fallback must not depend on this file running at all.
//
// It waits for window "load" rather than DOMContentLoaded so the deferred
// Recharts bundles have run and the charts have taken their final size. That is
// what stops the second half of the complaint: the layout settling visibly
// after the page appears.
function dismissLoader() {
  var loader = document.getElementById("page-loader");
  if (!loader) {
    return;
  }

  var cleared = false;
  function clear() {
    if (cleared) {
      return;
    }
    cleared = true;
    loader.classList.add("is-done");
    // Take it out of the document once the fade is over so a fixed overlay can
    // never sit on top of the page and swallow clicks.
    setTimeout(function () {
      if (loader.parentNode) {
        loader.parentNode.removeChild(loader);
      }
    }, 400);
  }

  if (document.readyState === "complete") {
    // Already loaded: give the layout one frame to settle, then clear.
    requestAnimationFrame(function () { requestAnimationFrame(clear); });
  } else {
    window.addEventListener("load", function () {
      requestAnimationFrame(function () { requestAnimationFrame(clear); });
    });
  }

  // Belt and braces: a stalled asset must not hold the overlay open past the
  // point where the CSS fallback has already faded it out.
  setTimeout(clear, 3000);
}

// Live SAST (UTC+2, no DST) clock for the title bar. Computed from UTC so it
// shows the correct South African time regardless of the viewer's own
// timezone or clock settings.
function startSastClock() {
  var el = document.getElementById("sast-clock");
  if (!el) {
    return;
  }
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function tick() {
    var now = new Date();
    // Shift the UTC epoch by +2h, then read the UTC fields = SAST wall clock.
    var sast = new Date(now.getTime() + 2 * 3600 * 1000);
    var text =
      sast.getUTCFullYear() + "-" +
      pad(sast.getUTCMonth() + 1) + "-" +
      pad(sast.getUTCDate()) + " " +
      pad(sast.getUTCHours()) + ":" +
      pad(sast.getUTCMinutes()) + ":" +
      pad(sast.getUTCSeconds());
    el.textContent = text;
  }
  tick();
  setInterval(tick, 1000);
}
