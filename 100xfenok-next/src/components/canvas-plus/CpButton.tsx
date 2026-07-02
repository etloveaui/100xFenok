import type { ButtonHTMLAttributes } from "react";

type CpButtonVariant = "primary" | "secondary" | "ghost";
type CpButtonDensity = "compact" | "default" | "comfy";

function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type CpButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: CpButtonVariant;
  density?: CpButtonDensity;
};

export default function CpButton({
  variant = "secondary",
  density = "default",
  className,
  type = "button",
  ...props
}: CpButtonProps) {
  return (
    <button
      type={type}
      className={cpClassNames("cp-button", className)}
      data-variant={variant}
      data-density={density}
      {...props}
    />
  );
}
