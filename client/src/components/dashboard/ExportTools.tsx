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

  const handleScreenshot = async () => {
    setIsExporting(true);
    try {
      const element = document.getElementById(targetId);
      if (!element) {
        throw new Error("Dashboard content not found");
      }

      const canvas = await html2canvas(element, {
        backgroundColor: "#0A1929",
        scale: 2,
        logging: false,
        useCORS: true,
      });

      const link = document.createElement("a");
      link.download = `${stationName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();

      toast({
        title: "Screenshot saved",
        description: "Dashboard screenshot has been downloaded.",
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: "Could not capture screenshot.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handlePDF = async () => {
    setIsExporting(true);
    try {
      const element = document.getElementById(targetId);
      if (!element) {
        throw new Error("Dashboard content not found");
      }

      const canvas = await html2canvas(element, {
        backgroundColor: "#0A1929",
        scale: 2,
        logging: false,
        useCORS: true,
      });

      const imgData = canvas.toDataURL("image/png");
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      const pdf = new jsPDF({
        orientation: imgWidth > imgHeight ? "landscape" : "portrait",
        unit: "px",
        format: [imgWidth, imgHeight],
      });

      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
      pdf.save(`${stationName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`);

      toast({
        title: "PDF saved",
        description: "Dashboard PDF has been downloaded.",
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: "Could not generate PDF.",
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
        <DropdownMenuItem onClick={handleScreenshot} data-testid="menu-screenshot">
          Save as Image (PNG)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handlePDF} data-testid="menu-pdf">
          Save as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
