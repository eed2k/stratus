import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

interface ExportToolsProps {
  targetId?: string;
  stationName?: string;
}

export function ExportTools({ targetId = "dashboard-content", stationName = "Weather Station" }: ExportToolsProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handlePrint = () => {
    window.print();
  };

  /**
   * Export dashboard as multi-page PDF with white background
   * Captures the full dashboard and splits it across multiple pages
   * Uses a simpler, more reliable approach
   */
  const handlePDF = async () => {
    setIsExporting(true);
    
    toast({
      title: "Generating PDF",
      description: "Please wait while the dashboard is being captured...",
    });

    try {
      const element = document.getElementById(targetId);
      if (!element) {
        throw new Error("Dashboard content not found");
      }

      // Store original styles
      const originalStyles = {
        bg: element.style.backgroundColor,
        color: element.style.color,
        overflow: element.style.overflow,
      };
      
      // Temporarily set white background and dark text for PDF
      element.style.backgroundColor = "#ffffff";
      element.style.color = "#000000";
      
      // Add class for print styling
      element.classList.add("pdf-export-mode");
      
      // Hide no-print elements throughout the document
      const noPrintEls = element.querySelectorAll('.no-print');
      const hiddenEls: HTMLElement[] = [];
      noPrintEls.forEach(el => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.style.display !== 'none') {
          hiddenEls.push(htmlEl);
          htmlEl.style.display = 'none';
        }
      });

      // Wait a moment for styles to apply
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Capture the entire dashboard as one canvas
      const canvas = await html2canvas(element, {
        backgroundColor: "#ffffff",
        scale: 1.5, // Lower scale for better performance and smaller file size
        logging: false,
        useCORS: true,
        allowTaint: true,
        scrollX: 0,
        scrollY: 0,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        onclone: (clonedDoc, clonedElement) => {
          // Apply white background to all elements in cloned document
          clonedElement.style.backgroundColor = "#ffffff";
          clonedElement.style.color = "#1a1a1a";
          
          // Force white backgrounds on cards
          const cards = clonedElement.querySelectorAll('[class*="card"], [class*="Card"]');
          cards.forEach((card: Element) => {
            const cardEl = card as HTMLElement;
            cardEl.style.backgroundColor = "#ffffff";
            cardEl.style.borderColor = "#e5e7eb";
            cardEl.style.color = "#1a1a1a";
          });
          
          // Fix dark mode text colors
          const allElements = clonedElement.querySelectorAll('*');
          allElements.forEach((el: Element) => {
            const htmlEl = el as HTMLElement;
            const computedStyle = window.getComputedStyle(el);
            
            // Fix white/light text
            const color = computedStyle.color;
            if (color === 'rgb(255, 255, 255)' || 
                color === 'rgba(255, 255, 255, 1)' ||
                color.includes('255, 255, 255')) {
              htmlEl.style.color = "#1a1a1a";
            }
            
            // Fix dark backgrounds
            const bgColor = computedStyle.backgroundColor;
            if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
              const rgb = bgColor.match(/\d+/g);
              if (rgb && rgb.length >= 3) {
                const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
                if (brightness < 128) {
                  htmlEl.style.backgroundColor = "#ffffff";
                }
              }
            }
          });
          
          // Hide no-print elements in cloned doc
          const clonedNoPrint = clonedElement.querySelectorAll('.no-print');
          clonedNoPrint.forEach((el: Element) => {
            (el as HTMLElement).style.display = 'none';
          });
        }
      });
      
      // Restore hidden elements
      hiddenEls.forEach(el => {
        el.style.display = '';
      });
      
      // Restore original styles
      element.style.backgroundColor = originalStyles.bg;
      element.style.color = originalStyles.color;
      element.style.overflow = originalStyles.overflow;
      element.classList.remove("pdf-export-mode");

      // A4 page dimensions in mm
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 10;
      const headerHeight = 18;
      const footerHeight = 8;
      const contentWidth = pageWidth - margin * 2;
      const contentHeightPerPage = pageHeight - margin * 2 - headerHeight - footerHeight;
      
      // Calculate image dimensions to fit page width
      const imgWidthPx = canvas.width;
      const imgHeightPx = canvas.height;
      const imgRatio = imgHeightPx / imgWidthPx;
      const imgWidthMm = contentWidth;
      const imgHeightMm = contentWidth * imgRatio;
      
      // Calculate number of pages needed
      const totalPages = Math.ceil(imgHeightMm / contentHeightPerPage);
      
      // Create PDF
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      
      // Date string for headers
      const dateStr = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      
      // Helper to add header
      const addHeader = (pageNum: number) => {
        pdf.setFontSize(14);
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${stationName} - Dashboard Report`, margin, margin + 4);
        
        pdf.setFontSize(8);
        pdf.setTextColor(100, 100, 100);
        pdf.text(`Generated: ${dateStr}`, margin, margin + 10);
        pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin - 20, margin + 10);
        
        // Header line
        pdf.setDrawColor(200, 200, 200);
        pdf.line(margin, margin + 14, pageWidth - margin, margin + 14);
      };
      
      // Helper to add footer
      const addFooter = () => {
        pdf.setFontSize(7);
        pdf.setTextColor(150, 150, 150);
        pdf.text(
          "Stratus Weather Server",
          pageWidth / 2,
          pageHeight - 5,
          { align: "center" }
        );
      };
      
      // Create temporary canvas for slicing
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      
      if (!tempCtx) {
        throw new Error("Could not create canvas context");
      }
      
      // Calculate pixels per page
      const pxPerMm = imgWidthPx / imgWidthMm;
      const pxPerPage = contentHeightPerPage * pxPerMm;
      
      // Add each page
      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          pdf.addPage();
        }
        
        // Add header and footer
        addHeader(page + 1);
        addFooter();
        
        // Calculate the slice of the original canvas for this page
        const sourceY = page * pxPerPage;
        const sourceHeight = Math.min(pxPerPage, imgHeightPx - sourceY);
        const destHeightMm = (sourceHeight / pxPerMm);
        
        // Create a slice of the canvas for this page
        tempCanvas.width = imgWidthPx;
        tempCanvas.height = Math.ceil(sourceHeight);
        
        // Draw the slice
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(
          canvas,
          0, sourceY, imgWidthPx, sourceHeight,
          0, 0, imgWidthPx, sourceHeight
        );
        
        // Add to PDF
        const sliceData = tempCanvas.toDataURL("image/jpeg", 0.92);
        pdf.addImage(
          sliceData,
          "JPEG",
          margin,
          margin + headerHeight,
          contentWidth,
          destHeightMm
        );
      }

      // Save the PDF
      const filename = `${stationName.replace(/\s+/g, "_")}_Dashboard_${new Date().toISOString().split("T")[0]}.pdf`;
      pdf.save(filename);

      toast({
        title: "PDF saved",
        description: `Dashboard exported as ${totalPages}-page PDF.`,
      });
    } catch (error) {
      console.error("PDF export error:", error);
      toast({
        title: "Export failed",
        description: "Could not generate PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          disabled={isExporting}
          data-testid="button-export"
        >
          {isExporting ? "Exporting..." : "Export"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handlePrint} data-testid="menu-print">
          Print
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handlePDF} data-testid="menu-pdf">
          Save as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
