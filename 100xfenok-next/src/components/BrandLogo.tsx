import Image from "next/image";

export type BrandLogoSize = "sm" | "md" | "lg";

const STYLES: Record<
  BrandLogoSize,
  { container: string; image: string; sizes: string }
> = {
  sm: {
    container: "w-6 h-6",
    image: "w-4 h-4",
    sizes: "16px",
  },
  md: {
    container: "w-8 h-8",
    image: "w-6 h-6",
    sizes: "24px",
  },
  lg: {
    container: "w-10 h-10",
    image: "w-8 h-8",
    sizes: "32px",
  },
};

interface BrandLogoProps {
  size?: BrandLogoSize;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}

export default function BrandLogo({
  size = "md",
  className = "",
  imageClassName = "",
  priority = false,
}: BrandLogoProps) {
  const { container, image, sizes } = STYLES[size];
  return (
    <span
      className={`inline-flex items-center justify-center bg-white rounded-xl shadow-md border border-slate-100 transition-all duration-300 ${container} ${className}`}
      aria-hidden="true"
    >
      <Image
        src="/100x-fenok-logo.png"
        alt=""
        width={100}
        height={100}
        priority={priority}
        sizes={sizes}
        className={`object-contain ${image} ${imageClassName}`}
      />
    </span>
  );
}
