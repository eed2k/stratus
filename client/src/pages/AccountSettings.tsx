import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth, getAllUsers, addUser } from "@/hooks/useAuth";
import { User, Lock, CheckCircle } from "lucide-react";
import { hashPassword, verifyPassword } from "@/lib/passwordUtils";

export default function AccountSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [_isSubmitting, setIsSubmitting] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChangePassword = async () => {
    setError(null);
    setSuccess(false);
    setIsSubmitting(true);

    try {
      if (!passwordData.currentPassword) {
        setError("Current password is required");
        return;
      }
      if (passwordData.newPassword.length < 8) {
        setError("New password must be at least 8 characters");
        return;
      }
      if (passwordData.newPassword !== passwordData.confirmPassword) {
        setError("New passwords do not match");
        return;
      }

      // Find current user in storage
      const users = getAllUsers();
      const currentUser = users.find(u => u.email.toLowerCase() === user?.email?.toLowerCase());
      
      if (!currentUser) {
        setError("User not found");
        return;
      }

      // Verify current password (async)
      const isValid = await verifyPassword(passwordData.currentPassword, currentUser.passwordHash || "");
      if (!isValid) {
        setError("Current password is incorrect");
        return;
      }

      // Update password with secure hash
      const newHash = await hashPassword(passwordData.newPassword);
      const updatedUser = {
        ...currentUser,
        passwordHash: newHash,
      };
      addUser(updatedUser);

      setSuccess(true);
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setIsChangingPassword(false);

      toast({
        title: "Password changed",
        description: "Your password has been updated successfully.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Account Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences.
        </p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Information
          </CardTitle>
          <CardDescription>
            Your account details.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input value={user?.firstName || ""} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input value={user?.lastName || ""} disabled className="bg-muted" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email || ""} disabled className="bg-muted" />
          </div>
          <p className="text-xs text-muted-foreground">
            Contact your administrator to update your profile information.
          </p>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Change Password
          </CardTitle>
          <CardDescription>
            Update your account password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isChangingPassword ? (
            <Button onClick={() => setIsChangingPassword(true)}>
              Change Password
            </Button>
          ) : (
            <div className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {success && (
                <Alert className="border-green-500 bg-green-50">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <AlertDescription className="text-green-700">
                    Password changed successfully!
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={passwordData.currentPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                  placeholder="Enter current password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  placeholder="Enter new password (min 8 characters)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  placeholder="Confirm new password"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => {
                  setIsChangingPassword(false);
                  setError(null);
                  setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
                }}>
                  Cancel
                </Button>
                <Button onClick={handleChangePassword}>
                  Update Password
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Access Info */}
      <Card>
        <CardHeader>
          <CardTitle>Your Access</CardTitle>
          <CardDescription>
            Information about your dashboard access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium">Role:</span>{" "}
              <span className="text-muted-foreground">
                {user?.role === "admin" ? "Administrator" : "User"}
              </span>
            </p>
            {user?.role === "user" && (
              <p>
                <span className="font-medium">Assigned Stations:</span>{" "}
                <span className="text-muted-foreground">
                  {user?.assignedStations?.length || 0} station(s)
                </span>
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-4">
              {user?.role === "user" 
                ? "You can view dashboards for stations assigned to you by the administrator."
                : "You have full access to all stations and settings."
              }
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
