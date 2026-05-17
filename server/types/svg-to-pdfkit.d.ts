// Minimal ambient declaration for svg-to-pdfkit. The package ships
// CommonJS only and has no @types entry; we just need the call signature
// `SVGtoPDF(doc, svg, x, y, options?)`.
declare module "svg-to-pdfkit" {
  import type PDFDocument from "pdfkit";
  function SVGtoPDF(
    doc: PDFDocument,
    svg: string,
    x?: number,
    y?: number,
    options?: Record<string, any>,
  ): void;
  export = SVGtoPDF;
}
