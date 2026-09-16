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
  /* Matched to Stratus so a reader moving between the two consoles sees the same
     conventions. These mirror CHART_COLORS in shared/chartColors.ts:
       temperature #ef4444, humidity/blue series #2563eb
     Duplicated rather than imported because this file is served straight to the
     browser with no build step and cannot reach into the Stratus package. If a
     colour changes there, change it here too. */
  var COLOR_TEMP = "#ef4444";   // CHART_COLORS.temperature
  var COLOR_LOAD = "#2563eb";   // CHART_COLORS.humidity, the house blue
  var COLOR_WARN = "#e08a1e";   // amber
  var COLOR_CRIT = "#c0392b";
  var COLOR_GRID = "#f1f4f7";   // near-white: grid must not shade the plot area
  var COLOR_MUTED = "#000000";  // black: axis numbers are read against a logger value

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
  /* Axis text sizes. Raised from 10: these charts are read on a wall-mounted
     console at arm's length, where a 10 px tick is a guess rather than a value. */
  var TICK_FONT = 12;
  var AXIS_LABEL_FONT = 12;

  /**
   * Y domain padded around the data, with a floor on the span.
   *
   * The old shared-axis domain was
   *   [min(dataMin, warn - 10), max(dataMax, crit + 4)]
   * which FORCED the thresholds into view. With a CPU idling at 33 deg C and
   * CRIT at 78 that made the domain 33..82, so the trace sat flat against the
   * x axis with four fifths of the plot empty. Scaling to the data instead is
   * what makes the shape readable; the thresholds are drawn with
   * ifOverflow "hidden" so they appear when the reading actually approaches
   * them and are simply absent when it does not.
   *
   * minSpan stops a dead-flat trace from being magnified into meaningless
   * jitter: a unit holding 33.6 deg C all day should read as a flat line.
   */
  function paddedDomain(values, minSpan, hardFloor) {
    var nums = values.filter(function (v) { return typeof v === "number"; });
    if (!nums.length) return [0, minSpan];
    var lo = Math.min.apply(null, nums);
    var hi = Math.max.apply(null, nums);
    var span = hi - lo;
    if (span < minSpan) {
      var mid = (hi + lo) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    } else {
      var pad = span * 0.15;
      lo -= pad;
      hi += pad;
    }
    if (typeof hardFloor === "number" && lo < hardFloor) lo = hardFloor;
    return [Math.floor(lo), Math.ceil(hi)];
  }

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

    /**
     * One chart per quantity.
     *
     * They were on a single dual-axis plot, which forces two unrelated scales
     * to share one grid: a temperature in the thirties and a load percentage
     * cannot both use the vertical space well, and whichever loses ends up
     * flattened against an axis. Separating them lets each scale to its own
     * data, and it also removes the ambiguity of a reader having to remember
     * which trace belongs to which side.
     */
    function seriesChart(kind) {
      var isTemp = kind === "temp";
      var colour = isTemp ? COLOR_TEMP : COLOR_LOAD;
      var axisLabel = isTemp ? "CPU temperature (\u00b0C)" : "CPU load (%)";
      var seriesName = isTemp ? "CPU temp" : "Load";

      var values = data.map(function (d) { return isTemp ? d.temp : d.load; });
      // Temperature: 8 deg C minimum span. Load: 20 percentage points minimum,
      // floored at 0 because a negative load is not a thing.
      var domain = isTemp
        ? paddedDomain(values, 8)
        : paddedDomain(values, 20, 0);

      /* Axis and grid treatment copied from Stratus WeatherChart.tsx so the two
         consoles look like one product: a faint dashed grid at 30% opacity with
         no explicit colour, and axes with NO tick marks and NO axis line, which
         is what gives the Stratus charts their clean look. */
      var kids = [
        h(Recharts.CartesianGrid, {
          key: "grid", strokeDasharray: "3 3", opacity: 0.3
        }),
        h(Recharts.XAxis, {
          key: "x",
          dataKey: "t",
          tickFormatter: makeTickFormatter(range),
          tick: { fontSize: TICK_FONT },
          tickLine: false,
          axisLine: false,
          tickMargin: 4,
          minTickGap: 28,
          height: 22
        }),
        h(Recharts.YAxis, {
          key: "y",
          tick: { fontSize: TICK_FONT, fill: colour },
          tickLine: false,
          axisLine: false,
          width: 52,
          domain: domain,
          allowDecimals: false,
          label: {
            value: axisLabel, angle: -90, position: "insideLeft",
            fontSize: AXIS_LABEL_FONT, fill: COLOR_MUTED,
            style: { textAnchor: "middle" }
          }
        }),
        h(Recharts.Tooltip, {
          key: "tip",
          labelFormatter: formatFullTimestamp,
          formatter: function (value) {
            if (value === null || value === undefined) return ["no reading", seriesName];
            return [isTemp ? value.toFixed(1) + " \u00b0C" : value.toFixed(0) + " %", seriesName];
          },
          contentStyle: { fontSize: "11px", fontFamily: "Arial, Helvetica, sans-serif" }
        })
      ];

      // Thresholds belong only on the temperature chart. ifOverflow "hidden"
      // keeps them from dragging the domain up when the CPU is nowhere near them.
      if (isTemp) {
        kids.push(h(Recharts.ReferenceLine, {
          key: "warn", y: payload.warn,
          stroke: COLOR_WARN, strokeDasharray: "6 3", strokeWidth: 1.8,
          ifOverflow: "hidden",
          label: {
            value: "Warning " + payload.warn + " \u00b0C",
            position: "insideTopRight", fontSize: 11, fill: COLOR_WARN
          }
        }));
        kids.push(h(Recharts.ReferenceLine, {
          key: "crit", y: payload.crit,
          stroke: COLOR_CRIT, strokeDasharray: "2 2", strokeWidth: 1.8,
          ifOverflow: "hidden",
          label: {
            value: "Critical " + payload.crit + " \u00b0C",
            position: "insideTopRight", fontSize: 11, fill: COLOR_CRIT
          }
        }));
      }

      /* strokeWidth 2 and activeDot r 4, matching Stratus WeatherChart.tsx. */
      kids.push(h(Recharts.Line, {
        key: "line", type: "monotone", dataKey: kind,
        name: seriesName, stroke: colour, strokeWidth: 2,
        dot: false, activeDot: { r: 4 }, connectNulls: false,
        isAnimationActive: false
      }));

      // Title above each plot, since there is no shared legend to name them.
      return h("div", {
        key: kind,
        style: {
          // flexWrap on the parent plus this basis is what makes the pair sit
          // side by side on a desktop and stack on a phone, with no media query.
          flex: "1 1 300px", minWidth: "280px", height: "100%",
          display: "flex", flexDirection: "column"
        }
      }, [
        h("div", {
          key: "title",
          style: {
            fontSize: "12px", fontWeight: "700", color: colour,
            fontFamily: "Arial, Helvetica, sans-serif",
            textAlign: "center", lineHeight: "1.2", paddingBottom: "2px"
          }
        }, axisLabel),
        h("div", { key: "plot", style: { flex: "1 1 auto", minHeight: 0 } },
          h(Recharts.ResponsiveContainer, { width: "100%", height: "100%" },
            h(Recharts.LineChart, {
              data: data,
              // Same margins as Stratus WeatherChart.tsx in its non-compact mode.
              margin: { top: 5, right: 20, left: 10, bottom: 5 }
            }, kids)))
      ]);
    }

    var charts = [seriesChart("temp")];
    if (hasLoad) charts.push(seriesChart("load"));

    return h("div", {
      style: {
        display: "flex", flexWrap: "wrap", gap: "12px",
        width: "100%", height: "100%", alignItems: "stretch"
      }
    }, charts);
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
