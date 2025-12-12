import { Toaster as AppToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from 'react';
import { fetchLicenseStatus } from '@/services/licenseService';
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
import ConfigSubtypes from "./pages/ConfigSubtypes";
import ConfigKeys from "./pages/ConfigKeys";
import KeysPairs from "./pages/KeysPairs";
import NewConfigMapeamento from "./pages/NewConfigMapeamento";
import EditConfigMapeamento from "./pages/EditConfigMapeamento";
import Conciliacoes from "./pages/Conciliacoes";
import NewConciliacao from "./pages/NewConciliacao";
import ConciliacaoDetails from "./pages/ConciliacaoDetails";
import NotFound from "./pages/NotFound";
import LicenseActivate from "./pages/LicenseActivate";
import LicenseBlocked from "./pages/LicenseBlocked";
import { Navigate } from 'react-router-dom';

const queryClient = new QueryClient();


function LicenseGate(): null {
    const { pathname } = useLocation();
    const navigate = useNavigate();

    const { data, isLoading, isError } = useQuery<any>({
        queryKey: ['licenseStatus'],
        queryFn: () => {
            return fetchLicenseStatus().then((res) => res.data);
        },
        staleTime: 10_000,
        retry: false,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        if (isLoading) return;
        // Allow any /license/* routes (activation/blocked pages) to render without redirect
        if (pathname.startsWith('/license')) return;
        if (isError) return; // cannot determine license — allow user to proceed

        const status = data?.status;
        if (!status || status === 'not_activated') {
            navigate('/license/activate', { replace: true });
            return;
        }

        if (['expired', 'blocked', 'blocked_offline'].includes(status)) {
            navigate('/license/blocked', { replace: true });
            return;
        }
    }, [isLoading, isError, data, pathname, navigate]);

    return null;
}

const App = () => (
    <ThemeProvider attribute="class" defaultTheme="system">
        <QueryClientProvider client={queryClient}>
            <TooltipProvider>
                <AppToaster />
                <SonnerToaster />
                <BrowserRouter>
                    <LicenseGate />
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
                            <Route path="configs/keys" element={<ConfigKeys />} />
                            <Route path="configs/key-pairs" element={<KeysPairs />} />
                            <Route path="configs/subtypes" element={<ConfigSubtypes />} />
                            <Route path="configs/mapeamento/new" element={<NewConfigMapeamento />} />
                            <Route path="configs/mapeamento/:id" element={<EditConfigMapeamento />} />
                            <Route path="conciliacoes" element={<Conciliacoes />} />
                            <Route path="conciliacoes/new" element={<NewConciliacao />} />
                            <Route path="conciliacoes/:id" element={<ConciliacaoDetails />} />
                            <Route path="license/activate" element={<LicenseActivate />} />
                        </Route>
                        <Route path="license/blocked" element={<LicenseBlocked />} />
                        <Route path="license" element={<Navigate to="/license/activate" replace />} />
                        <Route path="*" element={<NotFound />} />
                    </Routes>
                </BrowserRouter>
            </TooltipProvider>
        </QueryClientProvider>
    </ThemeProvider>
);

export default App;
