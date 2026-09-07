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

  var pctEl = document.getElementById("pl-pct");
  var labelEl = document.getElementById("pl-label-pct");
  var arcEl = loader.querySelector(".pl-arc");

  // Circumference of the r=46 ring. Written out because the CSS needs the same
  // constant and cannot compute it either.
  var CIRC = 289.03;

  // Hand the arc over to this script.
  //
  // Until now CSS animated the ring on its own keyframe while this file printed
  // a number beside it, so the two were never showing the same value: the
  // keyframe ran on wall-clock time and the digits ran on their own, and on a
  // server-rendered page the ring snapped to full the instant .is-done landed
  // while the counter jumped straight from 0 to 100. That is why a subdomain did
  // not look like the main dashboard even after every color, size and duration
  // had been matched - the main app drives its ring from the same number it
  // prints, and now so does this.
  //
  // The keyframe stays in the stylesheet as the no-JS path; this class is what
  // switches it off, so a browser with scripting disabled still sees a moving
  // ring rather than a frozen one.
  if (arcEl) {
    loader.classList.add("pl-js");
  }

  var started = Date.now();
  var shown = 0;            // what the ring and the digits are currently showing
  var complete = false;     // the page is ready; drive to 100 and fade
  var ticker = null;

  function paint(value) {
    shown = value;
    if (pctEl) {
      pctEl.textContent = value + "%";
    }
    if (labelEl) {
      labelEl.textContent = " " + value + "%";
    }
    if (arcEl) {
      arcEl.style.strokeDashoffset = String(CIRC * (1 - value / 100));
    }
  }

  /* One frame of the main app's DashboardLoadingOverlay, ported literally.
   *
   *   target   = 100 once ready, otherwise a floor that creeps to 90 over 12s
   *   step     = at least 1, otherwise a sixth of the remaining distance
   *   interval = 80ms
   *
   * The easing is the part that matters here. Jumping to 100 on ready is what
   * made the percentage invisible on these pages: a server-rendered document is
   * ready in a fraction of a second, so there was nothing to see. Easing at a
   * sixth of the gap per frame takes roughly a second and a half to close, which
   * is the same unhurried climb the main dashboard shows, and it is real - it
   * starts when the page starts and ends when the page is ready.
   */
  function tick() {
    var elapsed = Date.now() - started;
    var timeFloor = Math.min(90, Math.round((elapsed / 12000) * 90));
    var target = complete ? 100 : timeFloor;
    if (shown >= target) {
      if (complete && shown >= 100) {
        finish();
      }
      return;
    }
    var step = Math.max(1, Math.ceil((target - shown) / 6));
    paint(Math.min(target, shown + step));
    if (complete && shown >= 100) {
      finish();
    }
  }

  var faded = false;
  function finish() {
    if (faded) {
      return;
    }
    faded = true;
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    loader.classList.add("is-done");
    // Remove it once the fade is over, so a fixed overlay can never sit on top
    // of the page and swallow clicks.
    setTimeout(function () {
      if (loader.parentNode) {
        loader.parentNode.removeChild(loader);
      }
    }, 400);
  }

  /* Ready: stop holding, but let the ring finish rather than cutting it off.
   *
   * The main app does exactly this - it reveals the dashboard only once the bar
   * has visibly reached 100 - so a fast page still shows the whole animation
   * instead of a flash. The cost is a fraction of a second on a page that was
   * already rendered, and the benefit is that all five surfaces look like one
   * product.
   */
  function ready() {
    complete = true;
  }

  paint(0);
  ticker = setInterval(tick, 80);

  // Waits for "load" rather than DOMContentLoaded so inline SVG charts have
  // taken their final size. That is what stops the layout settling visibly
  // after the page has already appeared.
  if (document.readyState === "complete") {
    requestAnimationFrame(function () {
      requestAnimationFrame(ready);
    });
  } else {
    window.addEventListener("load", function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(ready);
      });
    });
  }

  // Belt and braces: a stalled asset must not hold the overlay open past the
  // point where the CSS fallback has already faded it out. Goes straight to the
  // fade rather than through the easing, because at this point the page has had
  // three seconds and the animation is no longer the priority.
  setTimeout(finish, 3000);
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
