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
  var VB_W = 104, VB_H = 78, CX = 52, CY = 29, BOLT_TOP = 43, BOLT_END = 72;

  // Lightning is blue-white in every band. The band color still drives the
  // header and the data block, where it carries information; painting the
  // channel with it made a distant strike look orange rather than like
  // lightning.
  var BOLT_MAIN = "#eaf4ff";
  var BOLT_GLOW = "#8fc4ff";
  var BOLT_CORE = "#ffffff";
  var BOLT_HALO = "#a8d2ff";

  // How long a flash stays on screen, matching the storm-* keyframe durations in
  // style.css. Scheduling must not fire faster than this.
  var FLASH_HOLD_MS = 2260;

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

  /** Bolt geometry: one zigzag, tapering to a point at the bottom.
   *
   * Returns { outline, center }.
   *
   * The channel is a FILLED outline, not a stroked line. A stroke has a uniform
   * width and cannot converge, so a stroked polyline always ends in a blunt or
   * rounded cap. Building the shape from a center-line whose width falls to zero
   * at the last vertex is what produces a sharp tip.
   *
   * The center-line has three points: the cloud base, one kink, and the tip.
   * One kink is one direction reversal, which reads as a single zigzag. Kink
   * offset is jittered a little so no two flashes are identical.
   *
   * Shared shape with charts.py::_bolt_geometry; keep the two in step.
   */
  function boltGeometry() {
    var H = BOLT_END - BOLT_TOP;
    var flip = Math.random() < 0.5 ? 1 : -1;      // which way it zigs first
    var k1 = flip * (6.5 + Math.random() * 2.0);
    var y1 = H * (0.44 + Math.random() * 0.08);

    var pts = [[0, 0], [k1, y1], [0, H]];
    // Width per vertex, 60% heavier than the 3.4 this used to be, so the
    // channel still reads at the smaller cell size. Zero at the tip: that is
    // the sharp point.
    var w = [5.4, 3.7, 0];

    var left = [], right = [];
    for (var i = 0; i < pts.length; i++) {
      left.push([CX + pts[i][0] - w[i] / 2, BOLT_TOP + pts[i][1]]);
      right.push([CX + pts[i][0] + w[i] / 2, BOLT_TOP + pts[i][1]]);
    }

    var d = "M" + left.map(function (p) {
      return p[0].toFixed(1) + " " + p[1].toFixed(1);
    }).join("L");
    d += "L" + right.reverse().map(function (p) {
      return p[0].toFixed(1) + " " + p[1].toFixed(1);
    }).join("L") + "Z";

    var center = pts.map(function (p) {
      return (CX + p[0]).toFixed(1) + "," + (BOLT_TOP + p[1]).toFixed(1);
    }).join(" ");

    return { outline: d, center: center };
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
    var scale = 0.62 + frac * 0.30;

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
      // Filled outline, so the channel can taper to a point. The core stays a
      // thin stroke down the center-line and reads as the hot inner channel.
      glow = el("path", { d: geo.outline, fill: BOLT_GLOW,
        "class": "storm-bolt storm-bolt-glow",
        filter: "url(#" + fid + ")" });
      main = el("path", { d: geo.outline, fill: BOLT_MAIN,
        "class": "storm-bolt storm-bolt-main" });
      core = el("polyline", { points: geo.center, stroke: BOLT_CORE,
        "stroke-width": 1.3, fill: "none",
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
      cell._strike = function () {
        var g = boltGeometry();
        glow.setAttribute("d", g.outline);
        main.setAttribute("d", g.outline);
        core.setAttribute("points", g.center);
        cell.classList.remove("is-flashing");
        void cell.offsetWidth;              // force the animation to restart
        cell.classList.add("is-flashing");
      };
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

    /** Keep each cell flashing on its own irregular schedule, more often the
        busier the band, so activity level reads at a glance.

        The gap can never fall below the flash animation itself. The channel now
        holds lit for 2260 ms, so a shorter gap would cut a flash short and
        restart it, leaving the cloud permanently lit and strobing. */
    function scheduleFlashes(cells) {
      clearFlashTimers();
      cells.forEach(function (entry, i) {
        if (!entry.cell._strike) return;
        var gap = Math.max(FLASH_HOLD_MS + 700,
                           7000 - (entry.share * 5 * 900));
        flashTimers.push(window.setTimeout(function () {
          entry.cell._strike();
          (function loop() {
            flashTimers.push(window.setTimeout(function () {
              entry.cell._strike();
              loop();
            }, gap + Math.random() * gap * 0.7));
          })();
        }, 140 * i + Math.random() * 160));
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
