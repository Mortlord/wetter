import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base auf "/wetter/" -> GitHub Pages unter mortlord.github.io/wetter/
export default defineConfig({
  plugins: [react()],
  base: "/wetter/",
});
