// ESLint flat config for Node ESM project
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    ignores: [
      "node_modules/**",
      "migrations/**",
      "llm-logs/**",
      "rss-logs/**",
      "supabase/**",
      "tests/fixtures/**",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      // Enable Node 18+ globals (process, Buffer, URL, setTimeout, AbortController, etc.)
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-undef": "error",
    },
  },
];
