import RouteEmbedFrame from "@/components/RouteEmbedFrame";

type IbV1EmbedProps = {
  shellClassName?: string;
};

/**
 * V1 IB Helper — existing vanilla HTML/JS app embedded via iframe.
 * Production default. Untouched from the pre-V2 state.
 */
export default function IbV1Embed({ shellClassName }: IbV1EmbedProps) {
  return (
    <RouteEmbedFrame
      src="/ib-helper/index.html"
      title="100x IB Helper"
      loading="eager"
      shellClassName={shellClassName}
    />
  );
}
