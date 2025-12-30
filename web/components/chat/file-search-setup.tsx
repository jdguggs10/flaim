"use client";
import React, { useState } from "react";
import useToolsStore from "@/stores/chat/useToolsStore";
import FileUpload from "@/components/chat/file-upload";
import { Input } from "@/components/ui/input";
import { CircleX } from "lucide-react";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipProvider } from "@/components/ui/tooltip";
import useHasMounted from "@/hooks/useHasMounted";

interface VectorStore {
  id: string;
  name: string;
  files?: Array<{
    id: string;
    name: string;
    content: string;
  }>;
  // Add other expected properties as needed
}

export default function FileSearchSetup() {
  // Prevent SSR–client HTML mismatch while keeping hook order intact
  const hasMounted = useHasMounted();

  const { vectorStore, setVectorStore } = useToolsStore();
  const [newStoreId, setNewStoreId] = useState<string>("");

  if (!hasMounted) {
    return <div />;
  }

  const unlinkStore = async () => {
    setVectorStore({
      id: "",
      name: "",
    });
  };

  const handleAddStore = async (storeId: string) => {
    if (storeId.trim()) {
      const newStore = await fetch(
        `/api/chat/vector_stores/retrieve_store?vector_store_id=${storeId}`
      ).then((res) => res.json() as Promise<VectorStore>);
      if (newStore.id) {
        console.log("Retrieved store:", newStore);
        setVectorStore(newStore);
      } else {
        alert("Vector store not found");
      }
    }
  };

  return (
    <div>
      <div className="text-sm text-zinc-500">
        Upload a file to create a new vector store, or use an existing one.
      </div>
      <div className="flex items-center gap-2 mt-2 h-10">
        <div className="flex items-center gap-2 w-full">
          <div className="text-sm font-medium w-24 text-nowrap">
            Vector store
          </div>
          {vectorStore?.id ? (
            <div className="flex items-center justify-between flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="text-zinc-400  text-xs font-mono flex-1 text-ellipsis truncate">
                  {vectorStore.id}
                </div>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleX
                        onClick={() => unlinkStore()}
                        size={16}
                        className="cursor-pointer text-zinc-400 mb-0.5 shrink-0 mt-0.5 hover:text-zinc-700 transition-all"
                      />
                    </TooltipTrigger>
                    <TooltipContent className="mr-2">
                      <p>Unlink vector store</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="ID (vs_XXXX...)"
                value={newStoreId}
                onChange={(e) => setNewStoreId(e.target.value)}
                className="border border-zinc-300 rounded text-sm bg-white"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddStore(newStoreId);
                  }
                }}
              />
              <div
                className="text-zinc-400 text-sm px-1 transition-colors hover:text-zinc-600 cursor-pointer"
                onClick={() => handleAddStore(newStoreId)}
              >
                Add
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex mt-4">
        <FileUpload
          vectorStoreId={vectorStore?.id ?? ""}
          vectorStoreName={vectorStore?.name ?? ""}
          onAddStore={(id) => handleAddStore(id)}
          onUnlinkStore={() => unlinkStore()}
        />
      </div>
    </div>
  );
}
