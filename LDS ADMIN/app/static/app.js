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

// Clear the loading overlay declared in base.html, and drive its percentage.
//
// The overlay already dismisses itself through a CSS animation, so the
// dismissal here is an optimization, not the mechanism: it clears the overlay as
// soon as the page is genuinely ready instead of waiting out the CSS timeout.
// That ordering matters because the fallback must not depend on this file
// running at all. The same applies to the ring: CSS animates it, this only adds
// the number.
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

  // Drive the percentage next to the ring. The ring itself is animated by CSS
  // so it still works with scripting off; only the number needs this. It tracks
  // the same 2.4s ease-out to 90% the CSS arc uses, so the digits and the arc
  // agree instead of telling two different stories.
  var pctEl = document.getElementById("pl-pct");
  var labelEl = document.getElementById("pl-label-pct");
  var started = Date.now();
  var ticker = null;

  function paint(value) {
    if (pctEl) {
      pctEl.textContent = value + "%";
    }
    if (labelEl) {
      labelEl.textContent = " " + value + "%";
    }
  }

  // Matches the CSS arc's 12s linear climb to 90%, and that in turn is exactly
  // the main app's time floor: min(90, elapsed / 12000 * 90). Keeping all three
  // on the same rate is what makes this read as the same animation rather than
  // a faster imitation of it.
  function tick() {
    var linear = Math.min(1, (Date.now() - started) / 12000);
    paint(Math.min(90, Math.round(linear * 90)));
  }

  paint(0);
  ticker = setInterval(tick, 80);

  var cleared = false;
  function clear() {
    if (cleared) {
      return;
    }
    cleared = true;
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    // Show 100 before fading, so the ring is never seen jumping from a partial
    // value straight into the page.
    paint(100);
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
