"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWelcomeStore } from "@/stores/welcome-store";

/**
 * The full visitor form lives in the "Welcome someone new" modal now. This
 * address stays for old links and bookmarks: it opens the modal on the full
 * form, over the visitors list.
 */
export default function NewVisitorRedirect() {
  const router = useRouter();
  const show = useWelcomeStore((state) => state.show);

  useEffect(() => {
    show({ mode: "full" });
    router.replace("/visitors");
  }, [router, show]);

  return null;
}
