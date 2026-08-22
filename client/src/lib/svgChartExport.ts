// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Shared SVG -> PNG export helper for the polar wind charts
 * (wind rose, wind speed scatter, wind power rose).
 *
 * The charts render their plot area as an inline <svg> while the legend and
 * stat blocks are plain DOM elements next to it. Serialising only the <svg>
 * therefore produced a PNG with no legend, which made the downloaded image
 * unreadable. This helper rebuilds the export document as:
 *
 *   [ title ] [ plot svg ] [ stat lines ] [ legend swatches ]
 *
 * so everything the user sees on screen is baked into the PNG.
 */

export type LegendShape = "rect" | "circle";

export interface ExportLegendItem {
  label: string;
  color: string;
  shape?: LegendShape;
}

export interface ExportSvgOptions {
  /** The live <svg> element holding the plot. */
  svg: SVGSVGElement;
  /** Title drawn above the plot. */
  title: string;
  /** Plot width in px (usually the chart `size`). */
  width: number;
  /** Plot height in px (usually the chart `size`). */
  height: number;
  /** Legend entries drawn under the plot. */
  legend?: ExportLegendItem[];
  /** Short stat lines drawn between the plot and the legend. */
  stats?: string[];
  /** Wrapped caption lines drawn under the legend. */
  captions?: string[];
  /** Download filename (without extension). */
  filename?: string;
  /** Raster scale factor. 3 => ~300 DPI-ish for a 320px chart. */
  scale?: number;
}

const NS = "http://www.w3.org/2000/svg";

const TITLE_H = 34;
const STAT_LINE_H = 14;
const LEGEND_ROW_H = 16;
const CAPTION_LINE_H = 12;
const PAD_X = 10;
const LEGEND_FONT = 10;
const CAPTION_FONT = 9;

/** Rough advance width for Arial at a given font size - good enough for layout. */
function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56;
}

function el(name: string): SVGElement {
  return document.createElementNS(NS, name) as SVGElement;
}

function addText(
  parent: SVGElement,
  text: string,
  x: number,
  y: number,
  opts: { size?: number; weight?: string; fill?: string; anchor?: string } = {},
): void {
  const t = el("text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("font-family", "Arial, Helvetica, sans-serif");
  t.setAttribute("font-size", String(opts.size ?? 11));
  t.setAttribute("fill", opts.fill ?? "#000");
  if (opts.weight) t.setAttribute("font-weight", opts.weight);
  if (opts.anchor) t.setAttribute("text-anchor", opts.anchor);
  t.textContent = text;
  parent.appendChild(t);
}

/** Pack legend items into centred rows that fit inside `maxWidth`. */
function layoutLegend(items: ExportLegendItem[], maxWidth: number): ExportLegendItem[][] {
  const rows: ExportLegendItem[][] = [];
  let row: ExportLegendItem[] = [];
  let rowWidth = 0;
  const itemWidth = (it: ExportLegendItem) => 12 + 4 + textWidth(it.label, LEGEND_FONT) + 12;
  for (const it of items) {
    const w = itemWidth(it);
    if (row.length > 0 && rowWidth + w > maxWidth) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    row.push(it);
    rowWidth += w;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** Wrap a caption string into lines that fit inside `maxWidth`. */
function wrapCaption(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (line && textWidth(candidate, CAPTION_FONT) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Clone the plot SVG, resolve CSS-variable driven colours to literals, and
 * strip classes so the markup renders standalone inside an <img>.
 */
function cloneResolved(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  const inline = (tag: string, apply: (computed: CSSStyleDeclaration, target: Element) => void) => {
    const orig = svg.querySelectorAll(tag);
    const copies = clone.querySelectorAll(tag);
    orig.forEach((o, i) => {
      const target = copies[i];
      if (!target) return;
      apply(window.getComputedStyle(o), target);
    });
  };

  inline("text", (cs, target) => {
    target.setAttribute("fill", cs.fill && cs.fill !== "none" ? cs.fill : cs.color || "#000");
    target.setAttribute("font-size", cs.fontSize);
    target.setAttribute("font-family", cs.fontFamily || "Arial, Helvetica, sans-serif");
    if (cs.fontWeight) target.setAttribute("font-weight", cs.fontWeight);
  });
  inline("circle", (cs, target) => {
    if (target.getAttribute("stroke") === "currentColor") target.setAttribute("stroke", cs.color || "#666");
    if (target.getAttribute("fill") === "currentColor") target.setAttribute("fill", cs.color || "#ccc");
  });
  inline("line", (cs, target) => {
    if (target.getAttribute("stroke") === "currentColor") target.setAttribute("stroke", cs.color || "#666");
  });
  inline("path", (cs, target) => {
    if (target.getAttribute("stroke") === "currentColor") target.setAttribute("stroke", cs.color || "#666");
    if (target.getAttribute("fill") === "currentColor") target.setAttribute("fill", cs.color || "#ccc");
  });

  clone.querySelectorAll("[class]").forEach((n) => n.removeAttribute("class"));
  // Tooltips add noise to the serialised markup and never render in a PNG.
  clone.querySelectorAll("title").forEach((n) => n.remove());
  return clone;
}

/**
 * Build the composed export document and trigger a PNG download.
 */
export function exportChartPng(opts: ExportSvgOptions): void {
  const { svg, title, width, height } = opts;
  const scale = opts.scale ?? 3;
  const legendItems = opts.legend ?? [];
  const statLines = (opts.stats ?? []).filter(Boolean);
  const innerWidth = width - PAD_X * 2;

  const legendRows = legendItems.length ? layoutLegend(legendItems, innerWidth) : [];
  const captionLines = (opts.captions ?? []).flatMap((c) => wrapCaption(c, innerWidth));

  const statsH = statLines.length ? statLines.length * STAT_LINE_H + 6 : 0;
  const legendH = legendRows.length ? legendRows.length * LEGEND_ROW_H + 8 : 0;
  const captionH = captionLines.length ? captionLines.length * CAPTION_LINE_H + 6 : 0;
  const totalH = TITLE_H + height + statsH + legendH + captionH + 10;

  const out = document.createElementNS(NS, "svg") as SVGSVGElement;
  out.setAttribute("xmlns", NS);
  out.setAttribute("width", String(width));
  out.setAttribute("height", String(totalH));
  out.setAttribute("viewBox", `0 0 ${width} ${totalH}`);

  // White background so the PNG isn't transparent when pasted into documents.
  const bg = el("rect");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(totalH));
  bg.setAttribute("fill", "#ffffff");
  out.appendChild(bg);

  addText(out, title, width / 2, 22, { size: 14, weight: "bold", anchor: "middle", fill: "#111" });

  // Plot: move the cloned children into a translated group rather than
  // nesting an <svg>, so nothing gets clipped by a nested viewport.
  const plot = cloneResolved(svg);
  const plotGroup = el("g");
  plotGroup.setAttribute("transform", `translate(0, ${TITLE_H})`);
  while (plot.firstChild) plotGroup.appendChild(plot.firstChild);
  out.appendChild(plotGroup);

  let cursorY = TITLE_H + height;

  if (statLines.length) {
    cursorY += 4;
    statLines.forEach((line, i) => {
      addText(out, line, width / 2, cursorY + (i + 1) * STAT_LINE_H - 4, {
        size: 10,
        anchor: "middle",
        fill: "#333",
      });
    });
    cursorY += statLines.length * STAT_LINE_H + 2;
  }

  if (legendRows.length) {
    cursorY += 6;
    legendRows.forEach((row, rowIndex) => {
      const rowW = row.reduce((sum, it) => sum + 12 + 4 + textWidth(it.label, LEGEND_FONT) + 12, 0);
      let x = Math.max(PAD_X, (width - rowW) / 2);
      const y = cursorY + rowIndex * LEGEND_ROW_H;
      for (const it of row) {
        const shape = it.shape ?? "rect";
        if (shape === "circle") {
          const c = el("circle");
          c.setAttribute("cx", String(x + 5));
          c.setAttribute("cy", String(y + 4));
          c.setAttribute("r", "5");
          c.setAttribute("fill", it.color);
          out.appendChild(c);
        } else {
          const r = el("rect");
          r.setAttribute("x", String(x));
          r.setAttribute("y", String(y - 1));
          r.setAttribute("width", "10");
          r.setAttribute("height", "10");
          r.setAttribute("rx", "2");
          r.setAttribute("fill", it.color);
          out.appendChild(r);
        }
        addText(out, it.label, x + 14, y + 8, { size: LEGEND_FONT, fill: "#333" });
        x += 12 + 4 + textWidth(it.label, LEGEND_FONT) + 12;
      }
    });
    cursorY += legendRows.length * LEGEND_ROW_H + 2;
  }

  if (captionLines.length) {
    cursorY += 4;
    captionLines.forEach((line, i) => {
      addText(out, line, width / 2, cursorY + (i + 1) * CAPTION_LINE_H - 3, {
        size: CAPTION_FONT,
        anchor: "middle",
        fill: "#666",
      });
    });
  }

  const markup = new XMLSerializer().serializeToString(out);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  const safeName = (opts.filename || title).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "chart";

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(totalH * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) { URL.revokeObjectURL(url); return; }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, totalH);
    URL.revokeObjectURL(url);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${safeName}.png`;
      a.click();
      URL.revokeObjectURL(href);
    }, "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}
