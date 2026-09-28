'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getGoToSuggestions } from '@/lib/admin/admin-go-to-helpers.mjs';

export default function AdminGoToSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = getGoToSuggestions(query);

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape' && rootRef.current?.contains(document.activeElement)) {
        setOpen(false);
        inputRef.current?.focus();
      }
    }
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onFocusIn(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  }, [pathname]);

  function navigate(item) {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
    inputRef.current?.blur();
    router.push(item.href);
  }

  function onSubmit(event) {
    if (open && activeIndex >= 0 && suggestions[activeIndex]) {
      event.preventDefault();
      navigate(suggestions[activeIndex]);
    }
  }

  function onInputKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => index < 0 ? suggestions.length - 1 : (index - 1 + suggestions.length) % suggestions.length);
    }
  }

  return (
    <form ref={rootRef} action="/admin/students" onSubmit={onSubmit} className="relative flex min-w-0 items-center gap-2">
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(event.target.value.trim() ? 0 : -1);
          setOpen(true);
        }}
        onFocus={() => {
          setActiveIndex(query.trim() ? 0 : -1);
          setOpen(true);
        }}
        onKeyDown={onInputKeyDown}
        placeholder="Go to…"
        aria-label="Go to a workflow or search students"
        role="combobox"
        aria-expanded={open}
        aria-controls="admin-go-to-results"
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? `admin-go-to-option-${activeIndex}` : undefined}
        autoComplete="off"
        className="h-11 w-44 rounded-full border border-blue-200/70 bg-white/80 px-4 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus-visible:ring-2 focus-visible:ring-[#2F6B3D]/45 md:w-56"
      />
      <button
        type="submit"
        className="h-11 rounded-full border border-blue-200/70 bg-white/80 px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B3D]/45"
      >
        Go
      </button>
      {open && (
        <div
          id="admin-go-to-results"
          role="listbox"
          aria-label="Go to results"
          className="absolute left-0 top-full z-50 mt-2 max-h-80 w-[min(22rem,calc(100vw-3rem))] overflow-y-auto rounded-2xl border border-blue-200 bg-white p-1.5 shadow-xl md:left-auto md:right-0"
        >
          {suggestions.map((item, index) => (
            <button
              key={item.href}
              id={`admin-go-to-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => navigate(item)}
              className={`flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B3D]/45 ${index === activeIndex ? 'bg-green-50 text-[#2F6B3D]' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="truncate">{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
