import { Route, Routes } from "react-router-dom";
import { AppProvider } from "@/lib/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Topbar } from "@/components/layout/Topbar";
import { MobileNav, Sidebar } from "@/components/layout/Sidebar";
import { PageBody } from "@/components/layout/Page";
import { Empty } from "@/components/ui/states";
import OverviewPage from "@/pages/overview/OverviewPage";
import SignalsPage from "@/pages/signals/SignalsPage";
import CasesPage from "@/pages/CasesPage";
import CaseDetailPage from "@/pages/case/CaseDetailPage";
import ReportsPage from "@/pages/ReportsPage";
import IntegrationsPage from "@/pages/IntegrationsPage";

export default function App() {
  return (
    <AppProvider>
      <TooltipProvider>
        <div className="flex min-h-full flex-col">
          <Topbar />
          <MobileNav />
          <div className="flex flex-1">
            <Sidebar />
            <main className="min-w-0 flex-1">
              <Routes>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/signals" element={<SignalsPage />} />
                <Route path="/cases" element={<CasesPage />} />
                <Route path="/cases/:id" element={<CaseDetailPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="*" element={<PageBody><Empty title="Page not found" hint="Use the navigation on the left." /></PageBody>} />
              </Routes>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </AppProvider>
  );
}
