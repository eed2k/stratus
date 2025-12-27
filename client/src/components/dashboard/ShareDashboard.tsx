import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Share2, Copy, Link, Trash2, Eye, Edit, Clock, Lock, Check, ExternalLink, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface StationShare {
  id: string;
  stationId: number;
  shareToken: string;
  shareUrl: string;
  name: string;
  email?: string;
  accessLevel: 'viewer' | 'editor';
  password?: string;
  expiresAt?: string;
  isActive: boolean;
  lastAccessedAt?: string;
  accessCount: number;
  createdAt: string;
}

interface ShareDashboardProps {
  stationId: number;
  stationName: string;
}

export function ShareDashboard({ stationId, stationName }: ShareDashboardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteToken, setDeleteToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [serverAddress, setServerAddress] = useState<string>('');
  
  // Detect the server's network address
  useEffect(() => {
    // Get the current hostname - in Electron/local it might be localhost
    const hostname = window.location.hostname;
    const port = window.location.port || '5000';
    
    // If running on localhost, try to get the local network IP
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // Use the configured server address or instruct user to configure
      const savedAddress = localStorage.getItem('stratus_server_address');
      if (savedAddress) {
        setServerAddress(savedAddress);
      } else {
        // Default to showing the port for manual configuration
        setServerAddress(`[YOUR-SERVER-IP]:${port}`);
      }
    } else {
      setServerAddress(`${hostname}${port ? ':' + port : ''}`);
    }
  }, []);
  
  // Form state
  const [newShare, setNewShare] = useState({
    name: '',
    email: '',
    accessLevel: 'viewer' as 'viewer' | 'editor',
    password: '',
    expiresAt: '',
    usePassword: false,
    useExpiry: false,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing shares
  const { data: sharesData, isLoading } = useQuery({
    queryKey: ['station-shares', stationId],
    queryFn: async () => {
      const res = await fetch(`/api/stations/${stationId}/shares`);
      if (!res.ok) throw new Error('Failed to fetch shares');
      return res.json();
    },
    enabled: isOpen,
  });

  // Create share mutation
  const createShare = useMutation({
    mutationFn: async (data: typeof newShare) => {
      const res = await fetch(`/api/stations/${stationId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name || `${stationName} Dashboard`,
          email: data.email || undefined,
          accessLevel: data.accessLevel,
          password: data.usePassword && data.password ? data.password : undefined,
          expiresAt: data.useExpiry && data.expiresAt ? data.expiresAt : undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to create share');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['station-shares', stationId] });
      setShowCreateDialog(false);
      setNewShare({
        name: '',
        email: '',
        accessLevel: 'viewer',
        password: '',
        expiresAt: '',
        usePassword: false,
        useExpiry: false,
      });
      
      // Copy to clipboard with proper server address
      const protocol = window.location.protocol;
      const fullUrl = `${protocol}//${serverAddress}${data.share.shareUrl}`;
      navigator.clipboard.writeText(fullUrl);
      
      toast({
        title: "Share link created",
        description: serverAddress.includes('[YOUR-SERVER-IP]') 
          ? "Link created and copied. Configure your server address in Settings for clients to access."
          : "Your share link has been created and copied to clipboard.",
      });
      navigator.clipboard.writeText(fullUrl);
      setCopiedToken(data.share.shareToken);
      setTimeout(() => setCopiedToken(null), 3000);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create share link",
        variant: "destructive",
      });
    },
  });

  // Delete share mutation
  const deleteShare = useMutation({
    mutationFn: async (shareToken: string) => {
      const res = await fetch(`/api/shares/${shareToken}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete share');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['station-shares', stationId] });
      setDeleteToken(null);
      toast({
        title: "Share link deleted",
        description: "The share link has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete share link",
        variant: "destructive",
      });
    },
  });

  // Toggle share active status
  const toggleShareActive = useMutation({
    mutationFn: async ({ shareToken, isActive }: { shareToken: string; isActive: boolean }) => {
      const res = await fetch(`/api/shares/${shareToken}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error('Failed to update share');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['station-shares', stationId] });
    },
  });

  const copyToClipboard = (shareUrl: string, token: string) => {
    // Build a proper URL for sharing
    const protocol = window.location.protocol;
    const fullUrl = `${protocol}//${serverAddress}${shareUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 3000);
    toast({
      title: "Copied!",
      description: serverAddress.includes('[YOUR-SERVER-IP]') 
        ? "Link copied. Replace [YOUR-SERVER-IP] with your server's IP address."
        : "Share link copied to clipboard",
    });
  };

  const shares: StationShare[] = sharesData?.shares || [];

  return (
    <>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Share Dashboard
            </SheetTitle>
            <SheetDescription>
              Create share links to give clients read-only access to this weather station's dashboard.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <Button 
              className="w-full gap-2" 
              onClick={() => setShowCreateDialog(true)}
            >
              <Link className="h-4 w-4" />
              Create New Share Link
            </Button>

            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                Active Share Links ({shares.filter(s => s.isActive).length})
              </h4>
              
              {isLoading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : shares.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center text-muted-foreground">
                    <Share2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No share links yet</p>
                    <p className="text-xs mt-1">Create a share link to give clients access</p>
                  </CardContent>
                </Card>
              ) : (
                shares.map((share) => (
                  <Card key={share.id} className={!share.isActive ? 'opacity-60' : ''}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-sm font-medium flex items-center gap-2">
                            {share.name}
                            <Badge variant={share.accessLevel === 'viewer' ? 'secondary' : 'default'}>
                              {share.accessLevel === 'viewer' ? <Eye className="h-3 w-3 mr-1" /> : <Edit className="h-3 w-3 mr-1" />}
                              {share.accessLevel}
                            </Badge>
                          </CardTitle>
                          {share.email && (
                            <CardDescription className="text-xs">{share.email}</CardDescription>
                          )}
                        </div>
                        <Switch
                          checked={share.isActive}
                          onCheckedChange={(checked) => 
                            toggleShareActive.mutate({ shareToken: share.shareToken, isActive: checked })
                          }
                        />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {share.password && (
                          <span className="flex items-center gap-1">
                            <Lock className="h-3 w-3" /> Password
                          </span>
                        )}
                        {share.expiresAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> 
                            Expires {format(new Date(share.expiresAt), 'MMM d, yyyy')}
                          </span>
                        )}
                        <span>Views: {share.accessCount}</span>
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 gap-1"
                          onClick={() => copyToClipboard(share.shareUrl, share.shareToken)}
                        >
                          {copiedToken === share.shareToken ? (
                            <>
                              <Check className="h-3 w-3" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              Copy Link
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(share.shareUrl, '_blank')}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteToken(share.shareToken)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Create Share Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Share Link</DialogTitle>
            <DialogDescription>
              Generate a link to share this dashboard with clients. They will have read-only access.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="share-name">Link Name</Label>
              <Input
                id="share-name"
                placeholder={`${stationName} Dashboard`}
                value={newShare.name}
                onChange={(e) => setNewShare({ ...newShare, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                A name to identify this share link
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="share-email">Recipient Email (optional)</Label>
              <Input
                id="share-email"
                type="email"
                placeholder="client@example.com"
                value={newShare.email}
                onChange={(e) => setNewShare({ ...newShare, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="access-level">Access Level</Label>
              <Select
                value={newShare.accessLevel}
                onValueChange={(value: 'viewer' | 'editor') => 
                  setNewShare({ ...newShare, accessLevel: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Viewer (Read-only)
                    </div>
                  </SelectItem>
                  <SelectItem value="editor">
                    <div className="flex items-center gap-2">
                      <Edit className="h-4 w-4" />
                      Editor (Can modify settings)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="use-password">Password Protection</Label>
                <p className="text-xs text-muted-foreground">Require password to access</p>
              </div>
              <Switch
                id="use-password"
                checked={newShare.usePassword}
                onCheckedChange={(checked) => setNewShare({ ...newShare, usePassword: checked })}
              />
            </div>
            {newShare.usePassword && (
              <Input
                type="password"
                placeholder="Enter password"
                value={newShare.password}
                onChange={(e) => setNewShare({ ...newShare, password: e.target.value })}
              />
            )}

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="use-expiry">Expiration Date</Label>
                <p className="text-xs text-muted-foreground">Link expires after date</p>
              </div>
              <Switch
                id="use-expiry"
                checked={newShare.useExpiry}
                onCheckedChange={(checked) => setNewShare({ ...newShare, useExpiry: checked })}
              />
            </div>
            {newShare.useExpiry && (
              <Input
                type="date"
                value={newShare.expiresAt}
                onChange={(e) => setNewShare({ ...newShare, expiresAt: e.target.value })}
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => createShare.mutate(newShare)}
              disabled={createShare.isPending}
            >
              {createShare.isPending ? 'Creating...' : 'Create & Copy Link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteToken} onOpenChange={() => setDeleteToken(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Share Link?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke access for anyone using this share link.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteToken && deleteShare.mutate(deleteToken)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
