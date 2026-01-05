import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  FileText, 
  Download, 
  BookOpen, 
  Settings2, 
  ExternalLink,
  CloudSun,
  FileCode,
  Server
} from "lucide-react";

interface DocInfo {
  id: string;
  name: string;
  filename: string;
  description: string;
  available: boolean;
  size: number;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function Documentation() {
  const { data: docs, isLoading, error } = useQuery<DocInfo[]>({
    queryKey: ['/api/docs'],
    queryFn: async () => {
      const res = await fetch('/api/docs');
      if (!res.ok) throw new Error('Failed to load documentation');
      return res.json();
    },
  });

  const handleDownload = async (docId: string, filename: string) => {
    try {
      const response = await fetch(`/api/docs/${docId}/download`);
      if (!response.ok) {
        const error = await response.json();
        alert(error.message || 'Download failed');
        return;
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download document');
    }
  };

  const getDocIcon = (docId: string) => {
    switch (docId) {
      case 'readme':
        return <CloudSun className="h-8 w-8 text-blue-500" />;
      case 'station-setup':
        return <Settings2 className="h-8 w-8 text-green-500" />;
      default:
        return <FileText className="h-8 w-8 text-gray-500" />;
    }
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <BookOpen className="h-8 w-8 text-primary" />
          Documentation
        </h1>
        <p className="text-muted-foreground mt-2">
          Download user guides and documentation for Stratus Weather Server
        </p>
      </div>

      <div className="grid gap-6">
        {/* PDF Documentation Downloads */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              PDF Downloads
            </CardTitle>
            <CardDescription>
              Downloadable PDF documentation for offline reference
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="text-center py-8 text-muted-foreground">
                Loading documentation...
              </div>
            )}
            
            {error && (
              <div className="text-center py-8 text-destructive">
                Failed to load documentation list
              </div>
            )}
            
            {docs && (
              <div className="grid gap-4">
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      {getDocIcon(doc.id)}
                      <div>
                        <h3 className="font-semibold">{doc.name}</h3>
                        <p className="text-sm text-muted-foreground">{doc.description}</p>
                        {doc.available && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatFileSize(doc.size)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.available ? (
                        <Button 
                          onClick={() => handleDownload(doc.id, doc.filename)}
                          className="flex items-center gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download PDF
                        </Button>
                      ) : (
                        <Badge variant="secondary">Not Generated</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ExternalLink className="h-5 w-5" />
              Quick Reference
            </CardTitle>
            <CardDescription>
              Additional resources and quick links
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <a 
                href="https://campbellsci.com/support" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <Server className="h-6 w-6 text-orange-500" />
                <div>
                  <h4 className="font-medium">Campbell Scientific Support</h4>
                  <p className="text-sm text-muted-foreground">Official datalogger documentation</p>
                </div>
              </a>
              
              <a 
                href="https://github.com/yourusername/stratus" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <FileCode className="h-6 w-6 text-purple-500" />
                <div>
                  <h4 className="font-medium">GitHub Repository</h4>
                  <p className="text-sm text-muted-foreground">Source code and issue tracker</p>
                </div>
              </a>
            </div>
          </CardContent>
        </Card>

        {/* Version Info */}
        <Card>
          <CardHeader>
            <CardTitle>About Stratus Weather Server</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-medium">1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Developer</span>
                <span className="font-medium">Lukas Esterhuizen</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Contact</span>
                <a href="mailto:esterhuizen2k@proton.me" className="font-medium text-primary hover:underline">
                  esterhuizen2k@proton.me
                </a>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">License</span>
                <span className="font-medium">MIT</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
