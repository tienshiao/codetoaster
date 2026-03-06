import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "./ui/input";
import { useDirectories } from "../hooks/use-directories";

interface InitialPathAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  inputId?: string;
  placeholder?: string;
}

export function InitialPathAutocomplete({
  value,
  onChange,
  onOpenChange,
  inputId,
  placeholder,
}: InitialPathAutocompleteProps) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: suggestions = null } = useDirectories(debouncedValue, {
    enabled: debouncedValue.length > 0,
  });

  const setOpen = useCallback(
    (open: boolean) => {
      setShowSuggestions(open);
      onOpenChange?.(open);
    },
    [onOpenChange]
  );

  // Update showSuggestions when query data arrives
  useEffect(() => {
    if (suggestions && suggestions.directories.length > 0) {
      setOpen(true);
      setSelectedIndex(0);
    } else if (suggestions) {
      setOpen(false);
    }
  }, [suggestions, setOpen]);

  const debouncePath = useCallback((path: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!path) {
      setDebouncedValue("");
      return;
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedValue(path);
    }, 200);
  }, []);

  const selectSuggestion = useCallback(
    (dirName: string) => {
      if (!suggestions) return;
      const newPath = suggestions.parent + "/" + dirName + "/";
      onChange(newPath);
      setOpen(false);
      // Trigger a new debounced fetch for the selected path
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setDebouncedValue(newPath);
      }, 200);
    },
    [onChange, setOpen, suggestions]
  );

  const handlePathChange = (nextValue: string) => {
    onChange(nextValue);
    debouncePath(nextValue);
  };

  const handlePathKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || !suggestions) return;

    const dirs = suggestions.directories;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, dirs.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (dirs[selectedIndex]) selectSuggestion(dirs[selectedIndex]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (dirs[selectedIndex]) selectSuggestion(dirs[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!showSuggestions || !dropdownRef.current) return;
    const el = dropdownRef.current.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, showSuggestions]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  return (
    <div className="relative">
      <Input
        id={inputId}
        value={value}
        onChange={(e) => handlePathChange(e.target.value)}
        onKeyDown={handlePathKeyDown}
        onFocus={() => {
          if (suggestions && suggestions.directories.length > 0) {
            setOpen(true);
          }
        }}
        onBlur={() => {
          blurTimeoutRef.current = setTimeout(() => setOpen(false), 150);
        }}
        placeholder={placeholder}
        autoComplete="off"
        data-1p-ignore
      />
      {showSuggestions && suggestions && suggestions.directories.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
        >
          {suggestions.directories.map((dir, i) => (
            <div
              key={dir}
              className={`cursor-pointer px-3 py-1.5 text-sm ${
                i === selectedIndex
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-300 hover:bg-zinc-800"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                selectSuggestion(dir);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              {dir}/
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
