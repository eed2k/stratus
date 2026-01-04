import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { User, Bell, Globe, Shield, Save, Server, Loader2, Mail, CheckCircle } from "lucide-react";

// User profile settings interface
interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
}

// Notification settings interface
interface NotificationSettings {
  emailNotifications: boolean;
  pushNotifications: boolean;
  tempHighAlert: number;
  windHighAlert: number;
}

// Unit settings interface
interface UnitSettings {
  units: "metric" | "imperial";
  timezone: string;
}

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  
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

  const showComingSoon = (feature: string) => {
    toast({
      title: "Coming Soon",
      description: `${feature} will be available in a future update.`,
    });
  };

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
                <p className="text-sm text-muted-foreground">Last changed 30 days ago</p>
              </div>
              <Button variant="outline" data-testid="button-change-password" onClick={() => showComingSoon("Password change")}>
                Change Password
              </Button>
            </div>
            <Separator />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Two-Factor Authentication</p>
                <p className="text-sm text-muted-foreground">Add an extra layer of security</p>
              </div>
              <Button variant="outline" data-testid="button-enable-2fa" onClick={() => showComingSoon("Two-Factor Authentication")}>
                Enable 2FA
              </Button>
            </div>
            <Separator />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-destructive">Delete Account</p>
                <p className="text-sm text-muted-foreground">Permanently delete your account and data</p>
              </div>
              <Button variant="destructive" data-testid="button-delete-account" onClick={() => showComingSoon("Account deletion")}>
                Delete Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
