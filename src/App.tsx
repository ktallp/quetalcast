import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Join from "./pages/Join";
import Broadcaster from "./pages/Broadcaster";
import Receiver from "./pages/Receiver";
import Admin from "./pages/Admin";
import DocsLayout from "./pages/docs/DocsLayout";
import DocsOverview from "./pages/docs/Overview";
import DocsBroadcaster from "./pages/docs/Broadcaster";
import DocsReceiver from "./pages/docs/Receiver";
import DocsIntegrations from "./pages/docs/Integrations";
import Changelog from "./pages/Changelog";
import NotFound from "./pages/NotFound";

const App = () => (
  <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/join/:token" element={<Join />} />
          <Route path="/broadcast" element={<Broadcaster />} />
          <Route path="/receive" element={<Receiver />} />
          <Route path="/receive/:roomId" element={<Receiver />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/docs" element={<DocsLayout />}>
            <Route index element={<DocsOverview />} />
            <Route path="broadcaster" element={<DocsBroadcaster />} />
            <Route path="receiver" element={<DocsReceiver />} />
            <Route path="integrations" element={<DocsIntegrations />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
  </TooltipProvider>
);

export default App;
