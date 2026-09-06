"use client";

import { useEffect, useState } from "react";
import { storyArtFor } from "@/features/winddown/game/model/storyArt";
import styles from "./artist-story.module.css";

type Props = {
  sceneKey: string;
  title: string;
  compact?: boolean;
  caption?: string;
};

function safeRow(value: number): number {
  return Number.isInteger(value) ? Math.max(0, Math.min(2, value)) : 0;
}

export default function WindDownStoryScene({
  sceneKey,
  title,
  compact = false,
  caption,
}: Props) {
  const art = storyArtFor(sceneKey);
  const [imageFailed, setImageFailed] = useState(false);
  const row = safeRow(art.row);
  const imagePosition = "position" in art && typeof art.position === "string"
    ? art.position
    : "center";

  useEffect(() => {
    setImageFailed(false);
  }, [sceneKey]);

  return (
    <figure
      className={styles.sceneFrame}
      data-story-scene={sceneKey}
      data-story-scene-compact={compact ? "true" : undefined}
    >
      {imageFailed ? (
        <div className={styles.sceneFallback} role="img" aria-label={art.alt}>
          <div>
            <p className={styles.sceneFallbackTitle}>{title}</p>
            <p className={styles.sceneFallbackText}>
              {art.alt} 장면 그림을 잠시 불러오지 못했어. 이야기를 읽고 연습을 이어갈 수 있어.
            </p>
          </div>
        </div>
      ) : (
        <img
          className={styles.sceneImage}
          src={art.src}
          alt={art.alt}
          loading={compact ? "lazy" : "eager"}
          decoding="async"
          style={{
            top: `${row * -100}%`,
            objectPosition: imagePosition,
          }}
          onError={() => setImageFailed(true)}
        />
      )}
      <figcaption className={styles.sceneCaption}>
        <p className={styles.sceneCaptionTitle}>{title}</p>
        {caption ? <p className={styles.sceneCaptionText}>{caption}</p> : null}
      </figcaption>
    </figure>
  );
}
