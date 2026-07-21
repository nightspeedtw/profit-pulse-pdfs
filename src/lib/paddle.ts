// Paddle.js SDK bootstrap + env detection.
import { supabase } from "@/integrations/supabase/client";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Paddle: any;
  }
}

export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

let paddleInitialized = false;
let paddleLoadingPromise: Promise<void> | null = null;

export function initializePaddle(): Promise<void> {
  if (paddleInitialized) return Promise.resolve();
  if (paddleLoadingPromise) return paddleLoadingPromise;
  if (!clientToken) return Promise.reject(new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set"));

  paddleLoadingPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-paddle-loader]');
    const doInit = () => {
      const env = getPaddleEnvironment() === "sandbox" ? "sandbox" : "production";
      window.Paddle.Environment.set(env);
      window.Paddle.Initialize({ token: clientToken });
      paddleInitialized = true;
      resolve();
    };
    if (existing && window.Paddle) return doInit();
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.dataset.paddleLoader = "1";
    script.onload = doInit;
    script.onerror = () => reject(new Error("Failed to load Paddle.js"));
    document.head.appendChild(script);
  });
  return paddleLoadingPromise;
}

export async function getPaddlePriceId(priceId: string): Promise<string> {
  const environment = getPaddleEnvironment();
  const { data, error } = await supabase.functions.invoke("get-paddle-price", {
    body: { priceId, environment },
  });
  if (error || !data?.paddleId) throw new Error(`Failed to resolve price: ${priceId}`);
  return data.paddleId as string;
}
