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
   * Captures individual sections/cards to avoid cutting content at page breaks
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

      // A4 page dimensions in mm
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 10;
      const headerHeight = 18;
      const footerHeight = 8;
      const contentWidth = pageWidth - margin * 2;
      const contentHeightPerPage = pageHeight - margin * 2 - headerHeight - footerHeight;
      
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

      // Find all exportable sections - look for cards, sections, and grid containers
      const sections: HTMLElement[] = [];
      
      // Get sections, grids with cards, and standalone cards
      const sectionElements = element.querySelectorAll('section:not(.no-print)');
      const gridElements = element.querySelectorAll('.grid:not(.no-print)');
      const cardElements = element.querySelectorAll('[data-testid^="card-"]:not(.no-print)');
      
      // If we have sections, use those
      if (sectionElements.length > 0) {
        sectionElements.forEach(el => sections.push(el as HTMLElement));
      } else if (gridElements.length > 0) {
        // Use grid containers
        gridElements.forEach(el => sections.push(el as HTMLElement));
      } else if (cardElements.length > 0) {
        // Fall back to individual cards
        cardElements.forEach(el => sections.push(el as HTMLElement));
      } else {
        // Last resort: use the entire element
        sections.push(element);
      }

      // If still no sections found, capture whole element
      if (sections.length === 0) {
        sections.push(element);
      }

      // Capture each section as a separate image
      const sectionImages: { imgData: string; heightMm: number }[] = [];
      
      for (const section of sections) {
        // Hide no-print elements temporarily
        const noPrintEls = section.querySelectorAll('.no-print');
        const hiddenEls: HTMLElement[] = [];
        noPrintEls.forEach(el => {
          const htmlEl = el as HTMLElement;
          if (htmlEl.style.display !== 'none') {
            hiddenEls.push(htmlEl);
            htmlEl.style.display = 'none';
          }
        });

        try {
          const canvas = await html2canvas(section, {
            backgroundColor: "#ffffff",
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: true,
            onclone: (clonedDoc, clonedElement) => {
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
                const color = computedStyle.color;
                if (color === 'rgb(255, 255, 255)' || 
                    color === 'rgba(255, 255, 255, 1)' ||
                    color.includes('255, 255, 255')) {
                  htmlEl.style.color = "#1a1a1a";
                }
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
              
              const clonedNoPrint = clonedElement.querySelectorAll('.no-print');
              clonedNoPrint.forEach((el: Element) => {
                (el as HTMLElement).style.display = 'none';
              });
            }
          });

          const imgData = canvas.toDataURL("image/jpeg", 0.92);
          const imgRatio = canvas.height / canvas.width;
          const heightMm = contentWidth * imgRatio;
          
          sectionImages.push({ imgData, heightMm });
        } finally {
          // Restore hidden elements
          hiddenEls.forEach(el => {
            el.style.display = '';
          });
        }
      }

      // Now layout the images across pages, avoiding cutting sections
      let currentPage = 1;
      let currentY = margin + headerHeight;
      let totalPages = 1;

      // First pass: calculate total pages needed
      let tempY = margin + headerHeight;
      for (const section of sectionImages) {
        if (tempY + section.heightMm > pageHeight - margin - footerHeight) {
          // Would overflow - check if section fits on a new page
          if (section.heightMm <= contentHeightPerPage) {
            // Section fits on new page
            totalPages++;
            tempY = margin + headerHeight + section.heightMm + 3;
          } else {
            // Section too tall - will need to be split (rare case)
            const pagesNeeded = Math.ceil(section.heightMm / contentHeightPerPage);
            totalPages += pagesNeeded;
            tempY = margin + headerHeight;
          }
        } else {
          tempY += section.heightMm + 3;
        }
      }

      // Helper to add header
      const addHeader = (pageNum: number) => {
        pdf.setFontSize(14);
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${stationName} - Dashboard Report`, margin, margin + 4);
        
        pdf.setFontSize(8);
        pdf.setTextColor(100, 100, 100);
        pdf.text(`Generated: ${dateStr}`, margin, margin + 10);
        pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin - 20, margin + 10);
        
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

      // Add first page header/footer
      addHeader(currentPage);
      addFooter();

      // Second pass: add sections to PDF
      for (const section of sectionImages) {
        const spaceRemaining = pageHeight - margin - footerHeight - currentY;
        
        if (section.heightMm <= spaceRemaining) {
          // Section fits on current page
          pdf.addImage(
            section.imgData,
            "JPEG",
            margin,
            currentY,
            contentWidth,
            section.heightMm
          );
          currentY += section.heightMm + 3; // 3mm gap between sections
        } else if (section.heightMm <= contentHeightPerPage) {
          // Section doesn't fit but will fit on new page - move to new page
          pdf.addPage();
          currentPage++;
          addHeader(currentPage);
          addFooter();
          currentY = margin + headerHeight;
          
          pdf.addImage(
            section.imgData,
            "JPEG",
            margin,
            currentY,
            contentWidth,
            section.heightMm
          );
          currentY += section.heightMm + 3;
        } else {
          // Section is too tall - must split it (rare case for very tall charts)
          // This uses canvas slicing as a fallback
          const img = new Image();
          img.src = section.imgData;
          
          await new Promise<void>((resolve) => {
            img.onload = () => {
              const pxPerMm = img.width / contentWidth;
              let remainingHeightMm = section.heightMm;
              let sourceY = 0;
              
              while (remainingHeightMm > 0) {
                const availableHeight = currentPage === 1 && currentY === margin + headerHeight 
                  ? contentHeightPerPage 
                  : pageHeight - margin - footerHeight - currentY;
                
                if (availableHeight < 20) {
                  // Not enough space, start new page
                  pdf.addPage();
                  currentPage++;
                  addHeader(currentPage);
                  addFooter();
                  currentY = margin + headerHeight;
                  continue;
                }
                
                const sliceHeightMm = Math.min(remainingHeightMm, availableHeight);
                const sliceHeightPx = sliceHeightMm * pxPerMm;
                
                // Create slice canvas
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = img.width;
                sliceCanvas.height = Math.ceil(sliceHeightPx);
                const ctx = sliceCanvas.getContext('2d');
                
                if (ctx) {
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
                  ctx.drawImage(
                    img,
                    0, sourceY, img.width, sliceHeightPx,
                    0, 0, img.width, sliceHeightPx
                  );
                  
                  const sliceData = sliceCanvas.toDataURL("image/jpeg", 0.92);
                  pdf.addImage(
                    sliceData,
                    "JPEG",
                    margin,
                    currentY,
                    contentWidth,
                    sliceHeightMm
                  );
                }
                
                sourceY += sliceHeightPx;
                remainingHeightMm -= sliceHeightMm;
                currentY += sliceHeightMm;
                
                if (remainingHeightMm > 0) {
                  pdf.addPage();
                  currentPage++;
                  addHeader(currentPage);
                  addFooter();
                  currentY = margin + headerHeight;
                }
              }
              resolve();
            };
            img.onerror = () => resolve();
          });
        }
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
