// Markdown files are imported as their text (see src/instructions/index.ts).
declare module '*.md' {
  const text: string;
  export default text;
}
