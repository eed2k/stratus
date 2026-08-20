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
});

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
