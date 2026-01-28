import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { getAllUsers, addUser, updateUser, deleteUser, type StoredUser } from "@/hooks/useAuth";
import { UserPlus, Trash2, User, Edit, MapPin, Loader2 } from "lucide-react";

interface WeatherStation {
  id: number;
  name: string;
  location?: string;
}

export default function UserManagement() {
  const { toast } = useToast();
  const [users, setUsers] = useState<StoredUser[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<StoredUser | null>(null);
  const [newUser, setNewUser] = useState({
    email: "",
    firstName: "",
    lastName: "",
    password: "",
    role: "user" as "admin" | "user",
    assignedStations: [] as number[],
  });

  // Fetch stations for assignment
  const { data: stations = [], isLoading: stationsLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  // Load users on mount
  useEffect(() => {
    const loadUsers = async () => {
      const fetchedUsers = await getAllUsers();
      setUsers(fetchedUsers);
    };
    loadUsers();
  }, []);

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.firstName || !newUser.password) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    // Check if user already exists
    const existingUser = users.find(u => u.email.toLowerCase() === newUser.email.toLowerCase());
    if (existingUser) {
      toast({
        title: "Error",
        description: "A user with this email already exists",
        variant: "destructive",
      });
      return;
    }

    // Send plain password to server - server will hash with bcrypt
    const user: any = {
      email: newUser.email.trim(),
      firstName: newUser.firstName.trim(),
      lastName: newUser.lastName.trim(),
      password: newUser.password, // Plain password - server will hash
      role: newUser.role,
      assignedStations: newUser.role === "user" ? newUser.assignedStations : [],
      createdAt: new Date().toISOString(),
    };

    const success = await addUser(user);
    
    if (success) {
      const fetchedUsers = await getAllUsers();
      setUsers(fetchedUsers);
      setIsAddDialogOpen(false);
      setNewUser({
        email: "",
        firstName: "",
        lastName: "",
        password: "",
        role: "user",
        assignedStations: [],
      });

      toast({
        title: "User created",
        description: `${user.firstName} ${user.lastName} has been added successfully.`,
      });
    } else {
      toast({
        title: "Error",
        description: "Failed to create user. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleEditUser = async () => {
    if (!editingUser) return;

    // Build updates object with only changed fields
    const updates: Partial<StoredUser> = {
      firstName: editingUser.firstName,
      lastName: editingUser.lastName,
      role: editingUser.role,
      assignedStations: editingUser.assignedStations,
    };
    
    // Include password if it was changed
    if (editingUser.password) {
      updates.password = editingUser.password;
    }

    const success = await updateUser(editingUser.email, updates);
    
    if (success) {
      const fetchedUsers = await getAllUsers();
      setUsers(fetchedUsers);
      setIsEditDialogOpen(false);
      setEditingUser(null);

      toast({
        title: "User updated",
        description: "User has been updated successfully.",
      });
    } else {
      toast({
        title: "Error",
        description: "Failed to update user. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteUser = async (email: string) => {
    // Don't allow deleting the main admin
    if (email.toLowerCase() === "esterhuizen2k@proton.me") {
      toast({
        title: "Cannot delete",
        description: "The primary admin account cannot be deleted.",
        variant: "destructive",
      });
      return;
    }

    const success = await deleteUser(email);
    
    if (success) {
      const fetchedUsers = await getAllUsers();
      setUsers(fetchedUsers);
      toast({
        title: "User deleted",
        description: "User has been removed successfully.",
      });
    } else {
      toast({
        title: "Error",
        description: "Failed to delete user. Please try again.",
        variant: "destructive",
      });
    }
  };

  const toggleStationAssignment = (stationId: number, isAssigning: boolean, forEdit = false) => {
    if (forEdit && editingUser) {
      const currentStations = editingUser.assignedStations || [];
      const updatedStations = isAssigning
        ? [...currentStations, stationId]
        : currentStations.filter(id => id !== stationId);
      setEditingUser({ ...editingUser, assignedStations: updatedStations });
    } else {
      const currentStations = newUser.assignedStations;
      const updatedStations = isAssigning
        ? [...currentStations, stationId]
        : currentStations.filter(id => id !== stationId);
      setNewUser({ ...newUser, assignedStations: updatedStations });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">User Management</h1>
          <p className="text-muted-foreground">
            Create and manage user accounts. Assign stations to users for limited dashboard access.
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Create a new user account. Users can only view dashboards of assigned stations.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={newUser.firstName}
                    onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={newUser.lastName}
                    onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                    placeholder="Doe"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="user@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Enter password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={newUser.role}
                  onValueChange={(value: "admin" | "user") => setNewUser({ ...newUser, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">
                      User - Limited Access
                    </SelectItem>
                    <SelectItem value="admin">
                      Admin - Full Access
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {newUser.role === "user" && (
                <div className="space-y-2">
                  <Label>Assign Stations</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Select which stations this user can view on their dashboard.
                  </p>
                  {stationsLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : stations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No stations available</p>
                  ) : (
                    <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                      {stations.map((station) => (
                        <div key={station.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`station-${station.id}`}
                            checked={newUser.assignedStations.includes(station.id)}
                            onCheckedChange={(checked) => toggleStationAssignment(station.id, !!checked)}
                          />
                          <label
                            htmlFor={`station-${station.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
                          >
                            <MapPin className="h-3 w-3 text-muted-foreground" />
                            {station.name}
                            {station.location && (
                              <span className="text-xs text-muted-foreground">({station.location})</span>
                            )}
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddUser}>Create User</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user details and station assignments.
            </DialogDescription>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-firstName">First Name</Label>
                  <Input
                    id="edit-firstName"
                    value={editingUser.firstName}
                    onChange={(e) => setEditingUser({ ...editingUser, firstName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-lastName">Last Name</Label>
                  <Input
                    id="edit-lastName"
                    value={editingUser.lastName}
                    onChange={(e) => setEditingUser({ ...editingUser, lastName: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={editingUser.email} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-role">Role</Label>
                <Select
                  value={editingUser.role}
                  onValueChange={(value: "admin" | "user") => setEditingUser({ ...editingUser, role: value })}
                  disabled={editingUser.email.toLowerCase() === "esterhuizen2k@proton.me"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {editingUser.role === "user" && (
                <div className="space-y-2">
                  <Label>Assigned Stations</Label>
                  <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                    {stations.map((station) => (
                      <div key={station.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`edit-station-${station.id}`}
                          checked={(editingUser.assignedStations || []).includes(station.id)}
                          onCheckedChange={(checked) => toggleStationAssignment(station.id, !!checked, true)}
                        />
                        <label
                          htmlFor={`edit-station-${station.id}`}
                          className="text-sm font-medium leading-none"
                        >
                          {station.name}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditUser}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Manage user accounts and their access to weather stations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No users found. Add your first user to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Assigned Stations</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.email}>
                    <TableCell className="font-medium">
                      {user.firstName} {user.lastName}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      {user.role === "admin" ? (
                        <Badge className="bg-blue-600">
                          Admin
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          User
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.role === "admin" ? (
                        <span className="text-muted-foreground">All stations</span>
                      ) : (
                        <span>
                          {(user.assignedStations || []).length === 0 ? (
                            <span className="text-muted-foreground">None assigned</span>
                          ) : (
                            `${user.assignedStations?.length} station(s)`
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingUser(user);
                            setIsEditDialogOpen(true);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteUser(user.email)}
                          disabled={user.email.toLowerCase() === "esterhuizen2k@proton.me"}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
