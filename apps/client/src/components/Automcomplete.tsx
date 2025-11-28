import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';

type Item<T = any> = T;

type Props<T = any> = {
    items: Item<T>[];
    value?: T | T[] | null;
    multiple?: boolean;
    placeholder?: string;
    disabled?: boolean;
    freeSolo?: boolean;
    getItemLabel?: (item: T) => string;
    getItemValue?: (item: T) => string | number;
    onChange?: (val: T | T[] | null) => void;
    className?: string;
    renderItem?: (item: T) => React.ReactNode;
};

function defaultGetItemLabel(item: any) {
    if (item == null) return '';
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    if (typeof item === 'object' && 'label' in item) return String((item as any).label);
    return JSON.stringify(item);
}

function defaultGetItemValue(item: any) {
    if (item == null) return '';
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    if (typeof item === 'object' && 'value' in item) return String((item as any).value);
    if (typeof item === 'object' && 'id' in item) return String((item as any).id);
    return defaultGetItemLabel(item);
}

export default function Automcomplete<T = any>(props: Props<T>) {
    const {
        items,
        value,
        multiple = false,
        placeholder = '',
        disabled = false,
        freeSolo = false,
        getItemLabel = defaultGetItemLabel,
        getItemValue = defaultGetItemValue,
        onChange,
        className,
        renderItem,
    } = props;

    const [input, setInput] = useState('');
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    // normalize selected values
    const selectedArray: T[] = useMemo(() => {
        if (multiple) {
            if (!value) return [];
            return Array.isArray(value) ? value as T[] : [value as T];
        }
        return value ? [value as T] : [];
    }, [value, multiple]);

    // filtered items by input
    const filtered = useMemo(() => {
        const q = input.trim().toLowerCase();
        if (!q) return items;
        return items.filter(i => getItemLabel(i).toLowerCase().includes(q));
    }, [items, input, getItemLabel]);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (!rootRef.current) return;
            if (!rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('click', onDocClick);
        return () => document.removeEventListener('click', onDocClick);
    }, []);

    useEffect(() => {
        setHighlight(0);
    }, [filtered.length, open]);

    const selectItem = (item: T) => {
        if (multiple) {
            const exists = selectedArray.find(s => getItemValue(s) === getItemValue(item));
            const next = exists ? selectedArray.filter(s => getItemValue(s) !== getItemValue(item)) : [...selectedArray, item];
            onChange && onChange(next);
            setInput('');
            setOpen(false);
            inputRef.current?.focus();
        } else {
            onChange && onChange(item);
            setInput(getItemLabel(item));
            setOpen(false);
        }
    };

    const removeAt = (idx: number) => {
        if (!multiple) return;
        const next = selectedArray.slice();
        next.splice(idx, 1);
        onChange && onChange(next);
    };

    const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlight(h => Math.min(h + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight(h => Math.max(h - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && filtered[highlight]) {
                selectItem(filtered[highlight]);
            } else if (freeSolo && input.trim() !== '') {
                onChange && onChange(multiple ? [...selectedArray, (input as unknown) as T] : (input as unknown) as T);
                setOpen(false);
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
        } else if (e.key === 'Backspace') {
            if (multiple && input === '' && selectedArray.length > 0) {
                // remove last
                removeAt(selectedArray.length - 1);
            }
        }
    };

    const handleInput = (v: string) => {
        setInput(v);
        setOpen(true);
    };

    return (
        <div ref={rootRef} className={className ?? 'w-full'}>
            <div
                className={
                    multiple
                        ? 'min-h-[2.5rem] flex flex-wrap items-center gap-2 rounded-md border border-input bg-background px-3 py-1'
                        : 'flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm'
                }
                onClick={() => inputRef.current?.focus()}
            >
                {multiple && selectedArray.length > 0 && (
                    <div className="flex gap-2 items-center">
                        {selectedArray.map((s, idx) => (
                            <Badge key={getItemValue(s)} variant="secondary" className="flex items-center gap-2">
                                <span className="font-mono text-xs">{getItemLabel(s)}</span>
                                <button type="button" className="p-1" onClick={(ev) => { ev.stopPropagation(); removeAt(idx); }}>
                                    <X className="h-3 w-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                )}

                <div className="flex-1 min-w-[8rem]">
                    <Input
                        ref={inputRef}
                        value={multiple ? input : (input || (selectedArray[0] ? getItemLabel(selectedArray[0]) : ''))}
                        placeholder={placeholder}
                        onChange={(e: any) => handleInput(e.target.value)}
                        onFocus={() => setOpen(true)}
                        onKeyDown={onKeyDown}
                        disabled={disabled}
                        className="border-0 bg-transparent px-0 py-0 h-full"
                    />
                </div>
            </div>

            {open && (
                <div className="mt-1 border rounded bg-popover text-popover-foreground shadow-md max-h-52 overflow-auto z-50">
                    {filtered.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground">Sem opções</div>
                    ) : (
                        <ul role="listbox">
                            {filtered.map((it, idx) => (
                                <li
                                    key={getItemValue(it) ?? idx}
                                    role="option"
                                    aria-selected={false}
                                    onMouseDown={(e) => { e.preventDefault(); selectItem(it); }}
                                    onMouseEnter={() => setHighlight(idx)}
                                    className={`px-3 py-2 cursor-pointer ${highlight === idx ? 'bg-accent text-accent-foreground' : ''}`}
                                >
                                    {renderItem ? renderItem(it) : <span>{getItemLabel(it)}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
