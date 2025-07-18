import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@stackframe/stack-ui";

type VibeCodeEditorLayoutProps = {
  previewComponent: React.ReactNode,
  editorComponent: React.ReactNode,
  chatComponent: React.ReactNode,
}

export default function VibeCodeEditorLayout({
  previewComponent,
  editorComponent,
  chatComponent
}: VibeCodeEditorLayoutProps) {
  return (
    <ResizablePanelGroup direction="horizontal" className="flex h-full">
      <ResizablePanel className="flex-1 flex flex-col" defaultSize={75}>
        <ResizablePanelGroup direction="vertical" className="flex h-full">
          <ResizablePanel className="flex flex-col flex-1 flex-shrink h-full" minSize={10}>
            {previewComponent}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel className="flex-1 flex flex-col" minSize={10}>
            {editorComponent}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel className="w-96 flex flex-col">
        {chatComponent}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
