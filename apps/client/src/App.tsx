import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { ThemeProvider } from "next-themes";
import Dashboard from "./pages/Dashboard";
import Bases from "./pages/Bases";
import NewBase from "./pages/NewBase";
import BaseDetails from "./pages/BaseDetails";
import ConfigCancelamento from "./pages/ConfigCancelamento";
import ConfigEstorno from "./pages/ConfigEstorno";
import ConfigConciliacao from "./pages/ConfigConciliacao";
import NewConfigCancelamento from "./pages/NewConfigCancelamento";
import EditConfigCancelamento from "./pages/EditConfigCancelamento";
import NewConfigEstorno from "./pages/NewConfigEstorno";
import EditConfigEstorno from "./pages/EditConfigEstorno";
import NewConfigConciliacao from "./pages/NewConfigConciliacao";
import EditConfigConciliacao from "./pages/EditConfigConciliacao";
import ConfigMapeamento from "./pages/ConfigMapeamento";
import NewConfigMapeamento from "./pages/NewConfigMapeamento";
import EditConfigMapeamento from "./pages/EditConfigMapeamento";
import Conciliacoes from "./pages/Conciliacoes";
import NewConciliacao from "./pages/NewConciliacao";
import ConciliacaoDetails from "./pages/ConciliacaoDetails";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
    <ThemeProvider attribute="class" defaultTheme="system">
        <QueryClientProvider client={queryClient}>
            <TooltipProvider>
                <Toaster />
                <Sonner />
                <BrowserRouter>
                    <Routes>
                        <Route path="/" element={<Layout />}>
                            <Route index element={<Dashboard />} />
                            <Route path="bases" element={<Bases />} />
                            <Route path="bases/new" element={<NewBase />} />
                            <Route path="bases/:id" element={<BaseDetails />} />
                            <Route path="configs/cancelamento" element={<ConfigCancelamento />} />
                            <Route path="configs/cancelamento/:id" element={<EditConfigCancelamento />} />
                            <Route path="configs/cancelamento/new" element={<NewConfigCancelamento />} />
                            <Route path="configs/estorno" element={<ConfigEstorno />} />
                            <Route path="configs/estorno/new" element={<NewConfigEstorno />} />
                            <Route path="configs/estorno/:id" element={<EditConfigEstorno />} />
                            <Route path="configs/conciliacao" element={<ConfigConciliacao />} />
                            <Route path="configs/conciliacao/new" element={<NewConfigConciliacao />} />
                            <Route path="configs/conciliacao/:id" element={<EditConfigConciliacao />} />
                            <Route path="configs/mapeamento" element={<ConfigMapeamento />} />
                            <Route path="configs/mapeamento/new" element={<NewConfigMapeamento />} />
                            <Route path="configs/mapeamento/:id" element={<EditConfigMapeamento />} />
                            <Route path="conciliacoes" element={<Conciliacoes />} />
                            <Route path="conciliacoes/new" element={<NewConciliacao />} />
                            <Route path="conciliacoes/:id" element={<ConciliacaoDetails />} />
                        </Route>
                        <Route path="*" element={<NotFound />} />
                    </Routes>
                </BrowserRouter>
            </TooltipProvider>
        </QueryClientProvider>
    </ThemeProvider>
);

export default App;
