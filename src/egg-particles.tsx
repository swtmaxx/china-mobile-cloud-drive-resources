import { useEffect, useRef } from "react";

const EGG_SIZE = 26;
const MAX_PARTICLES = 140;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  vr: number;
  life: number;
  maxLife: number;
}

export default function EggParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }
    ctx.imageSmoothingEnabled = false;

    const particles: Particle[] = [];
    let texture: HTMLImageElement | null = null;
    let raf = 0;
    let running = true;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const onPointerDown = (event: PointerEvent) => {
      if (!texture) {
        return;
      }
      if (particles.length > MAX_PARTICLES - 12) {
        particles.splice(0, particles.length + 12 - MAX_PARTICLES);
      }
      const count = 9 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 4.5;
        const maxLife = 700 + Math.random() * 700;
        particles.push({
          x: event.clientX,
          y: event.clientY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2.2,
          rotation: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.18,
          life: maxLife,
          maxLife,
        });
      }
    };
    window.addEventListener("pointerdown", onPointerDown);

    let last = performance.now();
    const frame = (now: number) => {
      if (!running) {
        return;
      }
      const dt = Math.min((now - last) / 16.666, 3);
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!texture) {
        raf = requestAnimationFrame(frame);
        return;
      }
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const particle = particles[i];
        particle.life -= dt * 16.666;
        if (particle.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        particle.vy += 0.18 * dt;
        particle.vx *= 0.985;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.rotation += particle.vr * dt;
        const alpha = Math.min(1, particle.life / 300);
        const scale = particle.life / particle.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        const size = EGG_SIZE * (0.55 + 0.45 * scale);
        ctx.drawImage(texture, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const image = new Image();
    image.src = "/egg.png";
    image.onload = () => {
      texture = image;
    };
    image.onerror = () => {
      console.error("[egg-particles] failed to load /egg.png");
    };


    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return <canvas ref={canvasRef} className="egg-particles" aria-hidden="true" />;
}
