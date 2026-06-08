// vite env types
declare global {
  interface ImportMeta {
    env: {
      BASE_URL: string;
      MODE: string;
      DEV: boolean;
      PROD: boolean;
      [key: string]: string | boolean;
    };
  }
}
export {};
