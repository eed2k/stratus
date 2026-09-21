/* Lightning Data Demonstration - timelapse of one simulated day at Site A.
 *
 * PROCESS
 *   1. Generate 24 h of storm activity from a fixed seed, so every visitor sees
 *      the same sequence.
 *   2. Advance a simulated clock faster than real time.
 *   3. At each tick, aggregate the strikes up to that moment into the five
 *      distance bands and redraw.
 *   4. A band's cloud starts flashing on its first strike and keeps flashing
 *      until FLASH_HOLD_MIN passes with no further strike in that band.
 *
 * FLASH STATE
 *   Two windows are in play. The selected window (1 H to 24 H) supplies the
 *   numbers. The 12 h hold window supplies the cloud's color and whether it is
 *   flashing. A cloud can therefore be lit while a 1 H window reads zero for it.
 *   Flash cadence is real time, not simulated time, and shortens with the band's
 *   share of hold-window strikes.
 *
 * The band bounds, the energy bands, the cumulonimbus path and the zigzag bolt
 * are the same as the console: metrics.py DISTANCE_BANDS and _ENERGY_BANDS, and
 * CB_BODY and boltPath() from static/js/storm-view.js. The flash animation and
 * all colors come from the console's style.css.
 *
 * Self-contained. No network requests, no real data.
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  // ---- console constants -------------------------------------------------

  var E_MAX = 2097151;                 // AS3935 energy is 21-bit
  var Q = (E_MAX + 1) / 4;

  // metrics.py::_ENERGY_BANDS
  var ENERGY_BANDS = [
    { name: "Low",      lower: 0,     color: "#8aa0b8" },
    { name: "Moderate", lower: Q,     color: "#1b3a5b" },
    { name: "High",     lower: Q * 2, color: "#e08a1e" },
    { name: "Extreme",  lower: Q * 3, color: "#c0392b" }
  ];

  // metrics.py::DISTANCE_BANDS. lower inclusive, upper exclusive, last open.
  var DISTANCE_BANDS = [
    { key: "0-1",   label: "OVERHEAD",   range: "\u2264 1 km", lo: 0,      hi: 1.0001 },
    { key: "1-10",  label: "VERY CLOSE", range: "< 10 km",     lo: 1.0001, hi: 10 },
    { key: "10-20", label: "CLOSE",      range: "< 20 km",     lo: 10,     hi: 20 },
    { key: "20-30", label: "DISTANT",    range: "< 30 km",     lo: 20,     hi: 30 },
    { key: "30-40", label: "FAR",        range: "30-40 km",    lo: 30,     hi: null }
  ];

  // The sensor's 15 discrete distance steps.
  var STEPS = [1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40];

  // storm-view.js cloud paths, in the cloud's own units.
  var CB_BODY = "M-24 11C-33 11-35 1-27-3C-30-12-20-17-12-14" +
                "C-8-22 6-24 12-17C22-20 30-12 26-4C34-1 32 11 24 11Z";

  // Drawing box, matching storm-view.js in the console exactly. style.css caps
  // the rendered width, so the cloud no longer stretches to fill its column.
  var VB_W = 104, VB_H = 78, CX = 52, CY = 26, BOLT_TOP = 43, BOLT_END = 72;

  /* The channel, as three fixed paths. Identical to storm-view.js so this page
     and the console draw the same artwork. Glow fattest, core thinnest and
     inset, all three converging to one point. */
  var BOLT_GLOW_D = "M53.6 42L61.4 42L55.2 54.6L60.6 54.6L46.4 73.5L51.4 57.4L45.6 57.4L50.2 42Z";
  var BOLT_MAIN_D = "M54 43L60 43L55.4 54.6L59.4 54.6L47.6 72.6L51.6 57.4L46.8 57.4L51 43Z";
  var BOLT_CORE_D = "M55.4 44.4L57.6 44.4L54.6 55.6L56.8 55.6L49.6 68.6L52.4 56.6L50 56.6L53.2 44.4Z";

  // The channel is lightning-colored, not band-colored: blue-white with a
  // cooler blue bloom behind it and a white core. The band color still drives
  // the data block's border and label, where it carries information.
  // Brighter, because the channel is now read against a navy sky, not white.
  var BOLT_MAIN = "#f5fbff";
  var BOLT_GLOW = "#7dbcff";
  var BOLT_CORE = "#ffffff";
  var BOLT_HALO = "#bfe0ff";

  var STATION = "Site A";

  // A band keeps flashing until this long with no strike in it.
  var FLASH_HOLD_MIN = 12 * 60;        // simulated minutes

  /* One full strike cycle, matching the storm-* keyframes in style.css and
     FLASH_CYCLE_MS in storm-view.js. An active band repeats it, so it strikes
     once a second.

     This was 2260 ms, two seconds of which was the channel HOLDING lit, and the
     re-trigger gap was built on top of that (hold + 700 to hold + 3000). The
     repeat is now the CSS animation's own `infinite`, so these gaps only decide
     when a cell FIRST starts, not how often it strikes. */
  var FLASH_CYCLE_MS = 1000;
  var FLASH_MIN_MS = FLASH_CYCLE_MS;
  var FLASH_MAX_MS = FLASH_CYCLE_MS + 400;

  // ---- timelapse ---------------------------------------------------------

  var DAY_MIN = 24 * 60;               // simulated minutes in the run
  var SIM_START_HOUR = 6;              // clock starts at 06:00
  var TICK_MS = 100;                   // redraw interval, real time
  var speed = 360;                     // simulated seconds per real second
  var simMin = 0;                      // simulated minutes elapsed
  var playing = true;
  var windowMin = 1440;
  var lastRendered = -1;
  var emitted = 0;                     // strikes already added to the table

  // ---- helpers ----------------------------------------------------------

  function el(name, attrs, parent) {
    var n = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) {
      n.setAttribute(k, String(attrs[k]));
    });
    if (parent) parent.appendChild(n);
    return n;
  }

  function div(cls, text) {
    var d = document.createElement("div");
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* Simulated minutes since start -> wall clock string. */
  function clockAt(min) {
    var total = SIM_START_HOUR * 60 + min;
    return pad(Math.floor(total / 60) % 24) + ":" + pad(Math.floor(min % 60) === 0
      ? total % 60 : total % 60) + ":" + pad(Math.floor((min * 60) % 60));
  }

  function hhmm(min) {
    var total = SIM_START_HOUR * 60 + Math.floor(min);
    return pad(Math.floor(total / 60) % 24) + ":" + pad(total % 60);
  }

  function energyBand(e) {
    var v = Math.max(0, Math.min(E_MAX, Math.round(e)));
    var out = ENERGY_BANDS[0];
    for (var i = 0; i < ENERGY_BANDS.length; i++) {
      if (v >= ENERGY_BANDS[i].lower) out = ENERGY_BANDS[i];
    }
    return out;
  }

  function fmtEnergy(e) {
    return (e / 1e6).toFixed(2) + "M";
  }

  /* Fixed-seed PRNG so the demo is identical for every visitor. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20260823);

  function nearestStep(km) {
    var best = STEPS[0], bd = Infinity;
    STEPS.forEach(function (s) {
      var d = Math.abs(s - km);
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }

  /* Energy falls with distance as a trend with scatter, not a formula: a distant
     strike can still read strong. */
  function energyFor(km) {
    var near = 1 - Math.min(1, km / 40);
    var base = 0.20 + near * 0.76;
    var e = (base + (rand() - 0.5) * 0.28) * E_MAX;
    return Math.max(1, Math.min(E_MAX, Math.round(e)));
  }

  // ---- storm generation --------------------------------------------------

  /* Three cells across the 24 h: a distant one early, a close overnight pass,
     and a short afternoon build. Quiet gaps between them are deliberate, so the
     idle state and the window selector both have something to show. */
  function buildStorm() {
    var out = [];

    function cell(startMin, track, spacingMin, jitter) {
      var t = startMin;
      track.forEach(function (km) {
        var n = 1 + Math.floor(rand() * 3);      // a few strikes per position
        for (var i = 0; i < n; i++) {
          var step = nearestStep(km + (rand() - 0.5) * 3);
          out.push({ t: t + rand() * spacingMin, km: step, e: energyFor(step) });
        }
        t += spacingMin + (rand() - 0.5) * jitter;
      });
    }

    // The first cell starts early on purpose. It previously began at t=95, so
    // the timelapse opened on roughly 16 real seconds of a completely static
    // page: no strikes, no flashing, every counter zero. Play and Restart looked
    // broken because there was nothing for them to visibly change.
    cell(12, [40, 37, 34, 31, 34, 37, 40], 12, 4);

    // Main cell: approaches to overhead, then recedes.
    cell(360, [40, 34, 27, 24, 20, 17, 14, 12, 10, 8, 6, 5, 1, 1, 5, 8,
               12, 17, 24, 31, 40], 16, 6);

    // Short, sharp late build.
    cell(1010, [27, 20, 14, 10, 8, 10, 17, 27], 11, 4);

    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  var STORM = buildStorm();

  // ---- band aggregation, mirroring distance_band_summary -----------------

  function summarize(list) {
    var buckets = DISTANCE_BANDS.map(function () { return []; });
    list.forEach(function (s) {
      for (var i = 0; i < DISTANCE_BANDS.length; i++) {
        var b = DISTANCE_BANDS[i];
        if (s.km >= b.lo && (b.hi === null || s.km < b.hi)) {
          buckets[i].push(s.e);
          break;
        }
      }
    });
    var total = buckets.reduce(function (n, b) { return n + b.length; }, 0);
    return {
      total: total,
      bands: DISTANCE_BANDS.map(function (def, i) {
        var es = buckets[i];
        if (!es.length) {
          return { def: def, count: 0, peak: null, mean: null, low: null,
                   band: null, color: null };
        }
        var sum = es.reduce(function (a, b) { return a + b; }, 0);
        var mean = Math.round(sum / es.length);
        var eb = energyBand(mean);
        return {
          def: def, count: es.length,
          peak: Math.max.apply(null, es),
          mean: mean,
          low: Math.min.apply(null, es),
          band: eb.name, color: eb.color
        };
      })
    };
  }

  // ---- band cells --------------------------------------------------------

  var cellNodes = [];                   // one per band
  var armedBands = [];                  // is each band inside its flash hold?
  var nextFlashAt = [];                 // real-time ms, per band
  var flashShare = [];                  // share of hold-period strikes, 0..1

  /* Bolt geometry. One kink, so one zigzag: out to the side at mid-height and
     back to the vertical at the tip. The outline is filled and its width falls
     to zero at the tip, which is what gives the point; a stroke has uniform
     width and cannot converge. Returns { outline, center }. */
  /* FOUR TURNS, NOT ONE, AND NO BRANCH. Kept byte-identical in intent to
     storm-view.js::boltGeometry so this page matches the console exactly.

     The old centre-line had three points: base, one kink, tip. One reversal
     draws a letter Z, not a discharge. Jitter is a horizontal shift of the whole
     channel rather than a per-vertex wobble, because wobbling vertices distorted
     the silhouette into something that stopped reading as lightning. */
  function boltGeometry() {
    var dx = (Math.random() * 4.4 - 2.2);
    var shift = function (d) {
      return d.replace(/([ML])(-?[\d.]+) (-?[\d.]+)/g, function (_, cmd, x, y) {
        return cmd + (parseFloat(x) + dx).toFixed(1) + " " + y;
      });
    };
    return {
      glow: shift(BOLT_GLOW_D),
      outline: shift(BOLT_MAIN_D),
      core: shift(BOLT_CORE_D)
    };
  }

  function buildCell(def) {
    var wrap = div("storm-band is-idle");
    wrap.appendChild(div("storm-band-range", def.range.toUpperCase()));

    // No height attribute: "auto" is not a valid SVG length and the browser
    // rejects it. The stylesheet sets height:auto in CSS, where it is legal.
    var svg = el("svg", { viewBox: "0 0 " + VB_W + " " + VB_H,
      width: "100%", role: "img",
      "aria-label": def.range + " band" });
    wrap.appendChild(svg);

    var defs = el("defs", {}, svg);
    var fid = "blur-" + def.key.replace(/[^\w-]/g, "");
    var filt = el("filter", { id: fid, x: "-80%", y: "-80%",
                              width: "260%", height: "260%" }, defs);
    // Blur radius is in user units, so it has to come down with the viewBox:
    // at the old 3.6 the bloom smeared into a tube well past the tip and blunted
    // it. 130 -> 104 wide is a factor of 0.8.
    el("feGaussianBlur", { stdDeviation: 2.6 }, filt);

    var halo = el("circle", { cx: CX, cy: CY + 5, r: 22, fill: BOLT_HALO,
      filter: "url(#" + fid + ")", "class": "storm-halo", opacity: 0 }, svg);

    var g = el("g", { transform: "translate(" + CX + "," + CY + ") scale(1)" }, svg);
    el("path", { d: CB_BODY, "class": "cb-body" }, g);

    var geo = boltGeometry();
    var glow = el("path", { d: geo.outline, fill: BOLT_GLOW,
      "class": "storm-bolt storm-bolt-glow",
      filter: "url(#" + fid + ")" }, svg);
    var main = el("path", { d: geo.outline, fill: BOLT_MAIN,
      "class": "storm-bolt storm-bolt-main" }, svg);
    var core = el("path", { d: geo.core, fill: BOLT_CORE,
      "class": "storm-bolt storm-bolt-core" }, svg);

    var data = div("storm-band-data");
    wrap.appendChild(data);

    return {
      wrap: wrap, svg: svg, group: g, halo: halo,
      glow: glow, main: main, core: core, data: data, def: def
    };
  }

  /* Two summaries drive one cell.
       `win`  the selected window: supplies the numbers.
       `hold` the last FLASH_HOLD_MIN: supplies the cloud's color and whether
              it is armed, so a cell stays lit for 12 h after its last strike.
     They can disagree. A band whose last strike was 3 h ago stays lit while a
     1 H window shows zero for it: the cloud reports whether the cell is still
     live, the figures report the window being asked about. */
  function paintCell(node, win, hold, maxPeak) {
    var armed = hold.count > 0;
    var color = armed ? hold.color : "#93a0b0";

    node.wrap.classList.toggle("is-idle", !armed);
    node.wrap.style.setProperty("--band-color", color);

    // Size follows the 12-hour mean so the cloud does not jump when the window
    // changes.
    var frac = (armed && maxPeak) ? Math.max(0, Math.min(1, hold.mean / maxPeak)) : 0;
    /* Smaller cloud, matching storm-view.js: 0.56 to 0.62 active, 0.52 idle,
       down from 0.62 to 0.92. It leaves the channel as the dominant element in
       the cell, which is half of what makes a strike look intense. */
    var scale = (frac > 0) ? (0.56 + frac * 0.06) : 0.52;
    node.group.setAttribute("transform",
      "translate(" + CX + "," + CY + ") scale(" + scale.toFixed(3) + ")");

    // The channel keeps its blue-white lightning colors in every band: only
    // the data block below is tinted by band color.

    var html =
      '<div class="storm-band-count">' + win.count +
        ' <span>' + (win.count === 1 ? "strike" : "strikes") + '</span></div>' +
      '<div class="storm-band-label">' + win.def.label + '</div>';
    if (win.count > 0) {
      html += '<div class="storm-band-rows">' +
        '<div class="storm-band-row"><span>peak</span><b>' + fmtEnergy(win.peak) + '</b></div>' +
        '<div class="storm-band-row"><span>mean</span><b>' + fmtEnergy(win.mean) + '</b></div>' +
        '<div class="storm-band-row"><span>low</span><b>'  + fmtEnergy(win.low) + '</b></div>' +
        '<div class="storm-band-row storm-band-row-sep"><span>band</span>' +
          '<b style="color:' + win.color + '">' + win.band + '</b></div>' +
        '</div>';
    } else if (armed) {
      // Live, but nothing inside the window being displayed.
      html += '<div class="storm-band-none">none in this window</div>';
    } else {
      html += '<div class="storm-band-none">no strikes recorded</div>';
    }
    node.data.innerHTML = html;
    return armed;
  }

  /* Repeat interval for band `i`, real ms. Shorter when the band is busier over
     the flash-hold period, so activity level reads without another number. */
  function flashInterval(i) {
    var share = flashShare[i] || 0;                 // 0..1
    var span = FLASH_MAX_MS - FLASH_MIN_MS;
    var base = FLASH_MAX_MS - share * span;
    return base + Math.random() * base * 0.45;      // irregular, not a metronome
  }

  /* Flash every armed band on its own schedule. */
  function serviceFlashes(now) {
    for (var i = 0; i < cellNodes.length; i++) {
      if (!armedBands[i]) {
        nextFlashAt[i] = 0;
        continue;
      }
      if (!nextFlashAt[i] || now >= nextFlashAt[i]) {
        flashCell(cellNodes[i]);
        nextFlashAt[i] = now + flashInterval(i);
      }
    }
  }

  /* Reposition the channel and let CSS run it. The animation is `infinite` at
     1000 ms, so an active band strikes once a second with no timer involved;
     calling this again only re-jitters the position and restarts the cycle. */
  function flashCell(node) {
    var g = boltGeometry();
    node.glow.setAttribute("d", g.glow);
    node.main.setAttribute("d", g.outline);
    node.core.setAttribute("d", g.core);
    node.wrap.classList.remove("is-flashing");
    void node.wrap.offsetWidth;                 // restart the animation
    node.wrap.classList.add("is-flashing");
  }

  function bandIndexFor(km) {
    for (var i = 0; i < DISTANCE_BANDS.length; i++) {
      var b = DISTANCE_BANDS[i];
      if (km >= b.lo && (b.hi === null || km < b.hi)) return i;
    }
    return -1;
  }

  // ---- track chart -------------------------------------------------------

  function drawTrack(upToMin) {
    var host = document.getElementById("track");
    var W = 960, H = 200, padL = 44, padR = 12, padT = 12, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    host.textContent = "";
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": "Strike distance against time over the simulated day" }, host);

    el("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff",
                 stroke: "#b9c2cf" }, svg);

    // Distance gridlines at the band boundaries.
    [0, 10, 20, 30, 40].forEach(function (km) {
      var y = padT + (km / 40) * plotH;
      el("line", { x1: padL, y1: y.toFixed(1), x2: W - padR, y2: y.toFixed(1),
                   stroke: "#e6e9ee", "stroke-width": 1 }, svg);
      var t = el("text", { x: padL - 6, y: (y + 3.5).toFixed(1),
        "text-anchor": "end", "font-size": 9, fill: "#6b7280",
        "font-family": "Consolas, monospace" }, svg);
      t.textContent = km + " km";
    });

    // Hour marks.
    for (var h = 0; h <= 24; h += 3) {
      var x = padL + (h / 24) * plotW;
      el("line", { x1: x.toFixed(1), y1: padT, x2: x.toFixed(1), y2: padT + plotH,
                   stroke: "#f1f3f6", "stroke-width": 1 }, svg);
      var lbl = el("text", { x: x.toFixed(1), y: H - 8, "text-anchor": "middle",
        "font-size": 9, fill: "#6b7280",
        "font-family": "Consolas, monospace" }, svg);
      lbl.textContent = pad((SIM_START_HOUR + h) % 24) + ":00";
    }

    // Strikes so far.
    STORM.forEach(function (s) {
      if (s.t > upToMin) return;
      var x = padL + (s.t / DAY_MIN) * plotW;
      var y = padT + (s.km / 40) * plotH;
      el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.6,
        fill: energyBand(s.e).color, "fill-opacity": 0.85 }, svg);
    });

    // Playhead.
    var px = padL + (upToMin / DAY_MIN) * plotW;
    el("line", { x1: px.toFixed(1), y1: padT, x2: px.toFixed(1), y2: padT + plotH,
                 stroke: "#0a2540", "stroke-width": 1.2 }, svg);
  }

  // ---- event table -------------------------------------------------------

  function addEvents(upToMin) {
    var body = document.getElementById("events");
    var added = [];
    while (emitted < STORM.length && STORM[emitted].t <= upToMin) {
      added.push(STORM[emitted]);
      emitted++;
    }
    if (!added.length) return added;

    if (body.querySelector("td[colspan]")) body.textContent = "";

    added.reverse().forEach(function (s) {
      var eb = energyBand(s.e);
      var tr = document.createElement("tr");
      tr.className = "is-new";
      tr.innerHTML =
        "<td>" + hhmm(s.t) + "</td>" +
        "<td>" + STATION + "</td>" +
        '<td class="num">' + s.km.toFixed(1) + "</td>" +
        '<td class="num">' + s.e.toLocaleString("en-ZA") + "</td>" +
        '<td style="color:' + eb.color + '">' + eb.name + "</td>";
      body.insertBefore(tr, body.firstChild);
    });

    // Keep the table short: it is a rolling view, not an archive.
    while (body.childNodes.length > 25) body.removeChild(body.lastChild);
    return added;
  }

  // ---- render ------------------------------------------------------------

  function render(force) {
    var whole = Math.floor(simMin);
    if (!force && whole === lastRendered) return;
    lastRendered = whole;

    var visible = STORM.filter(function (s) {
      return s.t <= simMin && s.t > simMin - windowMin;
    });
    var summary = summarize(visible);

    // Activity over the flash-hold period, which is what keeps a cloud lit.
    var held = STORM.filter(function (s) {
      return s.t <= simMin && s.t > simMin - FLASH_HOLD_MIN;
    });
    var holdSummary = summarize(held);

    var maxPeak = 0;
    holdSummary.bands.forEach(function (b) {
      if (b.peak && b.peak > maxPeak) maxPeak = b.peak;
    });
    summary.bands.forEach(function (b, i) {
      armedBands[i] = paintCell(cellNodes[i], b, holdSummary.bands[i], maxPeak);
      flashShare[i] = holdSummary.total
        ? holdSummary.bands[i].count / holdSummary.total : 0;
    });

    var hrs = windowMin / 60;
    document.getElementById("storm-summary").textContent =
      summary.total + (summary.total === 1 ? " strike" : " strikes") +
      " in the last " + hrs + " h  \u00b7  grouped by distance, nearest first";

    // KPIs over the whole run so far, not just the window.
    var soFar = STORM.filter(function (s) { return s.t <= simMin; });
    document.getElementById("kpi-total").textContent = soFar.length;
    var closest = soFar.length
      ? soFar.reduce(function (m, s) { return Math.min(m, s.km); }, Infinity) : null;
    document.getElementById("kpi-closest").textContent =
      closest === null ? "-" : closest.toFixed(0);
    document.getElementById("kpi-last").textContent =
      soFar.length ? soFar[soFar.length - 1].km.toFixed(0) : "-";

    document.getElementById("simclock").textContent = hhmm(simMin) + ":00";
    document.getElementById("simday").textContent =
      "hour " + Math.floor(simMin / 60) + " of 24";
    var pct = Math.min(100, (simMin / DAY_MIN) * 100);
    document.getElementById("progresspct").textContent = pct.toFixed(0) + "%";
    document.getElementById("progressbar").style.width = pct.toFixed(1) + "%";

    drawTrack(simMin);
  }

  // ---- clock -------------------------------------------------------------

  var lastFrame = 0;

  function tick(now) {
    if (!lastFrame) lastFrame = now;
    var dtReal = (now - lastFrame) / 1000;
    lastFrame = now;

    if (playing) {
      var before = simMin;
      simMin += (dtReal * speed) / 60;

      // Flash immediately on arrival, so a strike is never missed between the
      // repeat intervals below.
      STORM.forEach(function (s) {
        if (s.t > before && s.t <= simMin) {
          var i = bandIndexFor(s.km);
          if (i >= 0) {
            flashCell(cellNodes[i]);
            nextFlashAt[i] = now + flashInterval(i);
          }
        }
      });
      addEvents(simMin);

      if (simMin >= DAY_MIN) {
        simMin = DAY_MIN;
        render(true);
        // Hold on the finished day briefly, then loop.
        playing = false;
        document.getElementById("play").textContent = "Play";
        window.setTimeout(restart, 4000);
      }
      render(false);
    }

    // Armed bands keep flashing whether or not the clock is running, so a
    // paused display still shows which cells are live.
    serviceFlashes(now);

    window.requestAnimationFrame(tick);
  }

  function restart() {
    simMin = 0;
    emitted = 0;
    lastRendered = -1;
    rand = mulberry32(20260823);
    document.getElementById("events").innerHTML =
      '<tr><td colspan="5" class="muted">No strikes recorded yet.</td></tr>';
    playing = true;
    document.getElementById("play").textContent = "Pause";
    render(true);
  }

  // ---- controls ----------------------------------------------------------

  function initControls() {
    document.getElementById("play").addEventListener("click", function () {
      playing = !playing;
      this.textContent = playing ? "Pause" : "Play";
    });
    document.getElementById("restart").addEventListener("click", restart);

    var speedBar = document.querySelector(".demo-speed");
    speedBar.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-speed]");
      if (!b) return;
      speed = parseInt(b.getAttribute("data-speed"), 10);
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) {
        x.setAttribute("aria-pressed", x === b ? "true" : "false");
      });
    });

    var rangeBar = document.querySelector(".storm-range");
    rangeBar.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-window]");
      if (!b) return;
      windowMin = parseInt(b.getAttribute("data-window"), 10);
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) {
        x.setAttribute("aria-pressed", x === b ? "true" : "false");
      });
      render(true);
    });
  }

  // ---- start -------------------------------------------------------------

  function start() {
    var host = document.getElementById("bands");
    DISTANCE_BANDS.forEach(function (def) {
      var node = buildCell(def);
      cellNodes.push(node);
      host.appendChild(node.wrap);
    });
    initControls();
    render(true);
    window.requestAnimationFrame(tick);

    var loader = document.getElementById("page-loader");
    if (loader) {
      loader.classList.add("is-done");
      window.setTimeout(function () {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
      }, 400);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
