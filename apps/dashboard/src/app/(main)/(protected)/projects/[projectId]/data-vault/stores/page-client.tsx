"use client";

import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { Button, Card, CardContent, CardHeader, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, toast } from "@stackframe/stack-ui";
import { Database, Plus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "../../../../../../../components/router";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const router = useRouter();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newStoreId, setNewStoreId] = useState("");
  const [newStoreDisplayName, setNewStoreDisplayName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const config = project.useConfig();
  const stores = config.dataVault.stores;
  const storeEntries = typedEntries(stores);

  const handleCreateStore = async () => {
    if (!newStoreId.trim()) {
      alert("Store ID is required");
      return;
    }

    if (!newStoreId.match(/^[a-z0-9-]+$/)) {
      alert("Store ID can only contain lowercase letters, numbers, and hyphens");
      return;
    }

    if (newStoreId in stores) {
      alert("A store with this ID already exists");
      return;
    }

    setIsCreating(true);
    try {
      await project.updateConfig({
        [`dataVault.stores.${newStoreId}`]: {
          displayName: newStoreDisplayName.trim() || `Store ${newStoreId}`,
        },
      });

      toast({ title: "Data vault store created successfully" });
      setIsCreateDialogOpen(false);
      setNewStoreId("");
      setNewStoreDisplayName("");
    } finally {
      setIsCreating(false);
    }
  };

  const handleStoreClick = (storeId: string) => {
    router.push(`/projects/${project.id}/data-vault/stores/${storeId}`);
  };

  return (
    <PageLayout
      title="Data Vault Stores"
      actions={
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Store
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-muted-foreground">
              Securely store and manage encrypted data in isolated stores
            </p>
          </div>
        </div>

        {storeEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Database className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No data vault stores yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first data vault store to start securely storing encrypted data
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Store
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {storeEntries.map(([storeId, store]) => (
              <Card
                key={storeId}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleStoreClick(storeId)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <Database className="h-5 w-5 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-sm truncate">{storeId}</h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {store.displayName || "No display name"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Data Vault Store</DialogTitle>
              <DialogDescription>
                Create a new isolated store for encrypted data
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="storeId">Store ID</Label>
                <Input
                  id="storeId"
                  placeholder="e.g., user-secrets, api-keys"
                  value={newStoreId}
                  onChange={(e) => setNewStoreId(e.target.value)}
                  pattern="[a-z0-9-]+"
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, numbers, and hyphens only
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name (optional)</Label>
                <Input
                  id="displayName"
                  placeholder="e.g., User Secrets"
                  value={newStoreDisplayName}
                  onChange={(e) => setNewStoreDisplayName(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                  disabled={isCreating}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreateStore} disabled={isCreating}>
                  {isCreating ? "Creating..." : "Create Store"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageLayout>
  );
}
