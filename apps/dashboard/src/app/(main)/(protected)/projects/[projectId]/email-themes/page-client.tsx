"use client";

import EmailPreview, { DEVICE_VIEWPORTS, DeviceViewport } from "@/components/email-preview";
import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { useRouter } from "@/components/router";
import { ActionDialog, Button, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CheckIcon, DeviceMobile, DeviceTablet, Monitor, Palette, Plus, Trash } from "@phosphor-icons/react";
import { DEFAULT_EMAIL_THEMES, previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { useEffect, useRef, useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

// Glassmorphic card component following design guide
function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode,
  className?: string,
}) {
  return (
    <div className={cn(
      "relative rounded-2xl bg-background/60 backdrop-blur-xl",
      "ring-1 ring-foreground/[0.06]",
      "shadow-sm",
      className
    )}>
      {/* Subtle glassmorphic background */}
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      <div className="relative">
        {children}
      </div>
    </div>
  );
}

// Section header with icon following design guide
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType, title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
        {title}
      </span>
    </div>
  );
}

// Device icon component
function DeviceIcon({ type, className }: { type: DeviceViewport['type'], className?: string }) {
  switch (type) {
    case 'phone': {
      return <DeviceMobile className={className} />;
    }
    case 'tablet': {
      return <DeviceTablet className={className} />;
    }
    case 'desktop': {
      return <Monitor className={className} />;
    }
  }
}

// Viewport selector component following design guide's Time Range Toggle pattern
function ViewportSelector({
  selectedViewport,
  onSelect,
  className
}: {
  selectedViewport: DeviceViewport,
  onSelect: (viewport: DeviceViewport) => void,
  className?: string,
}) {
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-xl bg-foreground/[0.04] p-1 backdrop-blur-sm", className)}>
      {DEVICE_VIEWPORTS.map((viewport) => {
        const isActive = selectedViewport.id === viewport.id;
        return (
          <button
            key={viewport.id}
            onClick={() => onSelect(viewport)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150 hover:transition-none",
              isActive
                ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <DeviceIcon type={viewport.type} className="h-4 w-4" />
            <span>{viewport.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// Realistic preview template using the actual email verification template structure
const detailedPreviewTemplate = deindent`
  import { Button, Section, Hr, Text, Heading } from "@react-email/components";
  import { Subject, NotificationCategory } from "@stackframe/emails";

  export const variablesSchema = v => v;

  export function EmailTemplate({ user, project }) {
    return (
      <>
        <Subject value={\`Verify your email at \${project.displayName}\`} />
        <NotificationCategory value="Transactional" />
        <div className="font-sans text-base font-normal tracking-[0.15008px] leading-[1.5] m-0 py-8 w-full min-h-full">
          <Section>
            <Heading as="h3" className="font-sans font-bold text-[20px] text-center py-4 px-6 m-0">
              Verify your email at {project.displayName}
            </Heading>
            <Text className="font-sans font-normal text-[14px] text-center pt-2 px-6 pb-4 m-0 opacity-80">
              Hi{user.displayName ? (", " + user.displayName) : ''}! Please click on the following button to verify your email.
            </Text>
            <div className="text-center py-3 px-6">
              <Button
                href="#"
                className="text-black font-sans font-bold text-[14px] inline-block bg-[#f0f0f0] rounded-[4px] py-3 px-5 no-underline border-0"
              >
                Verify my email
              </Button>
            </div>
            <div className="py-4 px-6">
              <Hr className="opacity-20" />
            </div>
            <Text className="font-sans font-normal text-[12px] text-center pt-1 px-6 pb-6 m-0 opacity-60">
              If you were not expecting this email, you can safely ignore it. 
            </Text>
          </Section>
        </div>
      </>
    )
  }
`;

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const themes = stackAdminApp.useEmailThemes();
  const activeTheme = project.config.emailTheme;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogSelectedThemeId, setDialogSelectedThemeId] = useState<string>(activeTheme);
  const [selectedViewport, setSelectedViewport] = useState<DeviceViewport>(DEVICE_VIEWPORTS[0]); // Phone
  const containerRef = useRef<HTMLDivElement>(null);
  const [showViewportSelector, setShowViewportSelector] = useState(true);

  // Default to phone view on small containers and hide selector
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const isSmall = width < 700; // Threshold for hiding desktop/tablet views
        setShowViewportSelector(!isSmall);
        if (isSmall) {
          setSelectedViewport(DEVICE_VIEWPORTS[0]);
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleThemeSelect = (themeId: string) => {
    setDialogSelectedThemeId(themeId);
  };

  const handleSaveTheme = async () => {
    await project.update({
      config: { emailTheme: dialogSelectedThemeId }
    });
    setDialogOpen(false);
  };

  const handleOpenDialog = () => {
    setDialogSelectedThemeId(activeTheme);
    setDialogOpen(true);
  };

  const selectedThemeData = themes.find(t => t.id === activeTheme) ?? throwErr(`Unknown theme ${activeTheme}`, { activeTheme });

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Email Themes"
        description="Customize email themes for your project"
        actions={<NewThemeButton />}
      >
        <div className="flex flex-col gap-5">
          {/* Active Theme Card */}
          <GlassCard>
            <div className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <SectionHeader icon={Palette} title="Active Theme" />
                  <span className="text-sm text-muted-foreground">
                    Currently using <span className="font-medium text-foreground">{selectedThemeData.displayName}</span>
                  </span>
                </div>
                <ActionDialog
                  trigger={
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 px-3 text-xs gap-1.5"
                      onClick={handleOpenDialog}
                    >
                      Change Theme
                    </Button>
                  }
                  open={dialogOpen}
                  onOpenChange={setDialogOpen}
                  title="Select Email Theme"
                  cancelButton
                  okButton={{
                    label: "Save Theme",
                    onClick: handleSaveTheme
                  }}
                >
                  <div className="grid grid-cols-2 gap-4">
                    {themes.map((theme) => (
                      <ThemeOption
                        key={theme.id}
                        theme={theme}
                        isSelected={dialogSelectedThemeId === theme.id}
                        onSelect={handleThemeSelect}
                      />
                    ))}
                  </div>
                </ActionDialog>
              </div>
            </div>
          </GlassCard>

          {/* Device Preview Card */}
          <GlassCard className="overflow-hidden">
            {/* Header with viewport selector */}
            <div className="p-5 flex items-center justify-between gap-4 border-b border-foreground/[0.05]">
              <div className="flex items-center gap-4">
                <SectionHeader icon={Monitor} title="Preview" />
                <span className="text-[11px] text-muted-foreground font-mono tabular-nums bg-foreground/[0.04] px-2 py-1 rounded">
                  {selectedViewport.width} × {selectedViewport.height}
                </span>
              </div>
              {showViewportSelector && (
                <ViewportSelector
                  selectedViewport={selectedViewport}
                  onSelect={setSelectedViewport}
                />
              )}
            </div>

            {/* Device Preview Area */}
            <div
              ref={containerRef}
              className={cn(
                "p-8 min-h-[650px] flex items-start justify-center overflow-auto",
                "bg-gradient-to-b from-foreground/[0.02] to-foreground/[0.04]"
              )}
            >
              <EmailPreview
                themeId={selectedThemeData.id}
                templateTsxSource={detailedPreviewTemplate}
                viewport={selectedViewport}
                emailSubject="Verify your email address"
                senderName={project.displayName}
                senderEmail={`noreply@${project.displayName.toLowerCase().replace(/\s+/g, '')}.com`}
              />
            </div>
          </GlassCard>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}

function ThemeOption({
  theme,
  isSelected,
  onSelect
}: {
  theme: { id: string, displayName: string },
  isSelected: boolean,
  onSelect: (themeId: string) => void,
}) {
  const stackAdminApp = useAdminApp();
  const isDefault = Object.keys(DEFAULT_EMAIL_THEMES).includes(theme.id);

  const handleDelete = async () => {
    await stackAdminApp.deleteEmailTheme(theme.id);
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150 hover:transition-none border",
        isSelected
          ? "bg-primary/5 border-primary/50 ring-1 ring-primary/20"
          : "bg-background border-border/50 hover:border-foreground/20 hover:bg-foreground/[0.02]"
      )}
      onClick={() => onSelect(theme.id)}
    >
      <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden bg-background ring-1 ring-foreground/[0.06] group-hover:shadow-md transition-all duration-150">
        <div style={{ transform: 'scale(0.5)', transformOrigin: 'top left', width: '200%', height: '200%' }}>
          <EmailPreview themeId={theme.id} templateTsxSource={previewTemplateSource} disableResizing />
        </div>

        {!isDefault && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <ActionDialog
              title="Delete Theme"
              description={`Are you sure you want to delete the theme "${theme.displayName}"? This action cannot be undone.`}
              okButton={{
                label: "Delete",
                onClick: handleDelete,
                props: {
                  variant: "destructive",
                },
              }}
              cancelButton
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 w-8 p-0 bg-background/80 backdrop-blur-sm hover:bg-destructive hover:text-destructive-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash className="h-4 w-4" />
                </Button>
              }
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isSelected && <CheckIcon className="h-4 w-4 text-primary" />}
        <Typography variant="secondary" className="truncate">{theme.displayName}</Typography>
      </div>
    </div>
  );
}

function NewThemeButton() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();

  const handleCreateNewTheme = async (values: { name: string }) => {
    const { id } = await stackAdminApp.createEmailTheme(values.name);
    router.push(`email-themes/${id}`);
  };

  return (
    <FormDialog
      title="New Theme"
      trigger={
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          New Theme
        </Button>
      }
      onSubmit={handleCreateNewTheme}
      formSchema={yup.object({
        name: yup.string().defined(),
      })}
      render={(form) => (
        <InputField
          control={form.control}
          name="name"
          label="Theme Name"
          placeholder="Enter theme name"
          required
        />
      )}
    />
  );
}
