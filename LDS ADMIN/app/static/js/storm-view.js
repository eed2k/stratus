/* =====================================================================
   Storm-activity display: recent strikes plotted on distance range-rings.

   Mirrors the server-side renderer in app/charts.py::storm_rings_svg so the
   dashboard and the PDF report show the same picture: concentric rings at
   10/20/30/40 km, the station at the centre, one dot per strike placed by
   distance, coloured by energy band.

   The AS3935 measures distance but NOT bearing, so the angle a dot sits at
   carries no information. Angles are spread with the golden angle purely to
   stop dots at the same distance from landing on top of one another, exactly
   as the server-side version does, and the display says so in words.

   No inline script and no external origin: runs under
   "script-src 'self'; connect-src 'self'". Built with plain DOM and inline
   SVG, so it needs no vendor bundle at all and degrades to a plain table.
   ===================================================================== */
(function () {
  "use strict";

  var POLL_MS = 30000;          // refresh cadence
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  var SVG_NS = "http://www.w3.org/2000/svg";

  // Same palette as app/metrics.py::_ENERGY_BANDS.
  var COLOUR_GRID = "#d7dee8";
  var COLOUR_NAVY = "#0a2540";
  var COLOUR_MUTED = "#5b6673";

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

  function formatTimestamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /** Draw the rings, the station marker and one dot per strike. */
  function drawPlot(payload, seenIds) {
    var size = 300;
    var cx = size / 2;
    var cy = size / 2;
    var maxR = size / 2 - 18;
    var radiusKm = payload.radius_km || 40;
    var rings = payload.rings || [10, 20, 30, 40];

    var svg = el("svg", {
      viewBox: "0 0 " + size + " " + size,
      width: "100%",
      height: "auto",
      role: "img",
      "aria-label": "Recent strikes by distance from the detector"
    });

    rings.forEach(function (rk) {
      var rr = (rk / radiusKm) * maxR;
      svg.appendChild(el("circle", {
        cx: cx, cy: cy, r: rr.toFixed(1),
        fill: "none", stroke: COLOUR_GRID, "stroke-width": 1
      }));
      var label = el("text", {
        x: cx + 2, y: (cy - rr + 10).toFixed(1),
        "font-size": 8, fill: COLOUR_MUTED,
        "font-family": "Arial, Helvetica, sans-serif"
      });
      label.textContent = rk + " km";
      svg.appendChild(label);
    });

    // Detector position.
    svg.appendChild(el("circle", { cx: cx, cy: cy, r: 3, fill: COLOUR_NAVY }));

    (payload.strikes || []).forEach(function (s, i) {
      var d = parseFloat(s.distance_km);
      if (isNaN(d)) return;
      var rr = (Math.max(0, Math.min(radiusKm, d)) / radiusKm) * maxR;
      var ang = i * GOLDEN;
      var sx = cx + rr * Math.cos(ang);
      var sy = cy + rr * Math.sin(ang);

      var dot = el("circle", {
        cx: sx.toFixed(1), cy: sy.toFixed(1), r: 3.5,
        fill: s.colour || COLOUR_NAVY, "fill-opacity": 0.85
      });

      // Pulse only genuinely new strikes, and only when the reader has not
      // asked for reduced motion.
      var id = s.t + "|" + s.distance_km + "|" + s.energy;
      if (!reduceMotion.matches && !seenIds.has(id) && seenIds.size > 0) {
        dot.setAttribute("class", "strike-new");
      }
      seenIds.add(id);

      var title = el("title", {});
      title.textContent = formatTimestamp(s.t) + " SAST, " + d + " km, " +
                          (s.band || "unknown") + " intensity";
      dot.appendChild(title);
      svg.appendChild(dot);
    });

    var note = el("text", {
      x: cx, y: size - 6, "font-size": 8, fill: COLOUR_MUTED,
      "text-anchor": "middle", "font-family": "Arial, Helvetica, sans-serif"
    });
    note.textContent = "Distance only - bearing not measured";
    svg.appendChild(note);

    return svg;
  }

  /** Energy-band legend, derived from the bands actually present. */
  function drawLegend(payload) {
    var wrap = document.createElement("div");
    wrap.className = "storm-legend";

    var order = ["Low", "Moderate", "High", "Extreme"];
    var seen = {};
    (payload.strikes || []).forEach(function (s) {
      if (s.band && !seen[s.band]) seen[s.band] = s.colour;
    });
    var names = order.filter(function (n) { return seen[n]; });
    if (!names.length) return wrap;

    names.forEach(function (name) {
      var item = document.createElement("span");
      item.className = "storm-legend-item";
      var swatch = document.createElement("i");
      swatch.style.background = seen[name];
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(name));
      wrap.appendChild(item);
    });

    var hint = document.createElement("span");
    hint.className = "storm-legend-hint";
    hint.textContent = "Intensity is a relative sensor value, not joules.";
    wrap.appendChild(hint);
    return wrap;
  }

  /** Plain-text fallback used when the plot cannot be drawn. */
  function drawTable(payload) {
    var strikes = payload.strikes || [];
    if (!strikes.length) return null;
    var table = document.createElement("table");
    table.className = "storm-fallback";
    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Time (SAST)</th><th>Distance (km)</th><th>Intensity</th></tr>";
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

  function initOne(host) {
    var endpoint = host.getAttribute("data-endpoint");
    if (!endpoint) return;
    var windowMin = host.getAttribute("data-window") || "1440";
    var seenIds = new Set();
    var timer = null;

    function paint(payload) {
      host.textContent = "";

      if (!payload.strikes || payload.strikes.length === 0) {
        var empty = document.createElement("p");
        empty.className = "muted chart-empty";
        empty.textContent = "No strikes detected in this window.";
        host.appendChild(empty);
        return;
      }

      try {
        host.appendChild(drawPlot(payload, seenIds));
        host.appendChild(drawLegend(payload));
      } catch (err) {
        // Geometry failed for some reason: show the readings as a table rather
        // than nothing at all.
        var table = drawTable(payload);
        host.textContent = "";
        if (table) host.appendChild(table);
        if (window.console && console.warn) {
          console.warn("[storm-view] plot failed, showing the reading list:", err);
        }
      }
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
        .then(paint)
        .catch(function (err) {
          if (window.console && console.warn) {
            console.warn("[storm-view] fetch failed:", err);
          }
          // Only replace the contents if we have nothing on screen yet, so a
          // transient network blip does not wipe a good plot.
          if (!host.firstChild) {
            var p = document.createElement("p");
            p.className = "muted chart-empty";
            p.textContent = "Storm activity is unavailable right now.";
            host.appendChild(p);
          }
          // Stop polling after a failure so a broken endpoint is not hammered
          // every 30 seconds for the life of the page.
          if (timer) { window.clearInterval(timer); timer = null; }
        });
    }

    load();
    timer = window.setInterval(load, POLL_MS);

    // Pause polling while the tab is hidden.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (timer) { window.clearInterval(timer); timer = null; }
      } else if (!timer) {
        load();
        timer = window.setInterval(load, POLL_MS);
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
