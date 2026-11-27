import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// Inline the built stylesheet into index.html as a <style> block. This saves the
// render-blocking round trip for the CSS file, which matters most on slow mobile
// connections. The CSS is ~4 KB gzipped and uses absolute /assets/ URLs, so it
// works unchanged inside the HTML. Build only; dev keeps the normal <link>.
function inlineCss() {
  return {
    name: "inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find(
        (f) => f.type === "asset" && f.fileName.endsWith(".html"),
      );
      if (!html) return; // the Worker build has no HTML
      let source = String(html.source);
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) continue;
        const tag = new RegExp(
          `<link rel="stylesheet"[^>]*href="/${file.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`,
        );
        if (!tag.test(source)) continue;
        const css = String(file.source).replace(/<\/style/gi, "<\\/style");
        source = source.replace(tag, () => `<style>${css}</style>`);
        delete bundle[file.fileName];
      }
      html.source = source;
    },
  };
}

export default defineConfig({
  plugins: [cloudflare(), inlineCss()],
});
