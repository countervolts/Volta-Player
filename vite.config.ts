import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "md5",
    ],
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: [
      "player.ayois.gay",
      "player.voltamusic.xyz",
      "beta-player.ayois.gay",
      "beta-player.voltamusic.xyz",
    ],
    hmr:
      mode === "remote"
        ? {
            host: "beta-player.voltamusic.xyz",
            protocol: "wss",
            clientPort: 443,
          }
        : undefined,
  },
}));
