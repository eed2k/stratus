import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { authFetch, queryClient } from "@/lib/queryClient";
import { Camera, Trash2, Upload, ImageIcon } from "lucide-react";

interface StationImageUploadProps {
  stationId: number;
  currentImage?: string | null;
  stationName: string;
  onImageChange?: (image: string | null) => void;
}

export function StationImageUpload({ 
  stationId, 
  currentImage, 
  stationName,
  onImageChange 
}: StationImageUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImage || null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: async (imageData: string) => {
      const response = await authFetch(`/api/stations/${stationId}/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to upload image');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Station image uploaded successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/stations'] });
      onImageChange?.(previewUrl);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      setPreviewUrl(currentImage || null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`/api/stations/${stationId}/image`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete image');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Station image removed",
      });
      setPreviewUrl(null);
      queryClient.invalidateQueries({ queryKey: ['/api/stations'] });
      onImageChange?.(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file (PNG, JPG, GIF, or WebP)",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setPreviewUrl(base64);
      uploadMutation.mutate(base64);
      setIsUploading(false);
    };

    reader.onerror = () => {
      toast({
        title: "Error",
        description: "Failed to read file",
        variant: "destructive",
      });
      setIsUploading(false);
    };

    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    if (confirm("Are you sure you want to remove this station image?")) {
      deleteMutation.mutate();
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          <Camera className="h-5 w-5" />
          Station Image
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {previewUrl ? (
          <div className="relative">
            <img
              src={previewUrl}
              alt={`${stationName} station`}
              className="w-full h-48 object-cover rounded-lg border"
            />
            <div className="absolute top-2 right-2 flex gap-2">
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 bg-white/90 hover:bg-white"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending || isUploading}
              >
                <Upload className="h-4 w-4" />
              </Button>
              <Button
                variant="destructive"
                size="icon"
                className="h-8 w-8"
                onClick={handleRemoveImage}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="h-12 w-12 mx-auto text-gray-400 mb-2" />
            <p className="text-sm text-muted-foreground" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Click to upload station image
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              PNG, JPG, GIF, or WebP (max 5MB)
            </p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={handleFileSelect}
        />

        {(uploadMutation.isPending || isUploading) && (
          <div className="text-center text-sm text-muted-foreground">
            Uploading...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Mini version for inline display in station cards
export function StationImageDisplay({ 
  image, 
  stationName 
}: { 
  image?: string | null; 
  stationName: string;
}) {
  if (!image) return null;
  
  return (
    <div className="w-full h-32 rounded-lg overflow-hidden mb-3">
      <img
        src={image}
        alt={`${stationName} station`}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
