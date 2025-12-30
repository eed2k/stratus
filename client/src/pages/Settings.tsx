import { useState, useEffect } from "react";
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
import { User, Bell, Globe, Shield, Save, Server, Loader2 } from "lucide-react";

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

// Load settings from localStorage
const loadUserProfile = (): UserProfile => {
  const saved = localStorage.getItem('stratus_user_profile');
  return saved ? JSON.parse(saved) : { firstName: '', lastName: '', email: '' };
};

const loadNotificationSettings = (): NotificationSettings => {
  const saved = localStorage.getItem('stratus_notification_settings');
  return saved ? JSON.parse(saved) : { 
    emailNotifications: true, 
    pushNotifications: false,
    tempHighAlert: 35,
    windHighAlert: 50
  };
};

const loadUnitSettings = (): UnitSettings => {
  const saved = localStorage.getItem('stratus_unit_settings');
  return saved ? JSON.parse(saved) : { units: 'metric', timezone: 'auto' };
};

export default function Settings() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
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

  // Load all settings on mount
  useEffect(() => {
    const profile = loadUserProfile();
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setEmail(profile.email);
    
    const notifications = loadNotificationSettings();
    setEmailNotifications(notifications.emailNotifications);
    setPushNotifications(notifications.pushNotifications);
    setTempHighAlert(notifications.tempHighAlert);
    setWindHighAlert(notifications.windHighAlert);
    
    const unitPrefs = loadUnitSettings();
    setUnits(unitPrefs.units);
    setTimezone(unitPrefs.timezone);
    
    setServerAddress(localStorage.getItem('stratus_server_address') || '');
  }, []);

  // Save profile to localStorage
  const handleSaveProfile = () => {
    setIsLoading(true);
    try {
      const profile: UserProfile = { firstName, lastName, email };
      localStorage.setItem('stratus_user_profile', JSON.stringify(profile));
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

  // Save notification settings
  const handleSaveNotifications = () => {
    setIsLoading(true);
    try {
      const settings: NotificationSettings = {
        emailNotifications,
        pushNotifications,
        tempHighAlert,
        windHighAlert
      };
      localStorage.setItem('stratus_notification_settings', JSON.stringify(settings));
      toast({
        title: "Notifications Saved",
        description: "Your notification preferences have been updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save notification settings.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Save unit preferences
  const handleSaveUnits = () => {
    setIsLoading(true);
    try {
      const settings: UnitSettings = { units, timezone };
      localStorage.setItem('stratus_unit_settings', JSON.stringify(settings));
      toast({
        title: "Units Saved",
        description: "Your measurement preferences have been updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save unit preferences.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveServerAddress = () => {
    if (serverAddress.trim()) {
      localStorage.setItem('stratus_server_address', serverAddress.trim());
      toast({
        title: "Server Address Saved",
        description: "Share links will now use this address for external access.",
      });
    } else {
      localStorage.removeItem('stratus_server_address');
      toast({
        title: "Server Address Cleared",
        description: "Share links will prompt for manual configuration.",
      });
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
            <Button onClick={handleSaveNotifications} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Notifications
            </Button>
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
            <Button onClick={handleSaveServerAddress} data-testid="button-save-server">
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
              <Select value={units} onValueChange={setUnits}>
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
            <Button onClick={handleSaveUnits} disabled={isLoading}>
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
