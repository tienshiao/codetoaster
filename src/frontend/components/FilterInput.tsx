import { Search, X } from "lucide-react";

interface FilterInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Extra classes merged onto the relative wrapper. */
  className?: string;
  autoFocus?: boolean;
}

// Search-icon + clear-X filter input shared by the diff/file trees and the git
// ref sidebar. The clear button appears only when there's a value.
export function FilterInput({ value, onChange, placeholder, className, autoFocus }: FilterInputProps) {
  return (
    <div className={`relative${className ? ` ${className}` : ""}`}>
      <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className="w-full bg-muted/50 text-xs text-foreground rounded-md pl-7 pr-7 py-1.5 outline-none border border-transparent focus:border-border placeholder:text-muted-foreground"
      />
      {value && (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
          aria-label="Clear filter"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
