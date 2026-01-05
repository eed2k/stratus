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
   * Captures individual cards to avoid cutting content at page breaks
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
      const margin = 12;
      const headerHeight = 20;
      const footerHeight = 10;
      const contentWidth = pageWidth - margin * 2;
      const contentHeightPerPage = pageHeight - margin * 2 - headerHeight - footerHeight;
      const sectionGap = 6; // Gap between sections in mm
      
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

      // Find all exportable items - prioritize individual cards and smaller chunks
      const exportItems: HTMLElement[] = [];
      
      // Get all cards (individual components that shouldn't be split)
      const cardElements = element.querySelectorAll('[data-testid^="card-"]:not(.no-print)');
      
      // If we have individual cards, capture them for better page break control
      if (cardElements.length > 0) {
        // First, capture any current conditions header
        const currentConditions = element.querySelector('[class*="CurrentConditions"], [data-testid="current-conditions"]');
        if (currentConditions) {
          exportItems.push(currentConditions as HTMLElement);
        }
        
        // Then capture section headers followed by their content
        const sections = element.querySelectorAll('section:not(.no-print)');
        sections.forEach(section => {
          // Check if this section has cards or grids
          const sectionCards = section.querySelectorAll('[data-testid^="card-"]:not(.no-print)');
          const sectionGrids = section.querySelectorAll('.grid:not(.no-print)');
          
          if (sectionCards.length > 0 || sectionGrids.length > 0) {
            // Add the whole section as one block if it contains cards
            exportItems.push(section as HTMLElement);
          }
        });
        
        // If no sections with cards found, fall back to individual cards
        if (exportItems.length === 0) {
          cardElements.forEach(el => exportItems.push(el as HTMLElement));
        }
      } else {
        // Fall back to sections or the entire element
        const sectionElements = element.querySelectorAll('section:not(.no-print)');
        if (sectionElements.length > 0) {
          sectionElements.forEach(el => exportItems.push(el as HTMLElement));
        } else {
          exportItems.push(element);
        }
      }

      // If still no items found, capture whole element
      if (exportItems.length === 0) {
        exportItems.push(element);
      }

      // Capture each item as a separate image
      const itemImages: { imgData: string; heightMm: number; isSection: boolean }[] = [];
      
      for (const item of exportItems) {
        // Hide no-print elements temporarily
        const noPrintEls = item.querySelectorAll('.no-print');
        const hiddenEls: HTMLElement[] = [];
        noPrintEls.forEach(el => {
          const htmlEl = el as HTMLElement;
          if (htmlEl.style.display !== 'none') {
            hiddenEls.push(htmlEl);
            htmlEl.style.display = 'none';
          }
        });

        try {
          const canvas = await html2canvas(item, {
            backgroundColor: "#ffffff",
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: true,
            scrollY: -window.scrollY,
            windowHeight: document.documentElement.scrollHeight,
            onclone: (_clonedDoc, clonedElement) => {
              clonedElement.style.backgroundColor = "#ffffff";
              clonedElement.style.color = "#1a1a1a";
              clonedElement.style.padding = "8px";
              
              // Force white backgrounds on cards
              const cards = clonedElement.querySelectorAll('[class*="card"], [class*="Card"]');
              cards.forEach((card: Element) => {
                const cardEl = card as HTMLElement;
                cardEl.style.backgroundColor = "#ffffff";
                cardEl.style.borderColor = "#d1d5db";
                cardEl.style.color = "#1a1a1a";
                cardEl.style.marginBottom = "8px";
              });
              
              // Fix dark mode text colors and backgrounds
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

          const imgData = canvas.toDataURL("image/jpeg", 0.95);
          const imgRatio = canvas.height / canvas.width;
          const heightMm = contentWidth * imgRatio;
          const isSection = item.tagName.toLowerCase() === 'section';
          
          itemImages.push({ imgData, heightMm, isSection });
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
      for (const item of itemImages) {
        const itemHeightWithGap = item.heightMm + sectionGap;
        if (tempY + item.heightMm > pageHeight - margin - footerHeight) {
          // Would overflow - check if item fits on a new page
          if (item.heightMm <= contentHeightPerPage) {
            // Item fits on new page
            totalPages++;
            tempY = margin + headerHeight + itemHeightWithGap;
          } else {
            // Item too tall - will need to be split
            const pagesNeeded = Math.ceil(item.heightMm / contentHeightPerPage);
            totalPages += pagesNeeded;
            tempY = margin + headerHeight;
          }
        } else {
          tempY += itemHeightWithGap;
        }
      }

      // Helper to add header
      const addHeader = (pageNum: number) => {
        pdf.setFontSize(14);
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${stationName} - Dashboard Report`, margin, margin + 5);
        
        pdf.setFontSize(9);
        pdf.setTextColor(100, 100, 100);
        pdf.text(`Generated: ${dateStr}`, margin, margin + 12);
        pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin - 22, margin + 12);
        
        pdf.setDrawColor(200, 200, 200);
        pdf.line(margin, margin + 16, pageWidth - margin, margin + 16);
      };
      
      // Helper to add footer
      const addFooter = () => {
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text(
          "Stratus Weather Server",
          pageWidth / 2,
          pageHeight - 6,
          { align: "center" }
        );
      };

      // Add first page header/footer
      addHeader(currentPage);
      addFooter();

      // Second pass: add items to PDF with proper spacing
      for (const item of itemImages) {
        const spaceRemaining = pageHeight - margin - footerHeight - currentY;
        
        if (item.heightMm <= spaceRemaining - sectionGap) {
          // Item fits on current page with gap
          pdf.addImage(
            item.imgData,
            "JPEG",
            margin,
            currentY,
            contentWidth,
            item.heightMm
          );
          currentY += item.heightMm + sectionGap;
        } else if (item.heightMm <= contentHeightPerPage) {
          // Item doesn't fit but will fit on new page - move to new page
          pdf.addPage();
          currentPage++;
          addHeader(currentPage);
          addFooter();
          currentY = margin + headerHeight;
          
          pdf.addImage(
            item.imgData,
            "JPEG",
            margin,
            currentY,
            contentWidth,
            item.heightMm
          );
          currentY += item.heightMm + sectionGap;
        } else {
          // Item is too tall - must split it (for very tall sections)
          // This uses canvas slicing as a fallback
          const img = new Image();
          img.src = item.imgData;
          
          await new Promise<void>((resolve) => {
            img.onload = () => {
              const pxPerMm = img.width / contentWidth;
              let remainingHeightMm = item.heightMm;
              let sourceY = 0;
              
              while (remainingHeightMm > 0) {
                const availableHeight = currentPage === 1 && currentY === margin + headerHeight 
                  ? contentHeightPerPage 
                  : pageHeight - margin - footerHeight - currentY - sectionGap;
                
                if (availableHeight < 30) {
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
                  
                  const sliceData = sliceCanvas.toDataURL("image/jpeg", 0.95);
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
