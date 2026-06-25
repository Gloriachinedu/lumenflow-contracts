import html from "@html-eslint/eslint-plugin";
import globals from "globals";

export default [
  // Plain .js files (browser environment)
  {
    files: ["frontend/**/*.js", "dashboard/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_|^e$" }],
      eqeqeq: ["warn", "smart"],
    },
  },
  // Inline <script> blocks inside HTML files
  {
    ...html.configs["flat/recommended"],
    files: ["frontend/**/*.html", "dashboard/**/*.html"],
    languageOptions: {
      parser: html.parser,
      globals: { ...globals.browser },
    },
    rules: {
      ...html.configs["flat/recommended"].rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_|^e$" }],
      eqeqeq: ["warn", "smart"],
    },
  },
];
