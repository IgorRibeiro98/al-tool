import { useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';

const ROUTES = {
    HOME: '/',
} as const;

const MESSAGES = {
    STATUS: '404',
    TITLE: 'Página não encontrada',
    DESCRIPTION: 'A página solicitada não foi encontrada.',
    RETURN: 'Voltar para o início',
    LOG_PREFIX: '404 Error',
} as const;

const NotFound: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();

    const logNotFound = useCallback(() => {
        // Structured log helps debugging and centralizes the message format
        console.error(MESSAGES.LOG_PREFIX, { path: location.pathname });
    }, [location.pathname]);

    useEffect(() => {
        logNotFound();
    }, [logNotFound]);

    return (
        <main role="main" className="flex min-h-screen items-center justify-center bg-muted">
            <div className="text-center">
                <h1 className="mb-4 text-4xl font-bold">{MESSAGES.STATUS}</h1>
                <p className="mb-2 text-xl text-muted-foreground">{MESSAGES.TITLE}</p>
                <p className="mb-6 text-sm text-muted-foreground">{MESSAGES.DESCRIPTION}</p>
                <Button variant="outline" onClick={() => navigate(ROUTES.HOME)}>{MESSAGES.RETURN}</Button>
            </div>
        </main>
    );
};

export default NotFound;
