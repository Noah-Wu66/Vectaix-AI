"use client";

import { useEffect } from "react";

export function useAppViewportHeightVar() {
  useEffect(() => {
    const root = document.documentElement;
    let rafId = 0;

    const apply = () => {
      const vv = window.visualViewport;
      const height = vv?.height ?? window.innerHeight;
      const width = vv?.width ?? window.innerWidth;

      root.style.setProperty("--app-height", `${Math.round(height)}px`);
      root.style.setProperty("--app-width", `${Math.round(width)}px`);
    };

    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(apply);
    };

    schedule();

    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      cancelAnimationFrame(rafId);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, []);
}


