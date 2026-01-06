import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

interface ExportToolsProps {
  targetId?: string;
  stationName?: string;
  stationId?: number;
  enabledParameters?: string[];
}

export function ExportTools({ 
  targetId = "dashboard-content", 
  stationName = "Weather Station",
  stationId,
  enabledParameters = []
}: ExportToolsProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handlePrint = () => {
    window.print();
  };

  /**
   * Fast server-side PDF export (optimized for Railway)
   * Generates PDF from data directly without DOM capture
   */
  const handleServerPDF = async () => {
    if (!stationId) {
      toast({
        title: "Export error",
        description: "Station ID is required for server-side export",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    
    try {
      toast({
        title: "Generating PDF...",
        description: "Processing on server for faster export",
      });

      const response = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stationId,
          enabledParameters,
          title: `${stationName} - Dashboard Report`,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to generate PDF');
      }

      // Download the PDF
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stationName.replace(/\s+/g, '_')}_Dashboard_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "PDF saved",
        description: "Dashboard report exported successfully.",
      });
    } catch (error: any) {
      console.error("Server PDF export error:", error);
      toast({
        title: "Export failed",
        description: error.message || "Could not generate PDF. Try visual export instead.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  /**
   * Capture a single element to canvas with white background
   */
  const captureElement = async (element: HTMLElement): Promise<HTMLCanvasElement> => {
    return html2canvas(element, {
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
        
        // Force white backgrounds on all elements
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
        
        // Hide no-print elements
        const clonedNoPrint = clonedElement.querySelectorAll('.no-print');
        clonedNoPrint.forEach((el: Element) => {
          (el as HTMLElement).style.display = 'none';
        });
      }
    });
  };

  /**
   * Visual PDF export (captures dashboard exactly as displayed)
   * Uses html2canvas - may be slower but captures charts and visual elements
   */
  const handleVisualPDF = async () => {
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

      // A4 landscape page dimensions in mm
      const pageWidth = 297;
      const pageHeight = 210;
      const margin = 10;
      const headerHeight = 18;
      const footerHeight = 10;
      const contentWidth = pageWidth - margin * 2;
      const contentHeightPerPage = pageHeight - margin * 2 - headerHeight - footerHeight;
      const itemGap = 3; // Gap between items in mm
      
      // Create PDF in landscape orientation
      const pdf = new jsPDF({
        orientation: "landscape",
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

      // Collect ALL individual exportable items (cards, sections headers, etc.)
      interface ExportItem {
        element: HTMLElement;
        type: 'card' | 'section-header' | 'grid' | 'other';
        sectionTitle?: string;
      }
      const exportItems: ExportItem[] = [];
      
      // First, get the current conditions card (top priority)
      const currentConditions = element.querySelector('[data-testid="card-current-conditions"]');
      if (currentConditions) {
        exportItems.push({ element: currentConditions as HTMLElement, type: 'card' });
      }
      
      // Then process each section
      const sections = element.querySelectorAll('section:not(.no-print)');
      sections.forEach(section => {
        // Capture section header (h2) separately
        const sectionHeader = section.querySelector('h2');
        if (sectionHeader) {
          exportItems.push({ 
            element: sectionHeader as HTMLElement, 
            type: 'section-header',
            sectionTitle: sectionHeader.textContent || ''
          });
        }
        
        // Capture each individual card in this section
        const cards = section.querySelectorAll('[data-testid^="card-"]:not(.no-print)');
        cards.forEach(card => {
          exportItems.push({ element: card as HTMLElement, type: 'card' });
        });
        
        // Capture grids that contain MetricCards (they don't have data-testid)
        const grids = section.querySelectorAll('.grid:not(.no-print)');
        grids.forEach(grid => {
          // Check if this grid has cards we already captured
          const hasCards = grid.querySelectorAll('[data-testid^="card-"]').length > 0;
          if (!hasCards) {
            // This grid has items without data-testid (like MetricCards)
            exportItems.push({ element: grid as HTMLElement, type: 'grid' });
          }
        });
      });

      // If no items found, fall back to capturing the whole element
      if (exportItems.length === 0) {
        exportItems.push({ element, type: 'other' });
      }

      // Capture each item as a separate image
      interface CapturedItem {
        imgData: string;
        heightMm: number;
        widthMm: number;
        type: ExportItem['type'];
        sectionTitle?: string;
      }
      const capturedItems: CapturedItem[] = [];
      
      for (const item of exportItems) {
        try {
          const canvas = await captureElement(item.element);
          const imgData = canvas.toDataURL("image/jpeg", 0.92);
          const imgRatio = canvas.height / canvas.width;
          const heightMm = contentWidth * imgRatio;
          
          capturedItems.push({ 
            imgData, 
            heightMm, 
            widthMm: contentWidth,
            type: item.type,
            sectionTitle: item.sectionTitle
          });
        } catch (err) {
          console.warn('Failed to capture element:', err);
        }
      }

      // Calculate total pages needed for progress display
      let totalPages = 1;
      let tempY = margin + headerHeight;
      for (const item of capturedItems) {
        const itemHeight = item.type === 'section-header' ? 8 : item.heightMm;
        if (tempY + itemHeight > pageHeight - margin - footerHeight) {
          totalPages++;
          tempY = margin + headerHeight;
        }
        tempY += itemHeight + itemGap;
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

      // Layout items across pages - NEVER split a card across pages
      let currentPage = 1;
      let currentY = margin + headerHeight;
      
      // Add first page header/footer
      addHeader(currentPage);
      addFooter();

      // Add each item to PDF
      for (const item of capturedItems) {
        // For section headers, add them as text rather than image
        if (item.type === 'section-header' && item.sectionTitle) {
          const headerHeightMm = 8;
          const spaceRemaining = pageHeight - margin - footerHeight - currentY;
          
          // If not enough space for header + some content, start new page
          if (spaceRemaining < headerHeightMm + 30) {
            pdf.addPage();
            currentPage++;
            addHeader(currentPage);
            addFooter();
            currentY = margin + headerHeight;
          }
          
          // Add section header as text
          pdf.setFontSize(12);
          pdf.setTextColor(30, 30, 30);
          pdf.text(item.sectionTitle, margin, currentY + 5);
          currentY += headerHeightMm;
          continue;
        }
        
        const spaceRemaining = pageHeight - margin - footerHeight - currentY;
        
        // Check if item fits on current page
        if (item.heightMm <= spaceRemaining - itemGap) {
          // Item fits - add it
          pdf.addImage(
            item.imgData,
            "JPEG",
            margin,
            currentY,
            contentWidth,
            item.heightMm
          );
          currentY += item.heightMm + itemGap;
        } else if (item.heightMm <= contentHeightPerPage) {
          // Item doesn't fit but will fit on a fresh page - move to new page
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
          currentY += item.heightMm + itemGap;
        } else {
          // Item is too tall for a single page - must scale it down to fit
          // This ensures NO content is cut across pages
          const scaleFactor = contentHeightPerPage / item.heightMm;
          const scaledWidth = contentWidth * scaleFactor;
          const scaledHeight = contentHeightPerPage;
          
          // Move to new page for large item
          if (currentY > margin + headerHeight + 10) {
            pdf.addPage();
            currentPage++;
            addHeader(currentPage);
            addFooter();
            currentY = margin + headerHeight;
          }
          
          // Center the scaled image horizontally
          const xOffset = margin + (contentWidth - scaledWidth) / 2;
          
          pdf.addImage(
            item.imgData,
            "JPEG",
            xOffset,
            currentY,
            scaledWidth,
            scaledHeight
          );
          currentY += scaledHeight + itemGap;
        }
      }

      // Save the PDF
      const filename = `${stationName.replace(/\s+/g, "_")}_Dashboard_Visual_${new Date().toISOString().split("T")[0]}.pdf`;
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleServerPDF} data-testid="menu-pdf-fast">
          📄 Quick PDF (Fast)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleVisualPDF} data-testid="menu-pdf-visual">
          🖼️ Visual PDF (With Charts)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
