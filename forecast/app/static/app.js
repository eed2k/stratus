// Stratus Weather - nano-climate forecast
//
// Clears the loading overlay declared in base.html and drives its percentage.
//
// The overlay dismisses itself through a CSS animation with a hard timeout, so
// what happens here is an optimization rather than the mechanism: it clears the
// gate as soon as the page is actually ready instead of waiting the CSS timeout
// out. That ordering is deliberate. If this file fails to load or throws, the
// CSS still clears the overlay, so a script error can never leave the page
// blank. The same split applies to the ring: CSS animates it, this only adds
// the number.
//
// External file, not an inline script, so the page can run under a strict
// Content-Security-Policy.

document.addEventListener("DOMContentLoaded", function () {
  confirmDestructiveForms();
  dismissLoader();
});

// Typed confirmation is already required server-side for deleting a station.
// This is only a courtesy prompt, so it is fine that it depends on scripting.
function confirmDestructiveForms() {
  var forms = document.querySelectorAll("form[data-confirm]");
  for (var i = 0; i < forms.length; i++) {
    forms[i].addEventListener("submit", function (e) {
      if (!window.confirm(this.getAttribute("data-confirm"))) {
        e.preventDefault();
      }
    });
  }
}

function dismissLoader() {
  var loader = document.getElementById("page-loader");
  if (!loader) {
    return;
  }

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
    // Remove it once the fade is over, so a fixed overlay can never sit on top
    // of the page and swallow clicks.
    setTimeout(function () {
      if (loader.parentNode) {
        loader.parentNode.removeChild(loader);
      }
    }, 400);
  }

  // Waits for "load" rather than DOMContentLoaded so inline SVG charts have
  // taken their final size. That is what stops the layout settling visibly
  // after the page has already appeared.
  if (document.readyState === "complete") {
    requestAnimationFrame(function () {
      requestAnimationFrame(clear);
    });
  } else {
    window.addEventListener("load", function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(clear);
      });
    });
  }

  // Belt and braces: a stalled asset must not hold the overlay open past the
  // point where the CSS fallback has already faded it out.
  setTimeout(clear, 3000);
}
