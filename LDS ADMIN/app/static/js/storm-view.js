/* =====================================================================
   Storm-activity display: recorded strikes grouped into five proximity
   bands, one animated thundercloud per band.

   Mirrors the server-side renderer in app/charts.py::storm_bands_svg so the
   dashboard and the PDF report show the same picture. The band maths is NOT
   done here: app/metrics.py::distance_band_summary computes it once on the
   server and both views consume the result, so they cannot disagree.

   The AS3935 measures distance but NOT bearing, so nothing here is placed in
   any direction. Bands read nearest-to-farthest left to right, which is a
   proximity ordering, not a map.

   Cell colors come from the payload (the panel's own energy-band palette in
   metrics.py::_ENERGY_BANDS). They are deliberately not duplicated here.

   No inline script and no external origin: runs under
   "script-src 'self'; connect-src 'self'". Built with plain DOM and inline
   SVG, so it needs no vendor bundle at all and degrades to a plain table.
   ===================================================================== */
(function () {
  "use strict";

  var POLL_MS = 30000;          // refresh cadence
  var SVG_NS = "http://www.w3.org/2000/svg";
  var IDLE_COLOR = "#93a0b0";

  // Selectable windows, in minutes. The endpoint caps at 7 days.
  var RANGES = [
    { label: "1 H",  min: 60 },
    { label: "3 H",  min: 180 },
    { label: "6 H",  min: 360 },
    { label: "12 H", min: 720 },
    { label: "24 H", min: 1440 }
  ];

  // Cloud geometry, in the cell's own viewBox units.
  //
  // Tightened around the artwork so the cell is shorter and narrower, and the
  // stylesheet caps the rendered width so a cloud no longer stretches to fill
  // its whole grid column. Shared with charts.py::storm_bands_svg; keep in step.
  var VB_W = 104, VB_H = 78, CX = 52, CY = 26, BOLT_TOP = 43, BOLT_END = 72;

  /* The channel, as three fixed paths.
     Built once rather than generated per strike: the shape is what makes it read
     as lightning, so it is pinned, and only its horizontal position varies. See
     boltGeometry() for why. Glow is fattest, core is thinnest and inset, all
     three converge to the same point at the bottom. */
  var BOLT_GLOW_D = "M53.6 42L61.4 42L55.2 54.6L60.6 54.6L46.4 73.5L51.4 57.4L45.6 57.4L50.2 42Z";
  var BOLT_MAIN_D = "M54 43L60 43L55.4 54.6L59.4 54.6L47.6 72.6L51.6 57.4L46.8 57.4L51 43Z";
  var BOLT_CORE_D = "M55.4 44.4L57.6 44.4L54.6 55.6L56.8 55.6L49.6 68.6L52.4 56.6L50 56.6L53.2 44.4Z";

  // Lightning is blue-white in every band. The band color still drives the
  // header and the data block, where it carries information; painting the
  // channel with it made a distant strike look orange rather than like
  // lightning.
  // Brighter than before, because the channel is now read against a navy sky
  // rather than white. Intensity here is contrast, not size.
  var BOLT_MAIN = "#f5fbff";
  var BOLT_GLOW = "#7dbcff";
  var BOLT_CORE = "#ffffff";
  var BOLT_HALO = "#bfe0ff";

  // One full strike cycle, matching the storm-* keyframe durations in style.css.
  // An active band repeats this, so it strikes once a second.
  //
  // This was 2260 ms, of which two full seconds was the channel HOLDING lit. The
  // hold is what made a strike read as a lamp switching on: real lightning is
  // gone before the eye settles on it. The burst now occupies roughly the first
  // 550 ms and the cell is dark for the remainder, and that dark gap is the
  // reason separate strikes read as separate rather than as a flicker.
  var FLASH_CYCLE_MS = 1000;

  var reduceMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) {
      node.setAttribute(k, String(attrs[k]));
    });
    return node;
  }

  function div(cls, text) {
    var d = document.createElement("div");
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }

  function formatTimestamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /** Relative energy as a compact "1.28M", or a dash when absent. */
  function formatEnergy(e) {
    if (e === null || e === undefined || isNaN(e)) return "-";
    return (Number(e) / 1e6).toFixed(2) + "M";
  }

  /* -------------------------------------------------------------------
     Cloud drawing
     ------------------------------------------------------------------- */

  /* Cumulonimbus silhouette.

     Drawn as ONE continuous outline rather than a pile of ellipses. Stacked
     ellipses each carry their own stroke, so their edges showed through as
     circular rings across the top and a hard ring around the base, and the
     overlapping arcs read as lumpy. A single closed path has one outline and
     no internal edges at all.

     Geometry is in units around the cloud's own origin and positioned with a
     transform, so these two path strings are shared verbatim with the
     server-side renderer in charts.py::_cumulonimbus. Keep them in step.

     Wider at the shoulders (+/-27) than at the base (+/-24): that spread is the
     anvil, which is what makes it read as a thunderstorm rather than fair
     weather cloud. Two broad top curves instead of five bumps keeps it smooth.
     The flat base is deliberate, being what a real cumulonimbus base looks
     like. */
  var CB_BODY = "M-24 11C-33 11-35 1-27-3C-30-12-20-17-12-14" +
                "C-8-22 6-24 12-17C22-20 30-12 26-4C34-1 32 11 24 11Z";

  function drawCloud(svg, s) {
    var g = el("g", {
      transform: "translate(" + CX + "," + CY + ") scale(" + s.toFixed(3) + ")"
    });
    g.appendChild(el("path", { d: CB_BODY, "class": "cb-body" }));
    svg.appendChild(g);
    return g;
  }

  /** Bolt geometry. Returns { glow, outline, core }, three filled path strings.
   *
   * FOUR TURNS, NOT ONE, AND NO BRANCH.
   *
   * The previous centre-line had three points: base, one kink, tip. One kink is
   * one direction reversal, and a single reversal draws a letter Z rather than a
   * discharge. This is the classic four-turn channel: down, back, down, back,
   * converging to a point. A branched version was tried and rejected as too busy
   * at this cell size.
   *
   * Three concentric shapes rather than a stroke: a blurred outer glow, the
   * channel itself, and a thin inset core. A stroke has uniform width and always
   * ends blunt or rounded, whereas a filled shape can converge to a real point,
   * which is what makes the tip sharp.
   *
   * Jitter is a small horizontal shift of the whole channel rather than a
   * per-vertex wobble. Wobbling vertices independently distorted the shape into
   * something that no longer read as lightning; shifting it keeps the silhouette
   * and still means no two strikes land in the same place.
   *
   * Shared shape with charts.py::_bolt_geometry; keep the two in step.
   */
  function boltGeometry() {
    // Nudged up to +/-2.2 units, which at 104 wide is a visible change of
    // position without leaving the cloud base.
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

  /* -------------------------------------------------------------------
     One band cell
     ------------------------------------------------------------------- */

  function buildCell(band, maxPeak) {
    var active = (band.count || 0) > 0;
    var color = active && band.color ? band.color : IDLE_COLOR;

    // Size cue: scale on the band's mean against the busiest peak on screen,
    // so the cells stay comparable with each other rather than against an
    // absolute the reader cannot see.
    var frac = 0;
    if (active && maxPeak > 0 && band.mean !== null) {
      frac = Math.max(0, Math.min(1, band.mean / maxPeak));
    }
    /* Smaller cloud than before: 0.56 to 0.62 active, down from 0.62 to 0.92,
       and 0.52 when idle. Two reasons. It leaves the channel as the dominant
       element in the cell, which is half of what makes a strike look intense,
       and the band still carries its activity cue through the size range without
       the cloud crowding the figures underneath. */
    var scale = active ? (0.56 + frac * 0.06) : 0.52;

    var cell = div("storm-band" + (active ? "" : " is-idle"));
    cell.style.setProperty("--band-color", color);

    cell.appendChild(div("storm-band-range", band.range || ""));

    // No height attribute: "auto" is not a valid SVG length and the browser
    // rejects it with "Expected length". The stylesheet sets height:auto in CSS,
    // where it is legal, so the layout was right but the console carried an
    // error on every cell.
    var svg = el("svg", {
      viewBox: "0 0 " + VB_W + " " + VB_H,
      width: "100%", role: "img",
      "aria-label": (band.range || "band") + ": " + (band.count || 0) +
        " strikes" + (active ? ", mean intensity " + band.mean : "")
    });
    cell.appendChild(svg);

    // Unique filter id per cell: SVG filter ids are document-global, so a
    // shared one would break as soon as a cell is re-rendered.
    var fid = "storm-blur-" + (band.key || "x").replace(/[^\w-]/g, "") + "-" +
              Math.random().toString(36).slice(2, 7);
    var defs = el("defs", {});
    var filt = el("filter", { id: fid, x: "-80%", y: "-80%",
                              width: "260%", height: "260%" });
    // Blur radius is in user units, so it scales with the viewBox. At the old
    // 3.6 on this smaller box the bloom smeared into a tube past the tip and
    // blunted it. 130 -> 104 wide is a factor of 0.8.
    filt.appendChild(el("feGaussianBlur", { stdDeviation: 2.6 }));
    defs.appendChild(filt);
    svg.appendChild(defs);

    if (active) {
      svg.appendChild(el("circle", {
        cx: CX, cy: CY + 5, r: 22, fill: BOLT_HALO,
        filter: "url(#" + fid + ")", "class": "storm-halo", opacity: 0
      }));
    }

    drawCloud(svg, scale);

    var glow = null, main = null, core = null;
    if (active) {
      var geo = boltGeometry();
      // Three filled paths, so every layer converges to the same sharp point.
      // The core was a stroked polyline before, which could not taper and put a
      // blunt end back on the tip the outline had just sharpened.
      glow = el("path", { d: geo.glow, fill: BOLT_GLOW,
        "class": "storm-bolt storm-bolt-glow",
        filter: "url(#" + fid + ")" });
      main = el("path", { d: geo.outline, fill: BOLT_MAIN,
        "class": "storm-bolt storm-bolt-main" });
      core = el("path", { d: geo.core, fill: BOLT_CORE,
        "class": "storm-bolt storm-bolt-core" });
      svg.appendChild(glow);
      svg.appendChild(main);
      svg.appendChild(core);
    }

    // ---- data block ------------------------------------------------
    var data = div("storm-band-data");

    var count = div("storm-band-count");
    count.appendChild(document.createTextNode(String(band.count || 0)));
    var unit = document.createElement("span");
    unit.textContent = " " + (band.count === 1 ? "strike" : "strikes");
    count.appendChild(unit);
    data.appendChild(count);

    data.appendChild(div("storm-band-label", band.label || ""));

    if (active) {
      var rows = div("storm-band-rows");
      [["peak", band.peak], ["mean", band.mean], ["low", band.low]]
        .forEach(function (pair) {
          var row = div("storm-band-row");
          var k = document.createElement("span");
          k.textContent = pair[0];
          var v = document.createElement("b");
          v.textContent = formatEnergy(pair[1]);
          row.appendChild(k);
          row.appendChild(v);
          rows.appendChild(row);
        });
      var brow = div("storm-band-row storm-band-row-sep");
      var bk = document.createElement("span");
      bk.textContent = "band";
      var bv = document.createElement("b");
      bv.textContent = band.band || "-";
      /* Left black, deliberately.
         This used to be painted with the band colour, which on the quieter bands
         is a pale grey and read as disabled text. The band colour still appears
         on the cell border and the header, where it is a block of colour rather
         than a word, so nothing is lost by keeping the label legible. */
      brow.appendChild(bk);
      brow.appendChild(bv);
      rows.appendChild(brow);
      data.appendChild(rows);
    } else {
      data.appendChild(div("storm-band-none", "no strikes recorded"));
    }
    cell.appendChild(data);

    // ---- flash ------------------------------------------------------
    if (active && !reduceMotion.matches) {
      cell.classList.add("is-clickable");
      /* Reposition the channel, then let CSS run it.
         The animation is `infinite` on .is-flashing, so an active band keeps
         striking once a second on its own and this only needs to be called once.
         Calling it again re-jitters the position and restarts the cycle, which is
         what the click handler is for. */
      cell._strike = function () {
        var g = boltGeometry();
        glow.setAttribute("d", g.glow);
        main.setAttribute("d", g.outline);
        core.setAttribute("d", g.core);
        cell.classList.remove("is-flashing");
        void cell.offsetWidth;              // force the animation to restart
        cell.classList.add("is-flashing");
      };
      // Start it immediately; the 1 Hz repeat is the CSS animation, not a timer.
      cell._strike();
      cell.addEventListener("click", cell._strike);
    }
    return cell;
  }

  /* -------------------------------------------------------------------
     Fallbacks
     ------------------------------------------------------------------- */

  /** Plain-text fallback used when the cells cannot be drawn. */
  function drawTable(payload) {
    var strikes = payload.strikes || [];
    if (!strikes.length) return null;
    var table = document.createElement("table");
    table.className = "storm-fallback";
    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Time (SAST)</th><th>Distance (km)</th>" +
                      "<th>Intensity</th></tr>";
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    strikes.slice(0, 20).forEach(function (s) {
      var tr = document.createElement("tr");
      [formatTimestamp(s.t), s.distance_km, s.band || "-"].forEach(function (v) {
        var td = document.createElement("td");
        td.textContent = String(v);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  /* -------------------------------------------------------------------
     Per-host controller
     ------------------------------------------------------------------- */

  function initOne(host) {
    var endpoint = host.getAttribute("data-endpoint");
    if (!endpoint) return;

    var windowMin = parseInt(host.getAttribute("data-window") || "1440", 10);
    if (isNaN(windowMin)) windowMin = 1440;

    var timer = null;          // poll timer
    var flashTimers = [];      // per-cell animation timers
    var grid = null;
    var summaryLine = null;
    var rangeBar = null;

    function clearFlashTimers() {
      flashTimers.forEach(window.clearTimeout);
      flashTimers = [];
    }

    /** Stagger the START of each active cell's cycle.
     *
     * THE REPEAT ITSELF IS NO LONGER A TIMER. The flash animation is `infinite`
     * in CSS at FLASH_CYCLE_MS, so an active band strikes once a second without
     * any JavaScript running. This only offsets each cell's phase so the five
     * bands do not all fire on the same frame, which looked like one shared
     * flash across the row rather than five independent cells.
     *
     * What this replaced was a self-rescheduling chain of setTimeouts per cell,
     * with the gap derived from the band's share of the strikes. That carried a
     * real cue, activity level by flash rate, but it could not also deliver one
     * strike a second: its floor was the 2260 ms animation plus 700 ms. Fixed
     * 1 Hz was the explicit requirement, so the rate cue is gone and the size
     * cue on the cloud now carries activity level on its own.
     */
    function scheduleFlashes(cells) {
      clearFlashTimers();
      cells.forEach(function (entry, i) {
        if (!entry.cell._strike) return;
        // Phase offset only, fired once. Spread across the cycle so the row
        // ripples rather than pulsing in unison.
        var phase = (FLASH_CYCLE_MS / Math.max(1, cells.length)) * i;
        flashTimers.push(window.setTimeout(function () {
          entry.cell._strike();
        }, phase + Math.random() * 90));
      });
    }

    /** The 1H..24H selector. Built in script so a browser that never runs
        this file is not left with controls that do nothing. */
    function buildRangeBar() {
      var bar = div("storm-range");
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Storm activity time range");
      RANGES.forEach(function (r) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = r.label;
        b.setAttribute("data-window", String(r.min));
        b.setAttribute("aria-pressed", r.min === windowMin ? "true" : "false");
        b.addEventListener("click", function () {
          if (r.min === windowMin) return;
          windowMin = r.min;
          host.setAttribute("data-window", String(r.min));
          markActive();
          load();
        });
        bar.appendChild(b);
      });
      return bar;
    }

    function markActive() {
      if (!rangeBar) return;
      Array.prototype.forEach.call(
        rangeBar.querySelectorAll("button[data-window]"),
        function (b) {
          var on = parseInt(b.getAttribute("data-window"), 10) === windowMin;
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }

    function hoursLabel() {
      return windowMin >= 60 ? (windowMin / 60) + " h" : windowMin + " min";
    }

    /** One-time chrome, so switching range does not rebuild the controls and
        lose keyboard focus. */
    function ensureChrome() {
      if (rangeBar) return;
      host.textContent = "";
      var head = div("storm-head");
      summaryLine = div("storm-summary");
      rangeBar = buildRangeBar();
      head.appendChild(summaryLine);
      head.appendChild(rangeBar);
      host.appendChild(head);
      grid = div("storm-bands");
      host.appendChild(grid);
    }

    function paint(payload) {
      ensureChrome();
      clearFlashTimers();
      grid.textContent = "";

      var bands = payload.bands || [];
      var total = payload.total || 0;

      var text = total + (total === 1 ? " strike" : " strikes") +
                 " in the last " + hoursLabel() +
                 "  \u00b7  grouped by distance, nearest first";
      if (payload.unplaced) {
        text += "  \u00b7  " + payload.unplaced + " without a usable distance";
      }
      summaryLine.textContent = text;

      if (!bands.length) {
        grid.appendChild(div("muted chart-empty",
          "No strikes recorded in the last " + hoursLabel() + "."));
        return;
      }

      var maxPeak = 0;
      bands.forEach(function (b) {
        if (b.peak && b.peak > maxPeak) maxPeak = b.peak;
      });

      var cells = bands.map(function (b) {
        var cell = buildCell(b, maxPeak);
        grid.appendChild(cell);
        return { cell: cell, share: b.share || 0 };
      });
      scheduleFlashes(cells);
    }

    function load() {
      var sep = endpoint.indexOf("?") === -1 ? "?" : "&";
      fetch(endpoint + sep + "window=" + encodeURIComponent(windowMin), {
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (payload) {
          try {
            paint(payload);
          } catch (err) {
            // Drawing failed: show the readings as a table rather than
            // nothing at all.
            var table = drawTable(payload);
            host.textContent = "";
            rangeBar = null;
            if (table) host.appendChild(table);
            if (window.console && console.warn) {
              console.warn("[storm-view] draw failed, showing the reading list:",
                           err);
            }
          }
        })
        .catch(function (err) {
          if (window.console && console.warn) {
            console.warn("[storm-view] fetch failed:", err);
          }
          // Only replace the contents if we have nothing on screen yet, so a
          // transient network blip does not wipe a good display.
          if (!host.firstChild) {
            host.appendChild(div("muted chart-empty",
              "Storm activity is unavailable right now."));
          }
          // Stop polling after a failure so a broken endpoint is not hammered
          // every 30 seconds for the life of the page.
          if (timer) { window.clearInterval(timer); timer = null; }
        });
    }

    function startPolling() {
      if (!timer) timer = window.setInterval(load, POLL_MS);
    }

    load();
    startPolling();

    // Pause polling and animation while the tab is hidden.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (timer) { window.clearInterval(timer); timer = null; }
        clearFlashTimers();
      } else if (!timer) {
        load();
        startPolling();
      }
    });
  }

  function init() {
    var hosts = document.querySelectorAll("[data-storm-view]");
    Array.prototype.forEach.call(hosts, function (host) {
      try {
        initOne(host);
      } catch (err) {
        if (window.console && console.warn) {
          console.warn("[storm-view] init failed:", err);
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
