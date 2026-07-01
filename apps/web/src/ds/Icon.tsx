import * as Lucide from "lucide-react";
import type { CSSProperties } from "react";

// Map a kebab-case icon name to a lucide-react PascalCase component.
// Falls back through deprecated aliases, then to a neutral circle.
function toPascal(name: string): string {
  return name.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
}

// A few lucide renames — try the modern name if the classic alias is gone.
const ALIASES: Record<string, string> = {
  "check-circle": "CircleCheck",
  "x-circle": "CircleX",
  "alert-triangle": "TriangleAlert",
  "circle-dashed": "CircleDashed",
};

const registry = Lucide as unknown as Record<string, Lucide.LucideIcon>;

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, color = "currentColor", strokeWidth = 1.75, style }: IconProps) {
  const Cmp =
    registry[toPascal(name)] ||
    (ALIASES[name] ? registry[ALIASES[name]] : undefined) ||
    registry.Circle;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        color,
        flex: "0 0 auto",
        ...style,
      }}
    >
      <Cmp size={size} strokeWidth={strokeWidth} />
    </span>
  );
}
