import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Database, AlertCircle } from "lucide-react";

export function DemoInitializer({ children }: { children: React.ReactNode }) {
  const [isInitializing, setIsInitializing] = useState(true);
  const [initMessage, setInitMessage] = useState("Connecting to server...");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: stations, isLoading, error: queryError } = useQuery<any[]>({
    queryKey: ["/api/stations"],
    retry: 5,
    retryDelay: 1000,
  });

  useEffect(() => {
    async function initDemo() {
      // Handle query errors
      if (queryError) {
        console.error("Failed to fetch stations:", queryError);
        setError(`Server connection failed: ${queryError.message}. Make sure the server is running.`);
        return;
      }

      // Wait for stations query to complete
      if (isLoading) {
        setInitMessage("Loading stations...");
        return;
      }

      // If no stations exist, create demo station
      if (!stations || stations.length === 0) {
        setInitMessage("Creating demo station with sample data...");
        try {
          const response = await apiRequest("POST", "/api/demo/initialize");
          const result = await response.json();
          console.log("Demo station created:", result);
          // Refresh the stations list
          await queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
          setInitMessage("Demo station ready!");
          setTimeout(() => setIsInitializing(false), 500);
        } catch (error: any) {
          console.error("Failed to create demo station:", error);
          setError(`Failed to create demo station: ${error.message}`);
        }
      } else {
        // Stations exist, proceed
        console.log("Found existing stations:", stations.length);
        setIsInitializing(false);
      }
    }

    initDemo();
  }, [stations, isLoading, queryError, queryClient]);

  if (error) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-slate-900 text-white gap-4">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <span className="text-3xl font-bold tracking-wide">STRATUS</span>
        </div>
        <div className="flex flex-col items-center gap-2 text-slate-400 max-w-md text-center">
          <span className="text-red-400">{error}</span>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-slate-900 text-white gap-4">
        <div className="flex items-center gap-3">
          <Database className="h-10 w-10 text-blue-400 animate-pulse" />
          <span className="text-3xl font-bold tracking-wide">STRATUS</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{initMessage}</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
