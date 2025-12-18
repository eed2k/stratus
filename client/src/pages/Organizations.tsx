import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Users, Mail, Plus, UserPlus, Copy, Check, Loader2, Crown, Shield, Eye, Trash2 } from "lucide-react";
import type { Organization, OrganizationMember, OrganizationInvitation, User } from "@shared/schema";

export default function Organizations() {
  const { toast } = useToast();
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgDescription, setNewOrgDescription] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const { data: organizations, isLoading: orgsLoading } = useQuery<Organization[]>({
    queryKey: ["/api/organizations"],
  });

  const { data: members, isLoading: membersLoading } = useQuery<(OrganizationMember & { user: User })[]>({
    queryKey: ["/api/organizations", selectedOrg?.id, "members"],
    enabled: !!selectedOrg,
  });

  const { data: invitations, isLoading: invitationsLoading } = useQuery<OrganizationInvitation[]>({
    queryKey: ["/api/organizations", selectedOrg?.id, "invitations"],
    enabled: !!selectedOrg,
  });

  const createOrgMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      return apiRequest("/api/organizations", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      setCreateDialogOpen(false);
      setNewOrgName("");
      setNewOrgDescription("");
      toast({ title: "Organization created", description: "Your organization has been created successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create organization.", variant: "destructive" });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (data: { email: string; role: string }) => {
      return apiRequest(`/api/organizations/${selectedOrg?.id}/invitations`, { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", selectedOrg?.id, "invitations"] });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("member");
      toast({ title: "Invitation sent", description: "The invitation has been created." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create invitation.", variant: "destructive" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return apiRequest(`/api/organizations/${selectedOrg?.id}/members/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", selectedOrg?.id, "members"] });
      toast({ title: "Role updated", description: "Member role has been updated." });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest(`/api/organizations/${selectedOrg?.id}/members/${userId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", selectedOrg?.id, "members"] });
      toast({ title: "Member removed", description: "Member has been removed from the organization." });
    },
  });

  const copyInviteLink = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
    toast({ title: "Link copied", description: "Invitation link copied to clipboard." });
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "admin": return <Crown className="h-4 w-4" />;
      case "member": return <Shield className="h-4 w-4" />;
      case "viewer": return <Eye className="h-4 w-4" />;
      default: return null;
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "default";
      case "member": return "secondary";
      case "viewer": return "outline";
      default: return "outline" as const;
    }
  };

  if (orgsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">Organizations</h1>
            <p className="text-muted-foreground">Manage your organizations and team members</p>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-org">
                <Plus className="h-4 w-4 mr-2" />
                Create Organization
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Organization</DialogTitle>
                <DialogDescription>Create a new organization to manage weather stations with your team.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Name</Label>
                  <Input 
                    id="org-name" 
                    value={newOrgName} 
                    onChange={(e) => setNewOrgName(e.target.value)} 
                    placeholder="My Organization"
                    data-testid="input-org-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-description">Description (optional)</Label>
                  <Input 
                    id="org-description" 
                    value={newOrgDescription} 
                    onChange={(e) => setNewOrgDescription(e.target.value)} 
                    placeholder="A brief description of your organization"
                    data-testid="input-org-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                <Button 
                  onClick={() => createOrgMutation.mutate({ name: newOrgName, description: newOrgDescription || undefined })}
                  disabled={!newOrgName.trim() || createOrgMutation.isPending}
                  data-testid="button-submit-create-org"
                >
                  {createOrgMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Your Organizations
              </CardTitle>
              <CardDescription>Select an organization to manage</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {!organizations?.length ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No organizations yet. Create one to get started.</p>
              ) : (
                organizations.map((org) => (
                  <Button
                    key={org.id}
                    variant={selectedOrg?.id === org.id ? "default" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => setSelectedOrg(org)}
                    data-testid={`button-select-org-${org.id}`}
                  >
                    <Building2 className="h-4 w-4 mr-2" />
                    {org.name}
                  </Button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            {!selectedOrg ? (
              <CardContent className="flex flex-col items-center justify-center h-64 text-center">
                <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Select an organization to view details and manage members</p>
              </CardContent>
            ) : (
              <>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle data-testid="text-selected-org-name">{selectedOrg.name}</CardTitle>
                    {selectedOrg.description && (
                      <CardDescription>{selectedOrg.description}</CardDescription>
                    )}
                  </div>
                  <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-invite-member">
                        <UserPlus className="h-4 w-4 mr-2" />
                        Invite
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Invite Team Member</DialogTitle>
                        <DialogDescription>Send an invitation to join {selectedOrg.name}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="invite-email">Email address</Label>
                          <Input 
                            id="invite-email" 
                            type="email"
                            value={inviteEmail} 
                            onChange={(e) => setInviteEmail(e.target.value)} 
                            placeholder="colleague@example.com"
                            data-testid="input-invite-email"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invite-role">Role</Label>
                          <Select value={inviteRole} onValueChange={setInviteRole}>
                            <SelectTrigger data-testid="select-invite-role">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin - Full access to manage organization</SelectItem>
                              <SelectItem value="member">Member - Can manage assigned stations</SelectItem>
                              <SelectItem value="viewer">Viewer - Read-only access</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>Cancel</Button>
                        <Button 
                          onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
                          disabled={!inviteEmail.trim() || inviteMutation.isPending}
                          data-testid="button-submit-invite"
                        >
                          {inviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Send Invitation
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="members">
                    <TabsList>
                      <TabsTrigger value="members" data-testid="tab-members">
                        <Users className="h-4 w-4 mr-2" />
                        Members
                      </TabsTrigger>
                      <TabsTrigger value="invitations" data-testid="tab-invitations">
                        <Mail className="h-4 w-4 mr-2" />
                        Invitations
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="members" className="mt-4">
                      {membersLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : !members?.length ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">No members yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {members.map((member) => (
                            <div 
                              key={member.userId} 
                              className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50"
                              data-testid={`member-row-${member.userId}`}
                            >
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                                  <Users className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                  <p className="font-medium">{member.user?.firstName || member.user?.username || member.userId}</p>
                                  <p className="text-sm text-muted-foreground">{member.user?.email}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={getRoleBadgeVariant(member.role) as any} className="flex items-center gap-1">
                                  {getRoleIcon(member.role)}
                                  {member.role}
                                </Badge>
                                <Select 
                                  value={member.role} 
                                  onValueChange={(role) => updateRoleMutation.mutate({ userId: member.userId, role })}
                                >
                                  <SelectTrigger className="w-28 h-8">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="member">Member</SelectItem>
                                    <SelectItem value="viewer">Viewer</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  onClick={() => removeMemberMutation.mutate(member.userId)}
                                  data-testid={`button-remove-member-${member.userId}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="invitations" className="mt-4">
                      {invitationsLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : !invitations?.length ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">No pending invitations.</p>
                      ) : (
                        <div className="space-y-3">
                          {invitations.map((invite) => (
                            <div 
                              key={invite.id} 
                              className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50"
                              data-testid={`invitation-row-${invite.id}`}
                            >
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                                  <Mail className="h-4 w-4" />
                                </div>
                                <div>
                                  <p className="font-medium">{invite.email}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {invite.acceptedAt ? "Accepted" : `Expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={getRoleBadgeVariant(invite.role) as any}>
                                  {invite.role}
                                </Badge>
                                {!invite.acceptedAt && (
                                  <Button 
                                    size="icon" 
                                    variant="outline" 
                                    onClick={() => copyInviteLink(invite.token)}
                                    data-testid={`button-copy-invite-${invite.id}`}
                                  >
                                    {copiedToken === invite.token ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}