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
      const originalBg = element.style.backgroundColor;
      const originalColor = element.style.color;
      
      // Temporarily set white background and dark text for PDF
      element.style.backgroundColor = "#ffffff";
      element.style.color = "#000000";
      
      // Add class for print styling
      element.classList.add("pdf-export-mode");
      
      // Capture with white background at high resolution
      const canvas = await html2canvas(element, {
        backgroundColor: "#ffffff",
        scale: 2, // High resolution
        logging: false,
        useCORS: true,
        allowTaint: true,
        scrollX: 0,
        scrollY: 0,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        onclone: (clonedDoc) => {
          // Apply white background to all elements in cloned document
          const clonedElement = clonedDoc.getElementById(targetId);
          if (clonedElement) {
            clonedElement.style.backgroundColor = "#ffffff";
            clonedElement.style.color = "#1a1a1a";
            
            // Force white backgrounds on cards and sections
            const cards = clonedElement.querySelectorAll('[class*="card"], [class*="Card"]');
            cards.forEach((card: Element) => {
              (card as HTMLElement).style.backgroundColor = "#ffffff";
              (card as HTMLElement).style.borderColor = "#e5e7eb";
              (card as HTMLElement).style.color = "#1a1a1a";
            });
            
            // Make text visible on white
            const textElements = clonedElement.querySelectorAll('*');
            textElements.forEach((el: Element) => {
              const htmlEl = el as HTMLElement;
              const computedStyle = window.getComputedStyle(el);
              // If text color is light (for dark mode), make it dark
              if (computedStyle.color === 'rgb(255, 255, 255)' || 
                  computedStyle.color === 'rgba(255, 255, 255, 1)') {
                htmlEl.style.color = "#1a1a1a";
              }
            });
            
            // Hide no-print elements
            const noPrintElements = clonedElement.querySelectorAll('.no-print');
            noPrintElements.forEach((el: Element) => {
              (el as HTMLElement).style.display = 'none';
            });
          }
        }
      });

      // Restore original styles
      element.style.backgroundColor = originalBg;
      element.style.color = originalColor;
      element.classList.remove("pdf-export-mode");

      const imgData = canvas.toDataURL("image/png", 1.0);
      
      // A4 page dimensions in mm
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 10; // 10mm margins
      
      // Calculate image dimensions to fit page width (minus margins)
      const contentWidth = pageWidth - (margin * 2);
      const imgRatio = canvas.height / canvas.width;
      const scaledWidth = contentWidth;
      const scaledHeight = contentWidth * imgRatio;
      
      // Calculate how many pages we need
      const contentHeight = pageHeight - (margin * 2) - 20; // Extra space for header/footer
      const totalPages = Math.ceil(scaledHeight / contentHeight);
      
      // Create PDF
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      // Add header info
      const dateStr = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          pdf.addPage();
        }

        // Add header on each page
        pdf.setFontSize(16);
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${stationName} - Dashboard Report`, margin, margin + 5);
        
        pdf.setFontSize(9);
        pdf.setTextColor(100, 100, 100);
        pdf.text(`Generated: ${dateStr}`, margin, margin + 11);
        pdf.text(`Page ${page + 1} of ${totalPages}`, pageWidth - margin - 25, margin + 11);

        // Calculate source and destination rectangles
        const sourceY = page * contentHeight * (canvas.height / scaledHeight);
        const sourceHeight = Math.min(
          contentHeight * (canvas.height / scaledHeight),
          canvas.height - sourceY
        );
        
        // Create a temporary canvas for this page section
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sourceHeight;
        const ctx = pageCanvas.getContext("2d");
        
        if (ctx) {
          ctx.drawImage(
            canvas,
            0, sourceY, // Source x, y
            canvas.width, sourceHeight, // Source width, height
            0, 0, // Dest x, y
            canvas.width, sourceHeight // Dest width, height
          );
          
          const pageImgData = pageCanvas.toDataURL("image/png", 1.0);
          const destHeight = sourceHeight * (scaledWidth / canvas.width);
          
          pdf.addImage(
            pageImgData,
            "PNG",
            margin,
            margin + 15, // Below header
            scaledWidth,
            destHeight
          );
        }

        // Add footer
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text(
          "Stratus Weather Server - https://stratus.weather",
          pageWidth / 2,
          pageHeight - 5,
          { align: "center" }
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
