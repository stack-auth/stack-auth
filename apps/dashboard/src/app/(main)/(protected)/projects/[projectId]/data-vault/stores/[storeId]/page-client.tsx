"use client";

import { CodeBlock } from "@/components/code-block";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, toast } from "@stackframe/stack-ui";
import { ArrowLeft, Check, Copy, Edit2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "../../../../../../../../components/router";
import { PageLayout } from "../../../page-layout";
import { useAdminApp } from "../../../use-admin-app";

type PageClientProps = {
  storeId: string,
}

export default function PageClient({ storeId }: PageClientProps) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const router = useRouter();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedDisplayName, setEditedDisplayName] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const config = project.useConfig();
  const store = config.dataVault.stores[storeId];

  if (!(storeId in config.dataVault.stores)) {
    return (
      <PageLayout title="Store Not Found">
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground mb-4">This data vault store does not exist.</p>
          <Button onClick={() => router.push(`/projects/${project.id}/data-vault/stores`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Stores
          </Button>
        </div>
      </PageLayout>
    );
  }

  const handleDeleteStore = async () => {
    if (deleteConfirmation !== storeId) {
      alert("Please type the store ID to confirm deletion");
      return;
    }

    setIsDeleting(true);
    try {
      const { [storeId]: _, ...remainingStores } = config.dataVault.stores;

      await project.updateConfig({
        [`dataVault.stores.${storeId}`]: null,
      });

      toast({ title: "Data vault store deleted successfully" });
      router.push(`/projects/${project.id}/data-vault/stores`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUpdateDisplayName = async () => {
    await project.updateConfig({
      [`dataVault.stores.${storeId}`]: {
        ...store,
        displayName: editedDisplayName.trim() || store.displayName,
      },
    });

    toast({ title: "Display name updated successfully" });
    setIsEditingName(false);
  };

  const startEditingName = () => {
    setEditedDisplayName(store.displayName || "");
    setIsEditingName(true);
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };


  const serverExample = deindent`
    // In your .env file or environment variables:
    // STACK_DATA_VAULT_SECRET=insert-a-randomly-generated-secret-here

    const store = await stackServerApp.getDataVaultStore(${JSON.stringify(storeId)});

    // Each store is a key-value store. You can use any string as a key, for example user IDs
    const key = user.id;

    // Get a value for a specific key
    const value = await store.getValue(key, {
      secret: process.env.STACK_DATA_VAULT_SECRET,
    });

    // Set a value for a specific key
    await store.setValue(key, "my-value", {
      secret: process.env.STACK_DATA_VAULT_SECRET,
    });
  `;


  return (
    <PageLayout
      title={`Data Vault Store`}
    >
      <div className="space-y-6">
        <div className="flex flex-row gap-4 justify-between items-center">
          <div>
            <Label>Store ID</Label>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-sm bg-muted px-2 py-1 rounded">{storeId}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(storeId)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <Label>Display Name</Label>
            {isEditingName ? (
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={editedDisplayName}
                  onChange={(e) => setEditedDisplayName(e.target.value)}
                  placeholder="Enter display name"
                  className="max-w-sm"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUpdateDisplayName}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingName(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-muted-foreground">
                  {store.displayName || "No display name set"}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={startEditingName}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setIsDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Store
          </Button>
        </div>

        <div className="flex flex-col gap-2 text-muted-foreground text-sm">
          <p>
            Your data vault store has been created.
          </p>
          <p>
            A store securely saves key-value pairs with Stack Auth. Plaintext keys and values are never written to a database; instead, they&apos;re encrypted and decrypted on-the-fly using envelope encryption with a rotating master key.
          </p>
          <p>
            To use the store, you&apos;ll need a random, unguessable secret. It can be any format, but for strong security it should be at least 32 characters long and provide 256 bits of entropy. <b>Even Stack Auth</b> can&apos;t access your data if you lose it, so keep it safe.
          </p>
          <p>
            Stack Auth only stores hashes of your keys, so you can&apos;t list all keys in a store. Each value is encrypted with its key, the provided secret, and an additional encryption secret that is kept safe by Stack Auth.
          </p>
        </div>

        <CodeBlock
          language="typescript"
          content={serverExample}
          title="Example Implementation"
          icon="code"
        />

        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Data Vault Store</DialogTitle>
              <DialogDescription>
                This action cannot be undone. All encrypted data in this store will be permanently deleted.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="confirmation">
                  Type <strong>{storeId}</strong> to confirm deletion
                </Label>
                <Input
                  id="confirmation"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder={storeId}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsDeleteDialogOpen(false);
                    setDeleteConfirmation("");
                  }}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteStore}
                  disabled={isDeleting || deleteConfirmation !== storeId}
                >
                  {isDeleting ? "Deleting..." : "Delete Store"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageLayout>
  );
}
