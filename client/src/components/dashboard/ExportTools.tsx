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
   * Ensures sections are not cut off - moves them to new pages if needed
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
      
      // Get all sections (semantic sections within the dashboard)
      const sections = element.querySelectorAll('section:not(.no-print)');
      
      // A4 page dimensions in mm
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 10;
      const headerHeight = 20;
      const footerHeight = 10;
      const contentHeight = pageHeight - margin * 2 - headerHeight - footerHeight;
      const contentWidth = pageWidth - margin * 2;
      
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
      
      let currentPage = 1;
      let currentY = margin + headerHeight;
      
      // Helper to add header
      const addHeader = (pageNum: number, totalPages: number) => {
        pdf.setFontSize(16);
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${stationName} - Dashboard Report`, margin, margin + 5);
        
        pdf.setFontSize(9);
        pdf.setTextColor(100, 100, 100);
        pdf.text(`Generated: ${dateStr}`, margin, margin + 11);
        pdf.text(`Page ${pageNum}`, pageWidth - margin - 15, margin + 11);
      };
      
      // Helper to add footer
      const addFooter = () => {
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text(
          "Stratus Weather Server - https://stratus.weather",
          pageWidth / 2,
          pageHeight - 5,
          { align: "center" }
        );
      };
      
      // Add first page header
      addHeader(currentPage, 1);
      
      // Process each section individually to avoid cutting them off
      for (const section of Array.from(sections)) {
        const sectionEl = section as HTMLElement;
        
        // Hide no-print elements temporarily
        const noPrintEls = sectionEl.querySelectorAll('.no-print');
        noPrintEls.forEach(el => {
          (el as HTMLElement).style.display = 'none';
        });
        
        // Capture this section
        const sectionCanvas = await html2canvas(sectionEl, {
          backgroundColor: "#ffffff",
          scale: 2,
          logging: false,
          useCORS: true,
          allowTaint: true,
          onclone: (clonedDoc) => {
            const clonedSection = clonedDoc.body.querySelector('section');
            if (clonedSection) {
              clonedSection.style.backgroundColor = "#ffffff";
              clonedSection.style.color = "#1a1a1a";
              
              // Force white backgrounds on cards
              const cards = clonedSection.querySelectorAll('[class*="card"], [class*="Card"]');
              cards.forEach((card: Element) => {
                (card as HTMLElement).style.backgroundColor = "#ffffff";
                (card as HTMLElement).style.borderColor = "#e5e7eb";
                (card as HTMLElement).style.color = "#1a1a1a";
              });
              
              // Make text visible on white
              const textElements = clonedSection.querySelectorAll('*');
              textElements.forEach((el: Element) => {
                const htmlEl = el as HTMLElement;
                const computedStyle = window.getComputedStyle(el);
                if (computedStyle.color === 'rgb(255, 255, 255)' || 
                    computedStyle.color === 'rgba(255, 255, 255, 1)') {
                  htmlEl.style.color = "#1a1a1a";
                }
              });
            }
          }
        });
        
        // Restore no-print elements
        noPrintEls.forEach(el => {
          (el as HTMLElement).style.display = '';
        });
        
        const sectionImgData = sectionCanvas.toDataURL("image/png", 1.0);
        const imgRatio = sectionCanvas.height / sectionCanvas.width;
        const sectionWidthMm = contentWidth;
        const sectionHeightMm = contentWidth * imgRatio;
        
        // Check if section fits on current page
        const spaceRemaining = pageHeight - margin - footerHeight - currentY;
        
        if (sectionHeightMm > spaceRemaining) {
          // Section doesn't fit - start new page
          addFooter();
          pdf.addPage();
          currentPage++;
          currentY = margin + headerHeight;
          addHeader(currentPage, currentPage);
        }
        
        // Add the section image to PDF
        pdf.addImage(
          sectionImgData,
          "PNG",
          margin,
          currentY,
          sectionWidthMm,
          sectionHeightMm
        );
        
        currentY += sectionHeightMm + 5; // 5mm gap between sections
      }
      
      // Add final footer
      addFooter();

      // Restore original styles
      element.style.backgroundColor = originalBg;
      element.style.color = originalColor;
      element.classList.remove("pdf-export-mode");

      // Save the PDF
      const filename = `${stationName.replace(/\s+/g, "_")}_Dashboard_${new Date().toISOString().split("T")[0]}.pdf`;
      pdf.save(filename);

      toast({
        title: "PDF saved",
        description: `Dashboard exported as ${currentPage}-page PDF.`,
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
