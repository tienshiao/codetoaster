import type { InputHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@/frontend/lib/utils";

export type CheckboxVariant = "chip" | "row";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** The words beside the box, and the control's accessible name. */
  label: string;
  /** `chip` wears the same border-and-height chrome as `Select`, for the
   * composer's options row where it stands beside three of them. `row` is the
   * plain form layout a dialog wants. */
  variant?: CheckboxVariant;
  className?: string;
}

/**
 * A boolean, as a real `<input type="checkbox">` wearing the system's paint.
 *
 * Same bargain `Select` strikes with `<select>`: the native element brings the
 * space bar, the label association, the focus ring's semantics and the whole
 * accessibility tree, and a div with `role="checkbox"` would have had to
 * reimplement all of it to look identical. So the input is present and
 * `sr-only`, and the box beside it is drawn from its `peer` state.
 */
export function Checkbox({
  label,
  variant = "row",
  className,
  disabled = false,
  title,
  ...rest
}: CheckboxProps) {
  return (
    <label
      // On the wrapper, not the input. The input is the accessible control but
      // it is `sr-only` and, when this is disabled, receives no pointer events
      // at all — so a `title` left to `...rest` would be a tooltip nothing can
      // hover, which is exactly the case that most wants one: the words
      // explaining why the box is greyed out.
      title={title}
      className={cn(
        "inline-flex items-center gap-2 font-sans tracking-ui",
        variant === "chip"
          ? "h-control rounded-md border border-input bg-pane px-2 text-sm"
          : "text-sm",
        disabled ? "cursor-default opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <input type="checkbox" className="peer sr-only" disabled={disabled} {...rest} />
      <span
        aria-hidden
        className={cn(
          "grid h-3.5 w-3.5 flex-none place-items-center rounded-sm border border-input",
          "peer-checked:border-primary peer-checked:bg-primary",
          "peer-focus-visible:border-ring peer-focus-visible:ring-1 peer-focus-visible:ring-ring",
          // The tick is reached through this span rather than carrying its own
          // `peer-checked:`. The peer variant compiles to a sibling combinator,
          // and the tick is a *child* of the box — the only element here that
          // is actually the input's sibling is this one, so the state has to
          // land on it and be handed down.
          "[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100",
        )}
      >
        <Check size={11} strokeWidth={3} className="text-primary-foreground" />
      </span>
      <span className={variant === "chip" ? "text-muted-foreground" : "text-foreground"}>
        {label}
      </span>
    </label>
  );
}
