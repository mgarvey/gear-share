import { describe, expect, it } from "vitest";
import { isSesEmailAddress, signedSesRequest } from "./ses";

describe("bounded SES SendEmail signing", () => {
  it("pins the API endpoint, sender, one recipient, config set, delivery tag, and authenticated app link", async () => {
    const request = await signedSesRequest({
      region: "us-east-1", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret",
      sender: "gear@example.test", configurationSet: "gear-share-transactional", appOrigin: "https://gear.example.test",
      now: new Date("2026-08-14T12:00:00Z"),
      message: { recipient: "member@example.test", subject: "Gear: loan request", body: "A loan changed.", appRoute: "/loans", deliveryTag: "00000000-0000-4000-8000-000000000001" },
    });
    expect(request.endpoint).toBe("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails");
    expect(request.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260814\/us-east-1\/ses\/aws4_request/);
    const payload = JSON.parse(request.payload);
    expect(payload).toMatchObject({
      FromEmailAddress: "gear@example.test",
      Destination: { ToAddresses: ["member@example.test"] },
      Content: { Simple: { Subject: { Data: "Gear: loan request", Charset: "UTF-8" }, Body: { Text: { Data: "A loan changed.\n\nOpen in the private Gear Share: https://gear.example.test/loans", Charset: "UTF-8" } } } },
      ConfigurationSetName: "gear-share-transactional",
      EmailTags: [{ Name: "delivery_tag", Value: "00000000-0000-4000-8000-000000000001" }],
    });
    const html = payload.Content.Simple.Body.Html.Data;
    expect(html).toContain("Community");
    expect(html).toContain("https://gear.example.test/favicon.png");
    expect(html).toContain('bgcolor="#075b38"');
    expect(html).toContain("background-color:#075b38");
    expect(html).toContain('href="https://gear.example.test/loans"');
    expect(html).toContain("Open Gear Share");
    expect(html).toContain("You&rsquo;re receiving this because you&rsquo;re a member");
  });

  it("escapes message text before placing it in the branded HTML", async () => {
    const request = await signedSesRequest({
      region: "us-east-1", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret",
      sender: "gear@example.test", configurationSet: "gear-share-transactional", appOrigin: "https://gear.example.test",
      now: new Date("2026-08-14T12:00:00Z"),
      message: { recipient: "member@example.test", subject: "Gear <update>", body: "Use <script>alert(1)</script> & review.", appRoute: "/loans", deliveryTag: "00000000-0000-4000-8000-000000000001" },
    });
    const html = JSON.parse(request.payload).Content.Simple.Body.Html.Data;
    expect(html).toContain("Gear &lt;update&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; review.");
    expect(html).not.toContain("<script>");
  });

  it("rejects routes and origins that could redirect outside the authenticated app", async () => {
    const base = { region: "us-east-1", accessKeyId: "key", secretAccessKey: "secret", sender: "gear@example.test", configurationSet: "gear-share", now: new Date(), message: { recipient: "member@example.test", subject: "Subject", body: "Body", appRoute: "//evil.test", deliveryTag: "00000000-0000-4000-8000-000000000001" } };
    await expect(signedSesRequest({ ...base, appOrigin: "https://gear.example.test" })).rejects.toThrow("invalid app route");
    await expect(signedSesRequest({ ...base, appOrigin: "http://gear.example.test", message: { ...base.message, appRoute: "/loans" } })).rejects.toThrow("invalid app origin");
  });

  it("accepts bounded SES mailbox syntax and rejects malformed or non-ASCII addresses", () => {
    expect(isSesEmailAddress("member+loans@example.test")).toBe(true);
    for (const value of ["not-an-address", "two@@example.test", ".member@example.test", "member@localhost", "mémber@example.test", "member@example..test"]) expect(isSesEmailAddress(value)).toBe(false);
  });
});
