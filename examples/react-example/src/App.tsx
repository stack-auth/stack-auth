import { StackHandler, StackProvider, StackTheme } from "@hexclave/react";
import { Suspense } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { hexclaveClientApp } from "./hexclave";

function HandlerRoutes() {
  const location = useLocation();
  
  return (
    <StackHandler app={hexclaveClientApp} location={location.pathname} fullPage />
  );
}

function App() {
  return (
    <Suspense fallback={null}>
      <BrowserRouter>
        <StackProvider app={hexclaveClientApp}>
          <StackTheme>
            <Routes>
              <Route path="/handler/*" element={<HandlerRoutes />} />
              <Route path="/" element={<div>hello world</div>} />
            </Routes>
          </StackTheme>
        </StackProvider>
      </BrowserRouter>
    </Suspense>
  );
}

export default App;
