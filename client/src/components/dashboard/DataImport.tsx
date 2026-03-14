// Stratus Weather System
// Created by Lukas Esterhuizen

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface DataImportProps {
  stationId: number;
  stationName: string;
}

interface ImportResult {
  message: string;
  format: string;
  stationName: string;
  tableName: string;
  totalRecords: number;
  importedRecords: number;
  errors: string[];
}

export function DataImport({ stationId, stationName }: DataImportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = async (file: File) => {
    setIsImporting(true);
    setResult(null);

    try {
      const content = await file.text();
      
      const response = await apiRequest("POST", `/api/stations/${stationId}/import`, {
        content,
        filename: file.name,
      });

      const data = await response.json() as ImportResult;
      setResult(data);

      if (data.importedRecords > 0) {
        toast({
          title: "Import successful",
          description: `Imported ${data.importedRecords} of ${data.totalRecords} records from ${data.format} file.`,
        });
        
        // Invalidate station data cache
        queryClient.invalidateQueries({ queryKey: ["/api/stations", stationId] });
      } else {
        toast({
          title: "No records imported",
          description: "The file was parsed but no valid weather data was found.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Import failed",
        description: error.message || "Could not import data file.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await processFile(e.target.files[0]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-import">
          Import Data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Data File</DialogTitle>
          <DialogDescription>
            Import Campbell Scientific data files (TOA5, TOB1) or CSV files into {stationName}.
          </DialogDescription>
        </DialogHeader>

        <div
          className={`
            relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
            transition-colors duration-200
            ${dragActive 
              ? "border-primary bg-primary/10" 
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }
          `}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={handleClick}
          data-testid="dropzone-import"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".dat,.csv,.txt,.toa5,.tob1"
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file"
          />
          
          {isImporting ? (
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <p className="text-sm text-muted-foreground">Importing data...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm font-medium">
                Drop file here or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Supports TOA5, TOB1, and CSV formats
              </p>
            </div>
          )}
        </div>

        {result && (
          <div className="mt-4 p-4 rounded-lg bg-muted/50">
            <h4 className="font-medium mb-2">Import Result</h4>
            <div className="text-sm space-y-1">
              <p>Format: <span className="font-mono">{result.format}</span></p>
              <p>Station: {result.stationName || "Unknown"}</p>
              <p>Table: {result.tableName || "Unknown"}</p>
              <p>Records: {result.importedRecords} / {result.totalRecords} imported</p>
              
              {result.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-destructive font-medium">Errors ({result.errors.length}):</p>
                  <ul className="list-disc list-inside text-xs text-muted-foreground max-h-24 overflow-y-auto">
                    {result.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {result.errors.length > 5 && (
                      <li>...and {result.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button 
            variant="outline" 
            onClick={() => setIsOpen(false)}
            data-testid="button-close-import"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
