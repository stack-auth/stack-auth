import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type HandleType = 'top' | 'right' | 'bottom' | 'left';

type DragHandle = {
  type: HandleType,
  className: string,
  cursor: string,
}

const DRAG_HANDLES: DragHandle[] = [
  { type: 'top', className: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-2', cursor: 'ns-resize' },
  { type: 'right', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-2 h-6', cursor: 'ew-resize' },
  { type: 'bottom', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-6 h-2', cursor: 'ns-resize' },
  { type: 'left', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-6', cursor: 'ew-resize' },
];

const makeIframeDocumentBubbleEvents = (iframe: HTMLIFrameElement) => {
  const mouseMoveBubbler = (event: MouseEvent) => {
    const bounds = iframe.getBoundingClientRect();
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        ...event,
        clientX: event.clientX + bounds.x,
        clientY: event.clientY + bounds.y,
      }),
    );
  };
  const mouseUpBubbler = (event: MouseEvent) => {
    document.dispatchEvent(new MouseEvent('mouseup', event));
  };
  iframe.contentDocument?.addEventListener('mousemove', mouseMoveBubbler);
  iframe.contentDocument?.addEventListener('mouseup', mouseUpBubbler);
  return () => {
    iframe.contentDocument?.removeEventListener('mousemove', mouseMoveBubbler);
    iframe.contentDocument?.removeEventListener('mouseup', mouseUpBubbler);
  };
};

const CONTAINER_PADDING = 0;

const calculateInitialDimensions = (containerElement: HTMLElement | null) => {
  const defaultWidth = 600;
  const defaultHeight = 400;
  const minWidth = 200;
  const minHeight = 150;

  if (!containerElement) {
    return { width: defaultWidth, height: defaultHeight };
  }

  const containerRect = containerElement.getBoundingClientRect();
  const maxWidth = containerRect.width - CONTAINER_PADDING;
  const maxHeight = containerRect.height - CONTAINER_PADDING;

  return {
    width: Math.min(defaultWidth, Math.max(minWidth, maxWidth)),
    height: Math.min(defaultHeight, Math.max(minHeight, maxHeight))
  };
};

type ResizableContainerProps = {
  children: ReactNode,
  className?: string,
}

export default function ResizableContainer({ children, className }: ResizableContainerProps) {
  const [dimensions, setDimensions] = useState<{ width: number, height: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeHandle, setActiveHandle] = useState<HandleType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const parentContainerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number, y: number, width: number, height: number } | null>(null);
  const iframeEventCleanupRef = useRef<(() => void) | null>(null);

  // Set initial dimensions based on parent container size
  useLayoutEffect(() => {
    if (parentContainerRef.current) {
      const initialDimensions = calculateInitialDimensions(parentContainerRef.current);
      setDimensions(initialDimensions);
    }
  }, []);

  // Auto-constrain dimensions when container shrinks
  useEffect(() => {
    if (!parentContainerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0) return;
      const entry = entries[0];
      const { width: containerWidth, height: containerHeight } = entry.contentRect;
      const maxWidth = containerWidth - CONTAINER_PADDING;
      const maxHeight = containerHeight - CONTAINER_PADDING;

      setDimensions(current => {
        if (!current) return current;
        return {
          width: Math.min(current.width, Math.max(200, maxWidth)),
          height: Math.min(current.height, Math.max(150, maxHeight))
        };
      });
    });

    resizeObserver.observe(parentContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleMouseDown = useCallback((handle: HandleType, e: React.MouseEvent) => {
    if (!dimensions) return;
    e.preventDefault();
    setIsDragging(true);
    setActiveHandle(handle);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: dimensions.width,
      height: dimensions.height,
    };
  }, [dimensions]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !activeHandle || !dragStartRef.current || !dimensions) return;

    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    let newWidth = dimensions.width;
    let newHeight = dimensions.height;

    switch (activeHandle) {
      case 'left': {
        newWidth = Math.max(200, dragStartRef.current.width - deltaX * 2);
        break;
      }
      case 'right': {
        newWidth = Math.max(200, dragStartRef.current.width + deltaX * 2);
        break;
      }
      case 'top': {
        newHeight = Math.max(150, dragStartRef.current.height - deltaY * 2);
        break;
      }
      case 'bottom': {
        newHeight = Math.max(150, dragStartRef.current.height + deltaY * 2);
        break;
      }
    }

    if (parentContainerRef.current) {
      const containerRect = parentContainerRef.current.getBoundingClientRect();
      newWidth = Math.min(newWidth, containerRect.width - CONTAINER_PADDING);
      newHeight = Math.min(newHeight, containerRect.height - CONTAINER_PADDING);
    }

    setDimensions({ width: newWidth, height: newHeight });
  }, [isDragging, activeHandle, dimensions]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setActiveHandle(null);
    dragStartRef.current = null;

    if (iframeEventCleanupRef.current) {
      iframeEventCleanupRef.current();
      iframeEventCleanupRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = DRAG_HANDLES.find(h => h.type === activeHandle)?.cursor || 'default';
      document.body.style.userSelect = 'none';

      const iframe = containerRef.current?.querySelector('iframe');
      if (iframe && iframe.contentDocument) {
        iframeEventCleanupRef.current = makeIframeDocumentBubbleEvents(iframe);
      }
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';

      if (iframeEventCleanupRef.current) {
        iframeEventCleanupRef.current();
        iframeEventCleanupRef.current = null;
      }
    };
  }, [isDragging, handleMouseMove, handleMouseUp, activeHandle]);

  // Don't render until we have calculated dimensions
  if (!dimensions) {
    return <div ref={parentContainerRef} className="relative flex items-center justify-center h-full w-full" />;
  }

  return (
    <div ref={parentContainerRef} className="relative flex items-center justify-center h-full w-full">
      {isDragging && (
        <div className="absolute top-0 left-0 bg-gray-200 text-black px-3 py-1 rounded text-sm font-mono z-20 shadow-sm">
          {Math.round(dimensions.width)} × {Math.round(dimensions.height)}
        </div>
      )}

      <div
        ref={containerRef}
        className={`relative border border-gray-300 rounded-lg overflow-hidden shadow-lg group ${className || ''}`}
        style={{
          width: dimensions.width,
          height: dimensions.height,
          transition: isDragging ? 'none' : 'all 0.2s ease-out'
        }}
      >
        {children}
        {/* Drag Handles */}
        {DRAG_HANDLES.map(({ type, className, cursor }) => (
          <div
            key={type}
            className={`absolute ${className} bg-blue-500 border border-blue-600 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-blue-600 active:bg-blue-700 z-10 ${isDragging && activeHandle === type ? 'opacity-100' : ''}`}
            style={{ cursor }}
            onMouseDown={(e) => handleMouseDown(type, e)}
          />
        ))}
      </div>
    </div>
  );
}
