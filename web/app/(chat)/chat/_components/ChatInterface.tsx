"use client";
import Assistant from "@/components/chat/assistant";
import ToolsPanel from "@/components/chat/tools-panel";
import { useState, useEffect } from "react";

// Import icons directly instead of using dynamic imports
import { Menu as MenuIcon, X as XIcon } from "lucide-react";

export default function ChatInterface() {
  const [isToolsPanelOpen, setIsToolsPanelOpen] = useState(false);

  // Handle escape key to close mobile panel
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isToolsPanelOpen) {
        setIsToolsPanelOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isToolsPanelOpen]);

  // Prevent body scroll when mobile panel is open
  useEffect(() => {
    if (isToolsPanelOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isToolsPanelOpen]);

  return (
    <div className="flex h-full relative">
      {/* Main chat area */}
      <div className="flex-1 lg:flex-none lg:w-[70%]">
        <Assistant />
      </div>

      {/* Desktop tools panel */}
      <div className="hidden lg:block lg:w-[30%] border-l border-border">
        <ToolsPanel />
      </div>

      {/* Mobile hamburger menu button */}
      <button
        onClick={() => setIsToolsPanelOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 z-40 bg-primary text-primary-foreground p-3 rounded-full shadow-lg hover:bg-primary/90 transition-colors"
        aria-label="Open tools panel"
      >
        <MenuIcon size={20} />
      </button>

      {/* Mobile overlay */}
      {isToolsPanelOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/50 lg:hidden"
            onClick={() => setIsToolsPanelOpen(false)}
          />

          {/* Slide-out panel */}
          <div className={`fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-background border-l border-border transform transition-transform duration-300 ease-in-out lg:hidden ${
            isToolsPanelOpen ? 'translate-x-0' : 'translate-x-full'
          }`}>
            {/* Panel header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Tools & Settings</h2>
              <button
                onClick={() => setIsToolsPanelOpen(false)}
                className="p-2 hover:bg-secondary rounded-md transition-colors"
                aria-label="Close tools panel"
              >
                <XIcon size={20} />
              </button>
            </div>

            {/* Panel content */}
            <div className="h-full overflow-y-auto">
              <ToolsPanel />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
