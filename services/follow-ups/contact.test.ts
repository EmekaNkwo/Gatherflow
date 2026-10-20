import { describe, expect, it } from "vitest";
import { visitor } from "@/tests/factories";
import { contactOptions } from "./contact";

function person(overrides: Parameters<typeof visitor>[0] = {}) {
  return visitor({ phone: "+44 7700 900200", email: "bisi@example.com", ...overrides });
}

describe("contact options", () => {
  it("puts the way they prefer first, then a call", () => {
    const options = contactOptions(person({ contact: { preferredMethod: "whatsapp", permissionGranted: true, optedOut: false } }));
    expect(options.kind).toBe("ok");
    if (options.kind !== "ok") return;
    expect(options.links).toEqual([
      { method: "whatsapp", label: "WhatsApp", href: "https://wa.me/447700900200" },
      { method: "phone", label: "Call", href: "tel:+447700900200" },
    ]);
  });

  it("falls back to a call when a number has no country code, since WhatsApp needs one", () => {
    const options = contactOptions(
      person({ phone: "0803 555 0100", contact: { preferredMethod: "whatsapp", permissionGranted: true, optedOut: false } }),
    );
    expect(options.kind === "ok" && options.links.map((link) => link.href)).toEqual([
      "tel:08035550100",
      "mailto:bisi@example.com",
    ]);
  });

  it("never builds a mail link that could carry extra headers", () => {
    const options = contactOptions(
      person({ phone: undefined, email: "x?bcc=all@example.com", contact: { preferredMethod: "email", permissionGranted: true, optedOut: false } }),
    );
    expect(options.kind).toBe("none");
  });

  it("offers email when that is what they asked for", () => {
    const options = contactOptions(person({ contact: { preferredMethod: "email", permissionGranted: true, optedOut: false } }));
    expect(options.kind === "ok" && options.links[0]).toEqual({
      method: "email",
      label: "Email",
      href: "mailto:bisi@example.com",
    });
  });

  it("offers nothing to somebody who opted out or never agreed", () => {
    expect(
      contactOptions(person({ contact: { preferredMethod: "phone", permissionGranted: true, optedOut: true } })),
    ).toEqual({ kind: "refused", reason: "Asked not to be contacted" });
    expect(
      contactOptions(person({ contact: { preferredMethod: "phone", permissionGranted: false, optedOut: false } })),
    ).toEqual({ kind: "refused", reason: "Hasn't agreed to be contacted" });
  });

  it("says so when there is no way to reach them", () => {
    expect(
      contactOptions(
        person({ phone: undefined, email: undefined, contact: { preferredMethod: "phone", permissionGranted: true, optedOut: false } }),
      ),
    ).toEqual({ kind: "none", reason: "No phone number or email yet" });
  });
});
