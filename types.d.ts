declare module 'download-counts/package.json' {
  const content: {
    version: string;
    [key: string]: any;
  };
  export default content;
}

// Add other global type declarations if needed
interface ImportMeta {
  url: string;
}
