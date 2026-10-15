import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Untold — Some things are just between us.",
    short_name: "Untold",
    description:
      "A calm home for the conversations that matter. Keep your conversations close with the Untold app.",
    start_url: "/app/inbox",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#f6f6f2",
    theme_color: "#f6f6f2",
    categories: ["social", "communication"],
    icons: [
      {
        src: "/icons/untold-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/untold-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/untold-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
