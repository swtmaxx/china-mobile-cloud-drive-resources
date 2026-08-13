import { useEffect, useRef, useState } from "react";
import Artplayer from "artplayer";
import type { Option } from "artplayer";
import artplayerPluginDanmuku from "artplayer-plugin-danmuku";
import mpegts from "mpegts.js";

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "ogg",
  "ogv",
  "mov",
  "m4v",
  "flv",
  "m2ts",
  "ts",
  "mkv",
]);

export function isVideoFile(extension?: string, name?: string): boolean {
  const ext = (extension || name?.split(".").pop() || "").toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function fileExtension(name: string, extension?: string): string {
  return (extension || name.split(".").pop() || "").toLowerCase();
}

function basenameWithoutExt(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

/** Find a same-basename `.xml` danmaku file in the current directory listing. */
export function findDanmakuHandle(
  videoName: string,
  items: Array<{ kind: string; name: string; handle: string }>,
): string | undefined {
  const base = basenameWithoutExt(videoName).toLowerCase();
  const match = items.find(
    (item) =>
      item.kind === "file" &&
      item.name.toLowerCase().endsWith(".xml") &&
      basenameWithoutExt(item.name).toLowerCase() === base,
  );
  return match?.handle;
}

interface PlayerProps {
  url: string;
  title?: string;
  type?: string;
  danmakuUrl?: string;
  theme?: "light" | "dark";
  onEnded?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

export default function Player({
  url,
  title,
  type,
  danmakuUrl,
  theme = "dark",
  onEnded,
  onPrevious,
  onNext,
}: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Artplayer | null>(null);
  const flvPlayerRef = useRef<mpegts.Player | null>(null);
  const onEndedRef = useRef(onEnded);
  const onPreviousRef = useRef(onPrevious);
  const onNextRef = useRef(onNext);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onPreviousRef.current = onPrevious;
    onNextRef.current = onNext;
  }, [onEnded, onPrevious, onNext]);

  useEffect(() => {
    if (!containerRef.current || !url) {
      return undefined;
    }

    setError(null);
    stageRef.current?.style.removeProperty("height");
    let destroyed = false;
    const mediaType = (type || "").toLowerCase();

    const option: Option = {
      container: containerRef.current,
      url,
      type: mediaType || undefined,
      title: title || "",
      volume: 0.8,
      autoplay: false,
      autoSize: false,
      autoMini: false,
      loop: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      screenshot: true,
      setting: true,
      hotkey: true,
      pip: true,
      mutex: true,
      fullscreen: true,
      fullscreenWeb: true,
      // Mobile: lock to landscape when entering fullscreen.
      autoOrientation: true,
      // Keep the full bottom bar visible; mini bar only appears while idle if enabled.
      miniProgressBar: false,
      playsInline: true,
      lang: "zh-cn",
      theme: theme === "dark" ? "#6ee7a2" : "#19734a",
      // Lock can hide the control bar until tapped; keep off for desktop preview UX.
      lock: false,
      fastForward: true,
      autoPlayback: true,
      airplay: true,
      moreVideoAttr: {
        // @ts-expect-error artplayer allows extra media attributes
        "webkit-playsinline": true,
        playsInline: true,
        // Direct CDN playback — do not force CORS mode on the media element.
        crossOrigin: null,
      },
      customType: {
        flv(video: HTMLMediaElement, source: string) {
          if (!mpegts.getFeatureList().mseLivePlayback) {
            setError("当前浏览器不支持 FLV 播放。");
            return;
          }
          flvPlayerRef.current?.destroy();
          // Direct CDN: disable withCredentials so simple cross-origin GETs are used when CORS allows.
          const instance = mpegts.createPlayer(
            { type: "flv", url: source, isLive: false, cors: true, withCredentials: false },
            { enableStashBuffer: true, stashInitialSize: 128 },
          );
          flvPlayerRef.current = instance;
          instance.on(mpegts.Events.ERROR, () => {
            setError("直连播放失败（CDN 可能无 CORS）。请用外部播放器或下载。");
          });
          instance.attachMediaElement(video);
          instance.load();
        },
        m2ts(video: HTMLMediaElement, source: string) {
          flvPlayerRef.current?.destroy();
          const instance = mpegts.createPlayer(
            { type: "mse", url: source, isLive: false, cors: true, withCredentials: false },
            { enableStashBuffer: true },
          );
          flvPlayerRef.current = instance;
          instance.attachMediaElement(video);
          instance.load();
        },
        ts(video: HTMLMediaElement, source: string) {
          flvPlayerRef.current?.destroy();
          const instance = mpegts.createPlayer(
            { type: "mse", url: source, isLive: false, cors: true, withCredentials: false },
            { enableStashBuffer: true },
          );
          flvPlayerRef.current = instance;
          instance.attachMediaElement(video);
          instance.load();
        },
      },
      plugins: [],
    };

    const extraControls: NonNullable<Option["controls"]> = [];
    if (onPreviousRef.current) {
      extraControls.push({
        name: "previous-button",
        index: 10,
        position: "left",
        html: "‹‹",
        tooltip: "上一个",
        click: () => onPreviousRef.current?.(),
      });
    }
    if (onNextRef.current) {
      extraControls.push({
        name: "next-button",
        index: 11,
        position: "left",
        html: "››",
        tooltip: "下一个",
        click: () => onNextRef.current?.(),
      });
    }
    if (extraControls.length > 0) {
      option.controls = extraControls;
    }

    if (danmakuUrl) {
      option.plugins = [
        artplayerPluginDanmuku({
          danmuku: danmakuUrl,
          speed: 5,
          opacity: 1,
          fontSize: 25,
          color: "#FFFFFF",
          mode: 0,
          modes: [0, 1, 2],
          antiOverlap: true,
          synchronousPlayback: true,
          theme: theme === "dark" ? "dark" : "light",
          heatmap: {
            opacity: 0.75,
            minHeight: 14,
            scale: 0.4,
          },
          emitter: false,
        }),
      ];
    }

    const player = new Artplayer(option);
    playerRef.current = player;

    // Auto-fit the stage to the video's native aspect ratio once metadata is known,
    // clamped by the CSS min/max heights. Falls back to the fixed CSS height until then.
    const applyAutoHeight = () => {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }
      const videoWidth = player.video.videoWidth;
      const videoHeight = player.video.videoHeight;
      if (!videoWidth || !videoHeight) {
        return;
      }
      let target = Math.round((stage.clientWidth / videoWidth) * videoHeight);
      if (!Number.isFinite(target) || target <= 0) {
        return;
      }
      const viewportMax = Math.max(320, window.innerHeight - 200);
      target = Math.min(Math.max(target, 240), viewportMax);
      stage.style.height = `${target}px`;
    };
    const resetAutoHeight = () => {
      stageRef.current?.style.removeProperty("height");
    };
    player.on("video:loadedmetadata", applyAutoHeight);
    player.on("resize", applyAutoHeight);
    player.on("window:resize", applyAutoHeight);
    player.on("ready", () => {
      try {
        player.controls.show = true;
      } catch {
        // Ignore if controls API is unavailable.
      }
      applyAutoHeight();
    });
    player.on("error", () => {
      resetAutoHeight();
      if (!destroyed) {
        setError("视频加载失败，可尝试直接下载后本地播放。");
      }
    });
    player.on("video:ended", () => {
      onEndedRef.current?.();
    });

    return () => {
      destroyed = true;
      try {
        player.destroy(false);
      } catch {
        // Ignore destroy races when switching files quickly.
      }
      playerRef.current = null;
      try {
        flvPlayerRef.current?.destroy();
      } catch {
        // Ignore.
      }
      flvPlayerRef.current = null;
    };
  }, [url, title, type, danmakuUrl, theme]);

  return (
    <div className="player-container ol-player-box" ref={stageRef}>
      <div className="player-mount" ref={containerRef} />
      {error && <div className="player-error" role="alert">{error}</div>}
    </div>
  );
}

export { fileExtension };
