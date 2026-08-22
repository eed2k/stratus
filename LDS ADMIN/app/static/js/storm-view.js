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

   Cell colours come from the payload (the panel's own energy-band palette in
   metrics.py::_ENERGY_BANDS). They are deliberately not duplicated here.

   No inline script and no external origin: runs under
   "script-src 'self'; connect-src 'self'". Built with plain DOM and inline
   SVG, so it needs no vendor bundle at all and degrades to a plain table.
   ===================================================================== */
(function () {
  "use strict";

  var POLL_MS = 30000;          // refresh cadence
  var SVG_NS = "http://www.w3.org/2000/svg";
  var IDLE_COLOUR = "#93a0b0";

  // Selectable windows, in minutes. The endpoint caps at 7 days.
  var RANGES = [
    { label: "1 H",  min: 60 },
    { label: "3 H",  min: 180 },
    { label: "6 H",  min: 360 },
    { label: "12 H", min: 720 },
    { label: "24 H", min: 1440 }
  ];

  // Cloud geometry, in the cell's own viewBox units.
  var VB_W = 130, VB_H = 108, CX = 65, CY = 36, BOLT_TOP = 52, BOLT_END = 96;

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

  /** Small cumulonimbus: spreading anvil, short tower, flat darker base.
      The anvil is what makes it read as a thunderstorm rather than fair
      weather cloud, so it stays even at this size. */
  function drawCloud(svg, s) {
    var g = el("g", {});
    [[0, -15, 32, 5.6], [-13, -12, 13, 4.6], [14, -12, 12, 4.2]]
      .forEach(function (p) {
        g.appendChild(el("ellipse", {
          cx: CX + p[0] * s, cy: CY + p[1] * s,
          rx: p[2] * s, ry: p[3] * s, "class": "cb-anvil"
        }));
      });
    [[-7, -6, 9], [3, -8, 9.5], [10, -3, 7.5], [-13, -2, 7.5], [0, 0, 10.5]]
      .forEach(function (p) {
        g.appendChild(el("ellipse", {
          cx: CX + p[0] * s, cy: CY + p[1] * s,
          rx: p[2] * s, ry: p[2] * s * 0.82, "class": "cb-tower"
        }));
      });
    g.appendChild(el("ellipse", {
      cx: CX, cy: CY + 8 * s, rx: 20 * s, ry: 5 * s, "class": "cb-base"
    }));
    svg.appendChild(g);
    return g;
  }

  /** A sharp, mostly-vertical channel: few segments, small lateral spread,
      so it reads as a crisp strike rather than a wandering squiggle. */
  function boltPath() {
    var segs = 5, dy = (BOLT_END - BOLT_TOP) / segs, pts = [[CX, BOLT_TOP]];
    for (var i = 1; i < segs; i++) {
      var taper = 1 - Math.abs(i / segs - 0.5) * 1.4;
      pts.push([CX + (Math.random() * 2 - 1) * 5.5 * taper, BOLT_TOP + dy * i]);
    }
    pts.push([CX + (Math.random() * 2 - 1) * 2.5, BOLT_END]);
    return pts.map(function (p) {
      return p[0].toFixed(1) + "," + p[1].toFixed(1);
    }).join(" ");
  }

  /* -------------------------------------------------------------------
     One band cell
     ------------------------------------------------------------------- */

  function buildCell(band, maxPeak) {
    var active = (band.count || 0) > 0;
    var colour = active && band.colour ? band.colour : IDLE_COLOUR;

    // Size cue: scale on the band's mean against the busiest peak on screen,
    // so the cells stay comparable with each other rather than against an
    // absolute the reader cannot see.
    var frac = 0;
    if (active && maxPeak > 0 && band.mean !== null) {
      frac = Math.max(0, Math.min(1, band.mean / maxPeak));
    }
    var scale = 0.74 + frac * 0.40;

    var cell = div("storm-band" + (active ? "" : " is-idle"));
    cell.style.setProperty("--band-colour", colour);

    cell.appendChild(div("storm-band-range", band.range || ""));

    var svg = el("svg", {
      viewBox: "0 0 " + VB_W + " " + VB_H,
      width: "100%", height: "auto", role: "img",
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
    filt.appendChild(el("feGaussianBlur", { stdDeviation: 3.6 }));
    defs.appendChild(filt);
    svg.appendChild(defs);

    if (active) {
      svg.appendChild(el("circle", {
        cx: CX, cy: CY + 6, r: 28, fill: colour,
        filter: "url(#" + fid + ")", "class": "storm-halo", opacity: 0
      }));
    }

    drawCloud(svg, scale);

    var glow = null, main = null, core = null;
    if (active) {
      var path = boltPath();
      glow = el("polyline", { points: path, stroke: colour, "stroke-width": 5.5,
        fill: "none", "class": "storm-bolt storm-bolt-glow",
        filter: "url(#" + fid + ")" });
      main = el("polyline", { points: path, stroke: colour, "stroke-width": 2.2,
        fill: "none", "class": "storm-bolt storm-bolt-main" });
      core = el("polyline", { points: path, stroke: "#ffffff",
        "stroke-width": 0.9, fill: "none",
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
      bv.style.color = colour;
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
        var p = boltPath();
        glow.setAttribute("points", p);
        main.setAttribute("points", p);
        core.setAttribute("points", p);
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
        busier the band, so activity level reads at a glance. */
    function scheduleFlashes(cells) {
      clearFlashTimers();
      cells.forEach(function (entry, i) {
        if (!entry.cell._strike) return;
        var gap = Math.max(1400, 7000 - (entry.share * 5 * 900));
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
