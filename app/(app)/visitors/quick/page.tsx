"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWelcomeStore } from "@/stores/welcome-store";

/**
 * "Welcome someone new" is a modal now, opened from anywhere. This address
 * stays for old links and bookmarks: it opens the modal over the visitors
 * list.
 */
export default function QuickRegistrationRedirect() {
  const router = useRouter();
  const show = useWelcomeStore((state) => state.show);

  useEffect(() => {
    show();
    router.replace("/visitors");
  }, [router, show]);

  return null;
}
