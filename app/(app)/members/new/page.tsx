"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAddMemberStore } from "@/stores/add-member-store";

/**
 * "Add a member" is a modal now. This address stays for old links and
 * bookmarks: it opens the modal over the members list.
 */
export default function NewMemberRedirect() {
  const router = useRouter();
  const show = useAddMemberStore((state) => state.show);

  useEffect(() => {
    show();
    router.replace("/members");
  }, [router, show]);

  return null;
}
