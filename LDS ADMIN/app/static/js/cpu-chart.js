/* =====================================================================
   Interactive CPU temperature / load chart (Recharts, self-hosted UMD).

   Progressive enhancement. Every unit already renders a server-side inline
   SVG chart, which is what a reader sees if JavaScript is off, if a vendor
   bundle fails to load, or if anything in here throws. The interactive chart
   is only swapped in once it has actually rendered, so the dashboard can
   never end up showing nothing.

   No inline script and no external origin: the panel runs under
   Content-Security-Policy "script-src 'self'; connect-src 'self'", so the
   React/Recharts bundles are served from /static/vendor/ and the only fetch
   target is the panel's own /data/cpu endpoint.

   Endpoint contract (app/routes/web.py::data_cpu), tenant-scoped:
     GET {base}/data/cpu?station=<id>&range=24h|7d|30d
     -> { station, site, warn: 70, crit: 78,
          points: [ { t: ISO-8601, temp: number|null, load: number|null } ] }
   ===================================================================== */
(function () {
  "use strict";

  // Matches the server-side palette in app/charts.py and style.css so the
  // interactive chart and the printed report look like the same product.
  var COLOUR_TEMP = "#c0392b";   // red
  var COLOUR_LOAD = "#2c7fb8";   // blue, same as the load line in charts.py
  var COLOUR_WARN = "#e08a1e";   // amber
  var COLOUR_CRIT = "#c0392b";
  var COLOUR_GRID = "#d7dee8";
  var COLOUR_MUTED = "#5b6673";

  /** Format an ISO timestamp for the x axis, given the window length. */
  function makeTickFormatter(range) {
    return function (iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      if (range === "24h") {
        return String(d.getHours()).padStart(2, "0") + ":" +
               String(d.getMinutes()).padStart(2, "0");
      }
      // 7d and 30d: a date is more use than a clock time.
      return d.getDate() + "/" + (d.getMonth() + 1);
    };
  }

  function formatFullTimestamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
           " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + " SAST";
  }

  /**
   * Build the chart element tree.
   *
   * Written with React.createElement rather than JSX because these files are
   * served straight to the browser with no build step.
   */
  function buildChart(React, Recharts, payload, range) {
    var h = React.createElement;
    var points = payload.points || [];

    // Recharts skips null values with connectNulls off, which is what we want:
    // a gap in the heartbeat should read as a gap, not as an interpolated line.
    var data = points.map(function (p) {
      return {
        t: p.t,
        temp: typeof p.temp === "number" ? p.temp : null,
        load: typeof p.load === "number" ? p.load : null
      };
    });

    var hasLoad = data.some(function (d) { return d.load !== null; });

    var children = [
      h(Recharts.CartesianGrid, { key: "grid", stroke: COLOUR_GRID, strokeDasharray: "3 3", vertical: false }),
      h(Recharts.XAxis, {
        key: "x",
        dataKey: "t",
        tickFormatter: makeTickFormatter(range),
        tick: { fontSize: 10, fill: COLOUR_MUTED },
        stroke: COLOUR_MUTED,
        minTickGap: 24
      }),
      h(Recharts.YAxis, {
        key: "yTemp",
        yAxisId: "temp",
        tick: { fontSize: 10, fill: COLOUR_MUTED },
        stroke: COLOUR_MUTED,
        width: 38,
        // Always include the CRIT line in the domain so the reference lines are
        // visible even on a cool day, and pad the top a little above CRIT.
        domain: [
          function (dataMin) { return Math.floor(Math.min(dataMin, payload.warn - 10)); },
          function (dataMax) { return Math.ceil(Math.max(dataMax, payload.crit + 4)); }
        ],
        label: {
          value: "CPU temp (deg C)", angle: -90, position: "insideLeft",
          fontSize: 10, fill: COLOUR_MUTED, style: { textAnchor: "middle" }
        }
      })
    ];

    if (hasLoad) {
      children.push(h(Recharts.YAxis, {
        key: "yLoad",
        yAxisId: "load",
        orientation: "right",
        domain: [0, 100],
        tick: { fontSize: 10, fill: COLOUR_MUTED },
        stroke: COLOUR_MUTED,
        width: 38,
        label: {
          value: "Load (%)", angle: 90, position: "insideRight",
          fontSize: 10, fill: COLOUR_MUTED, style: { textAnchor: "middle" }
        }
      }));
    }

    children.push(h(Recharts.Tooltip, {
      key: "tip",
      labelFormatter: formatFullTimestamp,
      formatter: function (value, name) {
        if (value === null || value === undefined) return ["no reading", name];
        return [name === "Load" ? value.toFixed(0) + " %" : value.toFixed(1) + " deg C", name];
      },
      contentStyle: { fontSize: "11px", fontFamily: "Arial, Helvetica, sans-serif" }
    }));

    // Legend: a very small caption under the plot, two coloured dots and their
    // labels. Recharts' default legend draws its own line/square markers, which
    // is what the icons were; a custom `content` replaces them entirely.
    children.push(h(Recharts.Legend, {
      key: "legend",
      verticalAlign: "bottom",
      height: 14,
      content: function () {
        function item(key, colour, label) {
          return h("span", {
            key: key,
            style: {
              display: "inline-flex", alignItems: "center",
              gap: "3px", marginLeft: key === "t" ? 0 : "12px"
            }
          }, [
            h("span", {
              key: "d",
              style: {
                width: "5px", height: "5px", borderRadius: "50%",
                background: colour, display: "inline-block", flex: "0 0 auto"
              }
            }),
            h("span", { key: "l" }, label)
          ]);
        }
        var items = [item("t", COLOUR_TEMP, "CPU temp")];
        if (hasLoad) items.push(item("l", COLOUR_LOAD, "Load"));
        return h("div", {
          style: {
            fontSize: "9px", lineHeight: "1", color: COLOUR_MUTED,
            textAlign: "center", fontFamily: "Arial, Helvetica, sans-serif"
          }
        }, items);
      }
    }));

    // WARN and CRIT thresholds come from the payload, not from a constant here,
    // so the chart always agrees with the detector's configured limits.
    children.push(h(Recharts.ReferenceLine, {
      key: "warn", yAxisId: "temp", y: payload.warn,
      stroke: COLOUR_WARN, strokeDasharray: "6 3", strokeWidth: 1.2, ifOverflow: "extendDomain",
      label: { value: "WARN " + payload.warn, position: "insideTopRight", fontSize: 9, fill: COLOUR_WARN }
    }));
    children.push(h(Recharts.ReferenceLine, {
      key: "crit", yAxisId: "temp", y: payload.crit,
      stroke: COLOUR_CRIT, strokeDasharray: "2 2", strokeWidth: 1.2, ifOverflow: "extendDomain",
      label: { value: "CRIT " + payload.crit, position: "insideTopRight", fontSize: 9, fill: COLOUR_CRIT }
    }));

    children.push(h(Recharts.Line, {
      key: "lineTemp", yAxisId: "temp", type: "monotone", dataKey: "temp",
      name: "CPU temp", stroke: COLOUR_TEMP, strokeWidth: 1.6,
      dot: false, activeDot: { r: 3 }, connectNulls: false, isAnimationActive: false
    }));

    if (hasLoad) {
      children.push(h(Recharts.Line, {
        key: "lineLoad", yAxisId: "load", type: "monotone", dataKey: "load",
        name: "Load", stroke: COLOUR_LOAD, strokeWidth: 1.2, strokeDasharray: "4 3",
        dot: false, activeDot: { r: 3 }, connectNulls: false, isAnimationActive: false
      }));
    }

    return h(
      Recharts.ResponsiveContainer,
      { width: "100%", height: "100%" },
      h(Recharts.LineChart, { data: data, margin: { top: 14, right: 8, bottom: 4, left: 0 } }, children)
    );
  }

  /** Swap the server-rendered SVG for the interactive chart, once only. */
  function hideFallback(host) {
    var fallback = host.parentNode
      ? host.parentNode.querySelector("[data-cpu-fallback]")
      : null;
    if (fallback) fallback.hidden = true;
  }

  function showPlaceholder(host, message) {
    host.textContent = "";
    var p = document.createElement("p");
    p.className = "muted chart-empty";
    p.textContent = message;
    host.appendChild(p);
  }

  function initOne(host, React, ReactDOM, Recharts) {
    var endpoint = host.getAttribute("data-endpoint");
    if (!endpoint) return;

    // Opening window, taken from data-range on the host (24h). The selector
    // that changes it lives in the unit information block, not above the
    // chart, and is bound below once we know this chart can render.
    var range = host.getAttribute("data-range") || "24h";
    var root = ReactDOM.createRoot ? ReactDOM.createRoot(host) : null;
    var rangeBar = null;      // set by bindRange(), revealed on first render

    function render(payload) {
      if (!payload.points || payload.points.length === 0) {
        // Nothing recorded for this window yet. Say so rather than drawing an
        // empty axis box that looks like a fault.
        showPlaceholder(host, "Collecting data. No heartbeat recorded in this window yet.");
        return;
      }
      var el = buildChart(React, Recharts, payload, range);
      if (root) root.render(el);
      else ReactDOM.render(el, host);
    }

    function load(newRange) {
      range = newRange;
      host.setAttribute("data-range", range);

      var sep = endpoint.indexOf("?") === -1 ? "?" : "&";
      fetch(endpoint + sep + "range=" + encodeURIComponent(range), {
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (payload) {
          hideFallback(host);
          host.hidden = false;
          render(payload);
          // Reveal the selector only now: it is proof the interactive chart
          // works, so the buttons can never appear as dead controls.
          if (rangeBar) rangeBar.hidden = false;
        })
        .catch(function (err) {
          // Leave the server-rendered SVG in place: a failed fetch must not
          // cost the reader the chart they already had.
          if (window.console && console.warn) {
            console.warn("[cpu-chart] falling back to the server-rendered chart:", err);
          }
          host.hidden = true;
          // The buttons drive a chart that is no longer on screen, so take
          // them away rather than leave dead controls in the unit block.
          if (rangeBar) rangeBar.hidden = true;
        });
    }

    /* Bind the range selector rendered in this unit's information block.

       Scoped to the unit row so a dashboard with several detectors wires each
       selector to its own chart. Handlers are attached here but the bar stays
       hidden until the first successful render, so the buttons only appear once
       they demonstrably work. */
    function bindRange() {
      var row = host.closest ? host.closest(".unit-row") : null;
      if (!row) return;
      rangeBar = row.querySelector("[data-cpu-range]");
      if (!rangeBar) return;

      var buttons = rangeBar.querySelectorAll("button[data-range]");
      if (!buttons.length) return;

      function markActive(active) {
        Array.prototype.forEach.call(buttons, function (b) {
          b.setAttribute("aria-pressed",
            b.getAttribute("data-range") === active ? "true" : "false");
        });
      }

      Array.prototype.forEach.call(buttons, function (b) {
        b.addEventListener("click", function () {
          var next = b.getAttribute("data-range");
          if (!next || next === range) return;
          markActive(next);
          load(next);
        });
      });

      markActive(range);
    }

    bindRange();
    load(range);
  }

  function init() {
    var hosts = document.querySelectorAll("[data-cpu-chart]");
    if (!hosts.length) return;

    var React = window.React;
    var ReactDOM = window.ReactDOM;
    var Recharts = window.Recharts;
    if (!React || !ReactDOM || !Recharts) {
      // A vendor bundle is missing. The inline SVG stays visible, so there is
      // nothing to do beyond leaving a breadcrumb for whoever checks.
      if (window.console && console.warn) {
        console.warn("[cpu-chart] React or Recharts unavailable, keeping the server-rendered chart.");
      }
      return;
    }

    Array.prototype.forEach.call(hosts, function (host) {
      try {
        initOne(host, React, ReactDOM, Recharts);
      } catch (err) {
        if (window.console && console.warn) {
          console.warn("[cpu-chart] init failed, keeping the server-rendered chart:", err);
        }
        host.hidden = true;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
