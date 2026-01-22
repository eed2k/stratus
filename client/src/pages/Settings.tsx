import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { User, Bell, Globe, Shield, Save, Server, Loader2, Mail, CheckCircle, Cloud, Plus, Trash2, RefreshCw, FolderSync, Lock, Eye, EyeOff } from "lucide-react";
import { getAllUsers, addUser } from "@/hooks/useAuth";
import { verifyPassword, hashPassword } from "@/lib/passwordUtils";

// Dropbox config interface
interface DropboxConfig {
  id: number;
  name: string;
  folderPath: string;
  filePattern?: string;
  stationId?: number;
  syncInterval: number;
  enabled: boolean;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncRecords?: number;
}

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  
  // Dropbox state
  const [newConfigName, setNewConfigName] = useState('');
  const [newConfigFolder, setNewConfigFolder] = useState('');
  const [newConfigPattern, setNewConfigPattern] = useState('');
  const [newConfigInterval, setNewConfigInterval] = useState('3600000');
  const [isAddingConfig, setIsAddingConfig] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Profile state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  
  // Notification state
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [tempHighAlert, setTempHighAlert] = useState(35);
  const [windHighAlert, setWindHighAlert] = useState(50);
  
  // Units state
  const [units, setUnits] = useState<"metric" | "imperial">("metric");
  const [timezone, setTimezone] = useState("auto");
  
  // Server state
  const [serverAddress, setServerAddress] = useState('');
  
  // Dropbox credentials state (for admin configuration)
  const [dropboxAppKey, setDropboxAppKey] = useState('');
  const [dropboxAppSecret, setDropboxAppSecret] = useState('');
  const [dropboxRefreshToken, setDropboxRefreshToken] = useState('');
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  
  // Password change state
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  // Delete account state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Fetch Dropbox configs from server
  const { data: dropboxConfigs, refetch: refetchDropboxConfigs } = useQuery<DropboxConfig[]>({
    queryKey: ['/api/dropbox-sync/configs'],
    queryFn: async () => {
      const res = await fetch('/api/dropbox-sync/configs');
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch Dropbox credentials status
  const { data: dropboxCredentials } = useQuery({
    queryKey: ['/api/dropbox-sync/credentials'],
    queryFn: async () => {
      const res = await fetch('/api/dropbox-sync/credentials');
      if (!res.ok) return { configured: false };
      return res.json();
    },
  });

  // Fetch available Dropbox files
  const { data: dropboxFiles, refetch: refetchDropboxFiles, isLoading: isLoadingFiles } = useQuery<{ name: string; path: string; modified: string; size: number }[]>({
    queryKey: ['/api/dropbox-sync/files'],
    queryFn: async () => {
      const res = await fetch('/api/dropbox-sync/files');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!dropboxCredentials?.configured,
  });

  // Fetch user profile from server
  const { data: userProfile } = useQuery({
    queryKey: ['/api/auth/user'],
    queryFn: async () => {
      const res = await fetch('/api/auth/user');
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Fetch preferences from server
  const { data: preferences } = useQuery({
    queryKey: ['/api/user/preferences'],
    queryFn: async () => {
      const res = await fetch('/api/user/preferences');
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Fetch email status
  const { data: emailStatus } = useQuery({
    queryKey: ['/api/email/status'],
    queryFn: async () => {
      const res = await fetch('/api/email/status');
      if (!res.ok) return { configured: false };
      return res.json();
    },
  });

  // Load profile from server when data arrives
  useEffect(() => {
    if (userProfile) {
      setFirstName(userProfile.firstName || '');
      setLastName(userProfile.lastName || '');
      setEmail(userProfile.email || '');
    }
  }, [userProfile]);

  // Load preferences from server when data arrives
  useEffect(() => {
    if (preferences) {
      setEmailNotifications(preferences.emailNotifications ?? true);
      setPushNotifications(preferences.pushNotifications ?? false);
      setTempHighAlert(preferences.tempHighAlert ?? 35);
      setWindHighAlert(preferences.windHighAlert ?? 50);
      setUnits(preferences.units ?? 'metric');
      setTimezone(preferences.timezone ?? 'auto');
      setServerAddress(preferences.serverAddress ?? '');
    }
  }, [preferences]);

  // Dropbox handlers
  const handleAddDropboxConfig = async () => {
    if (!newConfigName || !newConfigFolder) {
      toast({
        title: "Error",
        description: "Name and folder path are required",
        variant: "destructive",
      });
      return;
    }

    setIsAddingConfig(true);
    try {
      const res = await fetch('/api/dropbox-sync/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newConfigName,
          folderPath: newConfigFolder.startsWith('/') ? newConfigFolder : `/${newConfigFolder}`,
          filePattern: newConfigPattern || undefined,
          syncInterval: parseInt(newConfigInterval),
          enabled: true,
        }),
      });

      if (!res.ok) throw new Error('Failed to add configuration');

      toast({
        title: "Success",
        description: `Added sync configuration for ${newConfigName}`,
      });

      setNewConfigName('');
      setNewConfigFolder('');
      setNewConfigPattern('');
      refetchDropboxConfigs();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add configuration",
        variant: "destructive",
      });
    } finally {
      setIsAddingConfig(false);
    }
  };

  const handleDeleteDropboxConfig = async (id: number, name: string) => {
    if (!confirm(`Delete sync configuration for "${name}"?`)) return;

    try {
      const res = await fetch(`/api/dropbox-sync/configs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');

      toast({
        title: "Deleted",
        description: `Removed sync configuration for ${name}`,
      });
      refetchDropboxConfigs();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete configuration",
        variant: "destructive",
      });
    }
  };

  const handleToggleDropboxConfig = async (id: number, enabled: boolean) => {
    try {
      const res = await fetch(`/api/dropbox-sync/configs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to update');
      refetchDropboxConfigs();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update configuration",
        variant: "destructive",
      });
    }
  };

  const handleTriggerSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/dropbox-sync/sync', { method: 'POST' });
      const result = await res.json();

      if (result.success) {
        toast({
          title: "Sync Complete",
          description: `Processed ${result.filesProcessed} files, imported ${result.recordsImported} records`,
        });
      } else {
        throw new Error(result.error || 'Sync failed');
      }
      refetchDropboxConfigs();
    } catch (error: any) {
      toast({
        title: "Sync Error",
        description: error.message || "Failed to sync",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Save Dropbox credentials
  const handleSaveDropboxCredentials = async () => {
    if (!dropboxAppKey || !dropboxAppSecret || !dropboxRefreshToken) {
      toast({
        title: "Error",
        description: "All Dropbox credentials are required",
        variant: "destructive",
      });
      return;
    }

    setIsSavingCredentials(true);
    try {
      const res = await fetch('/api/dropbox-sync/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appKey: dropboxAppKey,
          appSecret: dropboxAppSecret,
          refreshToken: dropboxRefreshToken,
        }),
      });

      const result = await res.json();

      if (result.success) {
        toast({
          title: "Success",
          description: "Dropbox credentials configured successfully. Connection test passed.",
        });
        // Clear the form
        setDropboxAppKey('');
        setDropboxAppSecret('');
        setDropboxRefreshToken('');
        // Refresh the credentials status
        queryClient.invalidateQueries({ queryKey: ['/api/dropbox-sync/credentials'] });
      } else {
        throw new Error(result.error || 'Failed to save credentials');
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save Dropbox credentials",
        variant: "destructive",
      });
    } finally {
      setIsSavingCredentials(false);
    }
  };

  // Save profile to server
  const handleSaveProfile = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email }),
      });
      
      if (!res.ok) throw new Error('Failed to save');
      
      // Also save to localStorage for offline access
      localStorage.setItem('stratus_user_profile', JSON.stringify({ firstName, lastName, email }));
      
      // Invalidate query to refresh
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      
      toast({
        title: "Profile Saved",
        description: "Your profile information has been saved successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Save notification and unit settings to server
  const handleSavePreferences = async (section: 'notifications' | 'units' | 'server') => {
    setIsLoading(true);
    try {
      const prefsToSave: any = {};
      
      if (section === 'notifications') {
        prefsToSave.emailNotifications = emailNotifications;
        prefsToSave.pushNotifications = pushNotifications;
        prefsToSave.tempHighAlert = tempHighAlert;
        prefsToSave.windHighAlert = windHighAlert;
      } else if (section === 'units') {
        prefsToSave.units = units;
        prefsToSave.timezone = timezone;
      } else if (section === 'server') {
        prefsToSave.serverAddress = serverAddress;
      }
      
      const res = await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefsToSave),
      });
      
      if (!res.ok) throw new Error('Failed to save');
      
      // Also save to localStorage for offline access
      const localKey = section === 'notifications' ? 'stratus_notification_settings' 
        : section === 'units' ? 'stratus_unit_settings' 
        : 'stratus_server_address';
      
      if (section === 'server') {
        localStorage.setItem(localKey, serverAddress);
      } else {
        localStorage.setItem(localKey, JSON.stringify(prefsToSave));
      }
      
      // Invalidate query to refresh
      queryClient.invalidateQueries({ queryKey: ['/api/user/preferences'] });
      
      const sectionNames = {
        notifications: 'Notification settings',
        units: 'Unit preferences',
        server: 'Server address'
      };
      
      toast({
        title: "Settings Saved",
        description: `${sectionNames[section]} have been updated.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Send test email
  const handleSendTestEmail = async () => {
    if (!testEmailAddress || !testEmailAddress.includes('@')) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }
    
    setIsSendingTest(true);
    try {
      const res = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmailAddress }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        toast({
          title: "Test Email Sent",
          description: `A test email has been sent to ${testEmailAddress}`,
        });
      } else {
        toast({
          title: "Email Failed",
          description: data.message || "Could not send test email.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send test email.",
        variant: "destructive",
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  // Password change handler
  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: "Password Mismatch",
        description: "New password and confirmation do not match.",
        variant: "destructive",
      });
      return;
    }
    
    if (newPassword.length < 8) {
      toast({
        title: "Password Too Short",
        description: "Password must be at least 8 characters long.",
        variant: "destructive",
      });
      return;
    }
    
    setIsChangingPassword(true);
    try {
      // Find current user in storage
      const users = getAllUsers();
      const currentUserEmail = email || userProfile?.email;
      const currentUserData = users.find(u => u.email.toLowerCase() === currentUserEmail?.toLowerCase());
      
      if (!currentUserData) {
        toast({
          title: "Error",
          description: "User not found. Please log in again.",
          variant: "destructive",
        });
        return;
      }

      // Verify current password
      const isValid = await verifyPassword(currentPassword, currentUserData.passwordHash || "");
      if (!isValid) {
        toast({
          title: "Invalid Password",
          description: "Current password is incorrect.",
          variant: "destructive",
        });
        return;
      }

      // Update password with secure hash
      const newHash = await hashPassword(newPassword);
      const updatedUser = {
        ...currentUserData,
        passwordHash: newHash,
      };
      addUser(updatedUser);

      toast({
        title: "Password Changed",
        description: "Your password has been updated successfully.",
      });
      setShowPasswordDialog(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to change password.",
        variant: "destructive",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Delete account handler
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      toast({
        title: "Confirmation Required",
        description: "Please type DELETE to confirm account deletion.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      const res = await fetch('/api/auth/delete-account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (res.ok) {
        toast({
          title: "Account Deleted",
          description: "Your account has been permanently deleted.",
        });
        // Redirect to login
        window.location.href = '/';
      } else {
        const data = await res.json();
        toast({
          title: "Failed",
          description: data.message || "Could not delete account.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete account.",
        variant: "destructive",
      });
    }
  };

  // Utility function for features not yet implemented
  const _showComingSoon = (feature: string) => {
    toast({
      title: "Coming Soon",
      description: `${feature} will be available in a future update.`,
    });
  };
  // Suppress unused warning
  void _showComingSoon;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and application preferences
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-profile-settings">
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Profile</CardTitle>
            </div>
            <CardDescription>Update your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input 
                  id="firstName" 
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Enter your first name"
                  data-testid="input-first-name" 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input 
                  id="lastName" 
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Enter your last name"
                  data-testid="input-last-name" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                data-testid="input-settings-email" 
              />
            </div>
            <Button data-testid="button-save-profile" onClick={handleSaveProfile} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Profile
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-notifications-settings">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Notifications</CardTitle>
            </div>
            <CardDescription>Configure how you receive alerts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-muted-foreground">Receive alerts via email</p>
              </div>
              <Switch
                checked={emailNotifications}
                onCheckedChange={setEmailNotifications}
                data-testid="switch-email-notifications"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Push Notifications</p>
                <p className="text-sm text-muted-foreground">Receive browser notifications</p>
              </div>
              <Switch
                checked={pushNotifications}
                onCheckedChange={setPushNotifications}
                data-testid="switch-push-notifications"
              />
            </div>
            <Separator />
            <div className="space-y-4">
              <p className="font-medium">Alert Thresholds</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tempHigh">High Temp Alert (°C)</Label>
                  <Input 
                    id="tempHigh" 
                    type="number" 
                    value={tempHighAlert}
                    onChange={(e) => setTempHighAlert(Number(e.target.value))}
                    data-testid="input-temp-high" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="windHigh">High Wind Alert (km/h)</Label>
                  <Input 
                    id="windHigh" 
                    type="number" 
                    value={windHighAlert}
                    onChange={(e) => setWindHighAlert(Number(e.target.value))}
                    data-testid="input-wind-high" 
                  />
                </div>
              </div>
            </div>
            <Button onClick={() => handleSavePreferences('notifications')} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Notifications
            </Button>
          </CardContent>
        </Card>

        {/* Email Configuration Card */}
        <Card data-testid="card-email-settings">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Email Alerts</CardTitle>
            </div>
            <CardDescription>Configure email notifications for alarms</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-2">
              {emailStatus?.configured ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-sm text-green-600 font-medium">Email service configured</span>
                </>
              ) : (
                <>
                  <div className="h-3 w-3 rounded-full bg-yellow-500" />
                  <span className="text-sm text-muted-foreground">Email service not configured</span>
                </>
              )}
            </div>
            
            {!emailStatus?.configured && (
              <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm">
                <p className="text-yellow-800 dark:text-yellow-200">
                  To enable email alerts, set <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">SENDGRID_API_KEY</code> and{' '}
                  <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">SENDGRID_FROM_EMAIL</code> in your environment variables.
                </p>
              </div>
            )}
            
            {emailStatus?.configured && (
              <div className="space-y-3">
                <Label htmlFor="testEmail">Send Test Email</Label>
                <div className="flex gap-2">
                  <Input
                    id="testEmail"
                    type="email"
                    placeholder="your@email.com"
                    value={testEmailAddress}
                    onChange={(e) => setTestEmailAddress(e.target.value)}
                    data-testid="input-test-email"
                  />
                  <Button 
                    onClick={handleSendTestEmail} 
                    disabled={isSendingTest}
                    variant="outline"
                  >
                    {isSendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Test'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Test your email configuration by sending a sample alert.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-server-settings">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Server & Sharing</CardTitle>
            </div>
            <CardDescription>Configure server address for sharing dashboards</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="serverAddress">Server Address</Label>
              <Input
                id="serverAddress"
                placeholder="e.g., 192.168.1.100:5000 or your-domain.com"
                value={serverAddress}
                onChange={(e) => setServerAddress(e.target.value)}
                data-testid="input-server-address"
              />
              <p className="text-xs text-muted-foreground">
                Enter your server's IP address or domain name. This is used when sharing
                dashboard links with clients so they can access the dashboard remotely.
              </p>
            </div>
            <Button onClick={() => handleSavePreferences('server')} data-testid="button-save-server">
              <Save className="mr-2 h-4 w-4" />
              Save Server Address
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-units-settings">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Units & Locale</CardTitle>
            </div>
            <CardDescription>Set measurement units and timezone</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Measurement Units</Label>
              <Select value={units} onValueChange={(v) => setUnits(v as "metric" | "imperial")}>
                <SelectTrigger data-testid="select-units">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="metric">Metric (°C, km/h, mm)</SelectItem>
                  <SelectItem value="imperial">Imperial (°F, mph, in)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger data-testid="select-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="Africa/Johannesburg">Africa/Johannesburg (SAST)</SelectItem>
                  <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                  <SelectItem value="America/New_York">America/New York (EST)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => handleSavePreferences('units')} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Preferences
            </Button>
          </CardContent>
        </Card>

        {/* Dropbox Sync Configuration Card */}
        <Card className="lg:col-span-2" data-testid="card-dropbox-settings">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Dropbox Sync</CardTitle>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleTriggerSync}
                disabled={isSyncing || !dropboxCredentials?.configured}
              >
                {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sync Now
              </Button>
            </div>
            <CardDescription>
              Configure automatic data import from Dropbox folders (LoggerNet uploads)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!dropboxCredentials?.configured ? (
              <div className="space-y-4">
                <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4 text-sm">
                  <p className="text-yellow-800 dark:text-yellow-200 font-medium">Dropbox Not Configured</p>
                  <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                    Enter your Dropbox API credentials below to enable automatic data sync.
                  </p>
                </div>
                
                <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                  <p className="text-sm font-medium">Configure Dropbox API Credentials</p>
                  <p className="text-xs text-muted-foreground">
                    To get these credentials, create an app at{' '}
                    <a 
                      href="https://www.dropbox.com/developers/apps" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      dropbox.com/developers/apps
                    </a>
                    {' '}and generate a refresh token using the OAuth 2.0 flow.
                  </p>
                  
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="dropboxAppKey" className="text-xs">App Key</Label>
                      <Input
                        id="dropboxAppKey"
                        type="text"
                        placeholder="Your Dropbox App Key"
                        value={dropboxAppKey}
                        onChange={(e) => setDropboxAppKey(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dropboxAppSecret" className="text-xs">App Secret</Label>
                      <Input
                        id="dropboxAppSecret"
                        type="password"
                        placeholder="Your Dropbox App Secret"
                        value={dropboxAppSecret}
                        onChange={(e) => setDropboxAppSecret(e.target.value)}
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="dropboxRefreshToken" className="text-xs">Refresh Token</Label>
                    <Input
                      id="dropboxRefreshToken"
                      type="password"
                      placeholder="Your Dropbox Refresh Token (for long-lived access)"
                      value={dropboxRefreshToken}
                      onChange={(e) => setDropboxRefreshToken(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Refresh tokens allow Stratus to maintain access without re-authentication.
                    </p>
                  </div>
                  
                  <Button onClick={handleSaveDropboxCredentials} disabled={isSavingCredentials}>
                    {isSavingCredentials ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save & Test Credentials
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Available files browser */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Available Data Files in Dropbox</Label>
                    <Button variant="ghost" size="sm" onClick={() => refetchDropboxFiles()} disabled={isLoadingFiles}>
                      {isLoadingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-md border p-2 text-sm">
                    {dropboxFiles && dropboxFiles.length > 0 ? (
                      <ul className="space-y-1">
                        {dropboxFiles.map((file) => (
                          <li key={file.path} className="flex items-center justify-between hover:bg-muted/50 p-1 rounded">
                            <span className="font-mono text-xs truncate">{file.path}</span>
                            <span className="text-xs text-muted-foreground ml-2">{(file.size / 1024).toFixed(0)} KB</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-center py-2">No .dat files found</p>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Existing configs */}
                <div className="space-y-3">
                  <Label>Sync Configurations</Label>
                  {dropboxConfigs && dropboxConfigs.length > 0 ? (
                    <div className="space-y-2">
                      {dropboxConfigs.map((config) => (
                        <div key={config.id} className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <FolderSync className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{config.name}</span>
                              {config.enabled ? (
                                <span className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-0.5 rounded">Active</span>
                              ) : (
                                <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">Disabled</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Folder: <code className="bg-muted px-1 rounded">{config.folderPath}</code>
                              {config.filePattern && <> • Pattern: <code className="bg-muted px-1 rounded">{config.filePattern}</code></>}
                            </p>
                            {config.lastSyncAt && (
                              <p className="text-xs text-muted-foreground">
                                Last sync: {new Date(config.lastSyncAt).toLocaleString('en-ZA', { 
                                  year: 'numeric', 
                                  month: 'short', 
                                  day: 'numeric',
                                  hour: '2-digit', 
                                  minute: '2-digit',
                                  timeZoneName: 'short'
                                })} 
                                {config.lastSyncStatus && ` (${config.lastSyncStatus})`}
                                {config.lastSyncRecords !== undefined && ` - ${config.lastSyncRecords} records`}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={config.enabled}
                              onCheckedChange={(enabled) => handleToggleDropboxConfig(config.id, enabled)}
                            />
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteDropboxConfig(config.id, config.name)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No sync configurations yet. Add one below.</p>
                  )}
                </div>

                <Separator />

                {/* Add new config */}
                <div className="space-y-4">
                  <Label>Add New Sync Configuration</Label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="newConfigName" className="text-xs">Name (e.g., station name)</Label>
                      <Input
                        id="newConfigName"
                        placeholder="KWAGGASKLIP"
                        value={newConfigName}
                        onChange={(e) => setNewConfigName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="newConfigFolder" className="text-xs">Folder Path</Label>
                      <Input
                        id="newConfigFolder"
                        placeholder="/KWAGGASKLIP or /"
                        value={newConfigFolder}
                        onChange={(e) => setNewConfigFolder(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="newConfigPattern" className="text-xs">File Pattern (optional)</Label>
                      <Input
                        id="newConfigPattern"
                        placeholder="*Table1* or KWAGGAS*"
                        value={newConfigPattern}
                        onChange={(e) => setNewConfigPattern(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="newConfigInterval" className="text-xs">Sync Interval</Label>
                      <Select value={newConfigInterval} onValueChange={setNewConfigInterval}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="300000">5 minutes</SelectItem>
                          <SelectItem value="600000">10 minutes</SelectItem>
                          <SelectItem value="1800000">30 minutes</SelectItem>
                          <SelectItem value="3600000">1 hour</SelectItem>
                          <SelectItem value="7200000">2 hours</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={handleAddDropboxConfig} disabled={isAddingConfig}>
                    {isAddingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Add Configuration
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2" data-testid="card-security-settings">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Security</CardTitle>
            </div>
            <CardDescription>Manage your account security</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Password</p>
                <p className="text-sm text-muted-foreground">Change your account password</p>
              </div>
              <Button variant="outline" data-testid="button-change-password" onClick={() => setShowPasswordDialog(true)}>
                <Lock className="mr-2 h-4 w-4" />
                Change Password
              </Button>
            </div>
            <Separator />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-destructive">Delete Account</p>
                <p className="text-sm text-muted-foreground">Permanently delete your account and data</p>
              </div>
              <Button variant="destructive" data-testid="button-delete-account" onClick={() => setShowDeleteDialog(true)}>
                Delete Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Password Change Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>Cancel</Button>
            <Button onClick={handleChangePassword} disabled={isChangingPassword}>
              {isChangingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Change Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Delete Account Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Account</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete your account and all associated data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Type <strong>DELETE</strong> to confirm:
            </p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button 
              variant="destructive" 
              onClick={handleDeleteAccount}
              disabled={deleteConfirmText !== 'DELETE'}
            >
              Delete My Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
