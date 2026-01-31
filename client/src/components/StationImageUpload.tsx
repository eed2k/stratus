import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { authFetch, queryClient } from "@/lib/queryClient";
import { Camera, Trash2, Upload, ImageIcon, ZoomIn, ZoomOut, RotateCw, Check } from "lucide-react";

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
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [scale, setScale] = useState(100);
  const [rotation, setRotation] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();

  // Process image with scale and rotation, maintaining aspect ratio
  const processImage = useCallback((imageSrc: string, targetScale: number, targetRotation: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Calculate scaled dimensions maintaining aspect ratio
        const scaleFactor = targetScale / 100;
        let width = img.width * scaleFactor;
        let height = img.height * scaleFactor;

        // Limit max dimensions to 1200px while maintaining aspect ratio
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width *= ratio;
          height *= ratio;
        }

        // For rotation, we may need to swap dimensions
        const needsSwap = targetRotation === 90 || targetRotation === 270;
        canvas.width = needsSwap ? height : width;
        canvas.height = needsSwap ? width : height;

        // Clear and setup
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Translate to center, rotate, then draw
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((targetRotation * Math.PI) / 180);
        ctx.drawImage(img, -width / 2, -height / 2, width, height);

        // Convert to base64
        const result = canvas.toDataURL('image/jpeg', 0.85);
        resolve(result);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageSrc;
    });
  }, []);

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
      setIsEditing(false);
      setOriginalImage(null);
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
      setOriginalImage(null);
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

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

    // Validate file size (10MB max for original, will be compressed)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image smaller than 10MB",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setOriginalImage(base64);
      setPreviewUrl(base64);
      setScale(100);
      setRotation(0);
      setIsEditing(true);
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
    // Reset file input
    event.target.value = '';
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleSaveImage = async () => {
    if (!originalImage) return;
    
    setIsUploading(true);
    try {
      const processedImage = await processImage(originalImage, scale, rotation);
      setPreviewUrl(processedImage);
      uploadMutation.mutate(processedImage);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process image",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setOriginalImage(null);
    setPreviewUrl(currentImage || null);
    setScale(100);
    setRotation(0);
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
        {/* Hidden canvas for image processing */}
        <canvas ref={canvasRef} className="hidden" />

        {isEditing && originalImage ? (
          // Editing mode with preview and controls
          <div className="space-y-4">
            <div className="relative border rounded-lg overflow-hidden bg-gray-100" style={{ minHeight: '200px' }}>
              <img
                src={originalImage}
                alt={`${stationName} station preview`}
                className="w-full h-auto max-h-64 object-contain mx-auto"
                style={{
                  transform: `scale(${scale / 100}) rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.2s ease'
                }}
              />
            </div>

            {/* Image adjustment controls */}
            <div className="space-y-4 p-3 bg-muted/50 rounded-lg">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <ZoomOut className="h-4 w-4" />
                    Size
                    <ZoomIn className="h-4 w-4" />
                  </Label>
                  <span className="text-sm text-muted-foreground">{scale}%</span>
                </div>
                <Slider
                  value={[scale]}
                  onValueChange={([value]) => setScale(value)}
                  min={25}
                  max={100}
                  step={5}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Adjust size while maintaining aspect ratio
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRotate}
                  className="flex-1"
                >
                  <RotateCw className="h-4 w-4 mr-2" />
                  Rotate 90°
                </Button>
                <span className="text-sm text-muted-foreground">
                  {rotation}°
                </span>
              </div>
            </div>

            {/* Save / Cancel buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleCancelEdit}
                disabled={uploadMutation.isPending || isUploading}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleSaveImage}
                disabled={uploadMutation.isPending || isUploading}
              >
                {(uploadMutation.isPending || isUploading) ? (
                  <>
                    <span className="animate-spin mr-2">⏳</span>
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Save Image
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : previewUrl ? (
          // Display current image
          <div className="relative">
            <img
              src={previewUrl}
              alt={`${stationName} station`}
              className="w-full h-48 object-contain rounded-lg border bg-gray-50"
            />
            <div className="absolute top-2 right-2 flex gap-2">
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 bg-white/90 hover:bg-white"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending || isUploading}
                title="Upload new image"
              >
                <Upload className="h-4 w-4" />
              </Button>
              <Button
                variant="destructive"
                size="icon"
                className="h-8 w-8"
                onClick={handleRemoveImage}
                disabled={deleteMutation.isPending}
                title="Remove image"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          // Empty state - upload prompt
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="h-12 w-12 mx-auto text-gray-400 mb-2" />
            <p className="text-sm text-muted-foreground" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Click to upload station image
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              PNG, JPG, GIF, or WebP (max 10MB)
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              You can adjust size after selecting
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

        {(uploadMutation.isPending || isUploading) && !isEditing && (
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
    <div className="w-full h-48 rounded-t-lg overflow-hidden bg-muted/30 flex items-center justify-center">
      <img
        src={image}
        alt={`${stationName} station`}
        className="w-full h-full object-contain"
      />
    </div>
  );
}
