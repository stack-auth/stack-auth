import { getPublicEnvVar } from '@/lib/env';
import { Button, CopyField, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";

export type EnvSnippetPreset = "nextjs" | "vite" | "nuxt" | "sveltekit";

const envSnippetPresetLabels: Record<EnvSnippetPreset, string> = {
  nextjs: "Next.js",
  vite: "Vite",
  nuxt: "Nuxt",
  sveltekit: "SvelteKit",
};

function getFrameworkPublicEnvEntries(props: {
  projectId: string,
  publishableClientKey?: string,
  preset: EnvSnippetPreset,
}) {
  const apiUrl = getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') === "https://api.stack-auth.com"
    ? undefined
    : getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL');

  switch (props.preset) {
    case "nextjs": {
      return {
        NEXT_PUBLIC_STACK_API_URL: apiUrl,
        NEXT_PUBLIC_STACK_PROJECT_ID: props.projectId,
        NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: props.publishableClientKey,
      };
    }
    case "vite": {
      return {
        VITE_STACK_API_URL: apiUrl,
        VITE_STACK_PROJECT_ID: props.projectId,
        VITE_STACK_PUBLISHABLE_CLIENT_KEY: props.publishableClientKey,
      };
    }
    case "nuxt": {
      return {
        NUXT_PUBLIC_STACK_API_URL: apiUrl,
        NUXT_PUBLIC_STACK_PROJECT_ID: props.projectId,
        NUXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: props.publishableClientKey,
      };
    }
    case "sveltekit": {
      return {
        PUBLIC_STACK_API_URL: apiUrl,
        PUBLIC_STACK_PROJECT_ID: props.projectId,
        PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: props.publishableClientKey,
      };
    }
  }
}

export function getEnvFileContent(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
  preset: EnvSnippetPreset,
}) {
  const envFileContent = Object.entries({
    ...getFrameworkPublicEnvEntries(props),
    STACK_SECRET_SERVER_KEY: props.secretServerKey,
    STACK_SUPER_SECRET_ADMIN_KEY: props.superSecretAdminKey,
  })
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  return envFileContent;
}

export function EnvKeys(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
  defaultPreset?: EnvSnippetPreset,
}) {
  const defaultPreset = props.defaultPreset ?? "nextjs";

  const handleDownloadKeys = () => {
    const blob = new Blob([getEnvFileContent({ ...props, preset: defaultPreset })], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `api_keys.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Tabs defaultValue={"env"}>
      <TabsList className="flex">
        <TabsTrigger value="env" className="flex-grow">
          Env Snippets
        </TabsTrigger>
        <TabsTrigger value="keys" className="flex-grow">
          API Keys
        </TabsTrigger>
      </TabsList>
      <TabsContent value={"env"}>
        <FrameworkEnvKeys {...props} defaultPreset={defaultPreset} />
      </TabsContent>
      <TabsContent value={"keys"}>
        <APIEnvKeys {...props} />
      </TabsContent>
      <Button variant="secondary" className="w-full mt-4" onClick={handleDownloadKeys}>
        Download Keys
      </Button>
    </Tabs>
  );
}

export function APIEnvKeys(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
}) {
  return (
    <div className="flex flex-col gap-4 w-full">
      {props.projectId && (
        <CopyField
          type="input"
          monospace
          value={props.projectId}
          label="Project ID"
          helper="This ID is used in your client-side code and is safe to expose to the public."
        />
      )}
      {props.publishableClientKey && (
        <CopyField
          type="input"
          monospace
          value={props.publishableClientKey}
          label="Publishable Client Key"
          helper="This key is used in your client-side code and is safe to expose to the public."
        />
      )}
      {props.secretServerKey && (
        <CopyField
          type="input"
          monospace
          value={props.secretServerKey}
          label="Secret Server Key"
          helper="This key is used on the server-side and can be used to perform actions on behalf of your users. Keep it safe."
        />
      )}
      {props.superSecretAdminKey && (
        <CopyField
          type="input"
          monospace
          value={props.superSecretAdminKey}
          label="Super Secret Admin Key"
          helper="This key is for administrative use only. Anyone owning this key will be able to create unlimited new keys and revoke any other keys. Be careful!"
        />
      )}
    </div>
  );
}

export function FrameworkEnvKeys(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
  defaultPreset?: EnvSnippetPreset,
}) {
  const defaultPreset = props.defaultPreset ?? "nextjs";

  return (
    <Tabs defaultValue={defaultPreset}>
      <TabsList className="grid grid-cols-2 md:grid-cols-4">
        {(Object.keys(envSnippetPresetLabels) as EnvSnippetPreset[]).map((preset) => (
          <TabsTrigger key={preset} value={preset}>
            {envSnippetPresetLabels[preset]}
          </TabsTrigger>
        ))}
      </TabsList>
      {(Object.keys(envSnippetPresetLabels) as EnvSnippetPreset[]).map((preset) => {
        const envFileContent = getEnvFileContent({ ...props, preset });
        return (
          <TabsContent key={preset} value={preset}>
            <CopyField
              type="textarea"
              monospace
              height={envFileContent.split("\n").length * 26}
              value={envFileContent}
              fixedSize
            />
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

export function NextJsEnvKeys(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
}) {
  return <FrameworkEnvKeys {...props} defaultPreset="nextjs" />;
}
