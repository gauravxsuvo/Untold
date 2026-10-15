import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Untold",
    short_name: "Untold",
    description:
      "A quiet place for your conversations. Add a friend, share a moment, and keep in touch.",
    start_url: "/app/inbox",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#f7f8f4",
    theme_color: "#f7f8f4",
    categories: ["social", "communication"],
    icons: [
      {
        src: "/icons/untold-192.png?v=2",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/untold-512.png?v=2",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/untold-maskable-512.png?v=2",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
