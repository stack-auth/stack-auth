// vite.config.ts
import react from "file:///Users/konstantinwohlwend/Documents/stack-3/node_modules/.pnpm/@vitejs+plugin-react@4.3.4_vite@5.4.21_@types+node@22.19.0_lightningcss@1.30.1_terser@5.44.0_/node_modules/@vitejs/plugin-react/dist/index.mjs";
import { componentTagger } from "file:///Users/konstantinwohlwend/Documents/stack-3/node_modules/.pnpm/lovable-tagger@1.1.11_tsx@4.19.3_vite@5.4.21_@types+node@22.19.0_lightningcss@1.30.1_terser@5.44.0__yaml@2.8.0/node_modules/lovable-tagger/dist/index.js";
import path from "path";
import { defineConfig } from "file:///Users/konstantinwohlwend/Documents/stack-3/node_modules/.pnpm/vite@5.4.21_@types+node@22.19.0_lightningcss@1.30.1_terser@5.44.0/node_modules/vite/dist/node/index.js";
var __vite_injected_original_dirname = "/Users/konstantinwohlwend/Documents/stack-3/examples/lovable-react-18-example";
var vite_config_default = defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: Number((process.env.NEXT_PUBLIC_STACK_PORT_PREFIX || "81") + "32")
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMva29uc3RhbnRpbndvaGx3ZW5kL0RvY3VtZW50cy9zdGFjay0zL2V4YW1wbGVzL2xvdmFibGUtcmVhY3QtMTgtZXhhbXBsZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL2tvbnN0YW50aW53b2hsd2VuZC9Eb2N1bWVudHMvc3RhY2stMy9leGFtcGxlcy9sb3ZhYmxlLXJlYWN0LTE4LWV4YW1wbGUvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL2tvbnN0YW50aW53b2hsd2VuZC9Eb2N1bWVudHMvc3RhY2stMy9leGFtcGxlcy9sb3ZhYmxlLXJlYWN0LTE4LWV4YW1wbGUvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4gKHtcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogXCI6OlwiLFxuICAgIHBvcnQ6IE51bWJlcigocHJvY2Vzcy5lbnYuTkVYVF9QVUJMSUNfU1RBQ0tfUE9SVF9QUkVGSVggfHwgXCI4MVwiKSArIFwiMzJcIiksXG4gIH0sXG4gIHBsdWdpbnM6IFtyZWFjdCgpLCBtb2RlID09PSBcImRldmVsb3BtZW50XCIgJiYgY29tcG9uZW50VGFnZ2VyKCldLmZpbHRlcihCb29sZWFuKSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICBcIkBcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyY1wiKSxcbiAgICB9LFxuICB9LFxufSkpO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF5WixPQUFPLFdBQVc7QUFDM2EsU0FBUyx1QkFBdUI7QUFDaEMsT0FBTyxVQUFVO0FBQ2pCLFNBQVMsb0JBQW9CO0FBSDdCLElBQU0sbUNBQW1DO0FBTXpDLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxPQUFPO0FBQUEsRUFDekMsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTSxRQUFRLFFBQVEsSUFBSSxpQ0FBaUMsUUFBUSxJQUFJO0FBQUEsRUFDekU7QUFBQSxFQUNBLFNBQVMsQ0FBQyxNQUFNLEdBQUcsU0FBUyxpQkFBaUIsZ0JBQWdCLENBQUMsRUFBRSxPQUFPLE9BQU87QUFBQSxFQUM5RSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQ0YsRUFBRTsiLAogICJuYW1lcyI6IFtdCn0K
