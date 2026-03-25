"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EnterpriseLoginPage() {
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/auth/enterprise", { cache: "no-store" });
        if (res.ok) {
          router.replace("/");
          return;
        }
      } catch {
        // ignore
      }

      const returnTo = `${window.location.origin}/enterprise-login`;
      const oaUrl = `https://oa.vectaix.com/sso?return_to=${encodeURIComponent(returnTo)}`;
      window.location.replace(oaUrl);
    };

    run();
  }, [router]);

  return null;
}

