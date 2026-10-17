// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isPushEndpoint, readPushConfig } from "./config";

describe("push configuration", () => {
  it("needs all three VAPID settings", () => {
    const missing = readPushConfig({ VAPID_PUBLIC_KEY: "pub" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("VAPID_PRIVATE_KEY");

    const configured = readPushConfig({
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: "mailto:ops@example.com",
    });
    expect(configured).toEqual({
      ok: true,
      value: { publicKey: "pub", privateKey: "priv", subject: "mailto:ops@example.com" },
    });
  });

  it("refuses a subject that is not a mailto: or https: address", () => {
    expect(readPushConfig({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "q", VAPID_SUBJECT: "ops" }).ok).toBe(false);
  });
});

describe("push endpoints", () => {
  it("accepts the browser push services", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(isPushEndpoint(url)).toBe(true);
    }
  });

  it("refuses anything the server should not be made to call", () => {
    for (const url of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/push",
      "https://fcm.googleapis.com.evil.example/abc",
      "https://evilfcm.googleapis.com.example/abc",
      "not a url",
    ]) {
      expect(isPushEndpoint(url)).toBe(false);
    }
  });
});
