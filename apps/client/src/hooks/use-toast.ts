import { useEffect, useState } from 'react';

import type { ToastActionElement, ToastProps } from '@/components/ui/toast';

const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 1000 * 60 * 60; // 1 hour default

export type ToasterToast = ToastProps & {
    id: string;
    title?: React.ReactNode;
    description?: React.ReactNode;
    action?: ToastActionElement;
};

const ACTIONS = {
    ADD: 'ADD_TOAST',
    UPDATE: 'UPDATE_TOAST',
    DISMISS: 'DISMISS_TOAST',
    REMOVE: 'REMOVE_TOAST',
} as const;

let idCounter = 0;
function createToastId(): string {
    idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
    return idCounter.toString();
}

type Action =
    | { type: typeof ACTIONS.ADD; toast: ToasterToast }
    | { type: typeof ACTIONS.UPDATE; toast: Partial<ToasterToast> & { id: string } }
    | { type: typeof ACTIONS.DISMISS; toastId?: string }
    | { type: typeof ACTIONS.REMOVE; toastId?: string };

interface State {
    toasts: ToasterToast[];
}

const removeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRemoval(toastId: string) {
    if (removeTimeouts.has(toastId)) return;

    const timeout = setTimeout(() => {
        removeTimeouts.delete(toastId);
        globalDispatch({ type: ACTIONS.REMOVE, toastId });
    }, TOAST_REMOVE_DELAY);

    removeTimeouts.set(toastId, timeout);
}

export const reducer = (state: State, action: Action): State => {
    switch (action.type) {
        case ACTIONS.ADD:
            return { ...state, toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };
        case ACTIONS.UPDATE:
            return { ...state, toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)) };
        case ACTIONS.DISMISS: {
            const { toastId } = action;
            if (toastId) {
                scheduleRemoval(toastId);
            } else {
                state.toasts.forEach((t) => scheduleRemoval(t.id));
            }

            return {
                ...state,
                toasts: state.toasts.map((t) => (toastId === undefined || t.id === toastId ? { ...t, open: false } : t)),
            };
        }
        case ACTIONS.REMOVE:
            if (action.toastId === undefined) return { ...state, toasts: [] };
            return { ...state, toasts: state.toasts.filter((t) => t.id !== action.toastId) };
        default:
            return state;
    }
};

const listeners = new Set<(s: State) => void>();
let memoryState: State = { toasts: [] };

function globalDispatch(action: Action) {
    memoryState = reducer(memoryState, action);
    for (const listener of Array.from(listeners)) listener(memoryState);
}

export type ToastHandle = {
    id: string;
    dismiss: () => void;
    update: (props: Partial<ToasterToast>) => void;
};

export function toast(props: Omit<ToasterToast, 'id'>): ToastHandle {
    const id = createToastId();

    const update = (next: Partial<ToasterToast>) =>
        globalDispatch({ type: ACTIONS.UPDATE, toast: { ...next, id } as Partial<ToasterToast> & { id: string } });

    const dismiss = () => globalDispatch({ type: ACTIONS.DISMISS, toastId: id });

    globalDispatch({
        type: ACTIONS.ADD,
        toast: {
            ...props,
            id,
            open: true,
            onOpenChange: (open) => {
                if (!open) dismiss();
            },
        } as ToasterToast,
    });

    return { id, dismiss, update };
}

export function useToast() {
    const [, setState] = useState<State>(memoryState);

    useEffect(() => {
        listeners.add(setState);
        return () => void listeners.delete(setState);
    }, []);

    return {
        ...memoryState,
        toast,
        dismiss: (toastId?: string) => globalDispatch({ type: ACTIONS.DISMISS, toastId }),
    } as State & { toast: typeof toast; dismiss: (id?: string) => void };
}

export default useToast;
