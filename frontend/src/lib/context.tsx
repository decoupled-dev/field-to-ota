import { createContext, useContext, useEffect } from "react";
import { api, type Health, type StageDef } from "./api";
import { useAsync } from "./hooks";

interface AppCtx {
  health: Health | undefined;
  healthError: Error | undefined;
  stages: StageDef[];
}

const Ctx = createContext<AppCtx>({ health: undefined, healthError: undefined, stages: [] });

export function AppProvider({ children }: { children: React.ReactNode }) {
  const health = useAsync(api.health, [], 15000);
  const stages = useAsync(api.stages, []);
  const { reload: reloadStages, error: stagesError } = stages;

  // The stage catalog is static; refetch it once the backend becomes reachable.
  useEffect(() => {
    if (stagesError && health.data) reloadStages();
  }, [stagesError, health.data, reloadStages]);

  return <Ctx.Provider value={{ health: health.data, healthError: health.error, stages: stages.data ?? [] }}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
