// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/site-settings";

describe("site Markdown rendering", () => {
  it("keeps common Markdown and removes executable content", () => {
    const html = renderMarkdown("# 公告\n\n[危险链接](javascript:alert(1))\n\n<script>alert('xss')</script>\n\n**安全文本**");

    expect(html).toContain("<h1>公告</h1>");
    expect(html).toContain("<strong>安全文本</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });
});
